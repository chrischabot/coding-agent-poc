import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

type SmokeResult = {
  task: string;
  workdir: string;
  expectedFile: string;
  stdout: string;
  stderr: string;
  code: number;
  ok: boolean;
  note?: string;
};

async function runAgentOnce(task: string, workdir: string, timeoutMs = 120000): Promise<SmokeResult> {
  await mkdir(workdir, { recursive: true });

  return new Promise((resolve) => {
    const args = ["run", "src/index.ts", task, "--non-interactive", "--yolo"];
    const child = spawn("bun", args, {
      cwd: process.cwd(),
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    const start = Date.now();
    console.log(`→ running: bun ${args.join(" ")} (cwd=${process.cwd()}, workdir=${workdir})`);
    const timer = setTimeout(() => {
      stderr += `\n[timeout ${timeoutMs}ms]\n`;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      clearTimeout(timer);
      const dur = Date.now() - start;
      console.log(`← completed (code=${code ?? 0}, ${dur}ms)`);
      resolve({
        task,
        workdir,
        expectedFile: "",
        stdout,
        stderr,
        code: code ?? 0,
        ok: code === 0,
      });
    });
  });
}

async function fileContains(path: string, needle: string): Promise<boolean> {
  try {
    const text = await Bun.file(path).text();
    return text.toLowerCase().includes(needle.toLowerCase());
  } catch {
    return false;
  }
}

async function runSmoke() {
  const root = process.cwd();
  const projectsDir = join(root, "projects");
  await rm(projectsDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(projectsDir, { recursive: true });

  const scenarios: Array<{ name: string; task: string; expected: string }> = [
    { name: "ts-hello", task: 'Create a TypeScript file that prints "hello world" to stdout', expected: "index.ts" },
    { name: "py-hello", task: 'Create a Python file that prints "hello world" to stdout', expected: "main.py" },
    { name: "go-hello", task: 'Create a Go program that prints "hello world" to stdout', expected: "main.go" },
  ];

  const results: SmokeResult[] = [];

  for (const scenario of scenarios) {
    const workdir = join(projectsDir, scenario.name);
    const result = await runAgentOnce(scenario.task, workdir);
    result.expectedFile = join(workdir, scenario.expected);
    const hasFile = await fileContains(result.expectedFile, "hello world");
    result.ok = result.ok && hasFile;
    if (!hasFile) {
      result.note = "Expected file missing or does not contain 'hello world'";
    }
    results.push(result);
  }

  const failed = results.filter((r) => !r.ok);

  console.log("\n=== Smoke Results ===");
  for (const r of results) {
    console.log(`\n[${r.ok ? "PASS" : "FAIL"}] ${r.task}`);
    console.log(` workdir: ${r.workdir}`);
    console.log(` expected: ${r.expectedFile}`);
    console.log(` exit: ${r.code}`);
    if (r.note) console.log(` note: ${r.note}`);
  }

  if (failed.length > 0) {
    console.log("\n=== Failure details (stdout/stderr) ===");
    for (const r of failed) {
      console.log(`\n--- ${r.task} ---`);
      console.log("stdout:\n" + r.stdout.slice(0, 4000));
      console.log("stderr:\n" + r.stderr.slice(0, 4000));
    }
    process.exitCode = 1;
  }
}

runSmoke().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
