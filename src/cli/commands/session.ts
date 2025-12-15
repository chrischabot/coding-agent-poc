import { SessionPersistence } from "../../session/persistence.js";

export interface SessionOptions {
  action: "list" | "delete" | "show";
  sessionId?: string;
}

export async function manageSessions(options: SessionOptions): Promise<void> {
  switch (options.action) {
    case "list": {
      console.log("\nSaved Sessions:\n");
      const sessions = await SessionPersistence.list();
      if (sessions.length === 0) {
        console.log("  No sessions found.\n");
        return;
      }
      for (const session of sessions) {
        const date = new Date(session.createdAt).toLocaleString();
        console.log(`  ${session.id}`);
        console.log(`    Created: ${date}`);
        console.log(`    Directory: ${session.workingDirectory}`);
        console.log(`    Messages: ${session.messageCount}`);
        console.log("");
      }
      break;
    }

    case "show": {
      if (!options.sessionId) {
        console.error("Error: --id is required for show action");
        process.exit(1);
      }
      const session = await SessionPersistence.load(options.sessionId);
      if (!session) {
        console.error(`Session not found: ${options.sessionId}`);
        process.exit(1);
      }
      console.log("\nSession Details:\n");
      console.log(`  ID: ${session.id}`);
      console.log(`  Created: ${new Date(session.createdAt).toLocaleString()}`);
      console.log(`  Directory: ${session.workingDirectory}`);
      console.log(`  Model: ${session.fastModel}`);
      console.log(`  Deep Model: ${session.deepModel}`);
      console.log(`\n  Working Memory:`);
      console.log(`    Task: ${session.workingMemory.currentTask || "(none)"}`);
      console.log(`    Plan items: ${session.workingMemory.plan.length}`);
      console.log(`    Observations: ${session.workingMemory.observations.length}`);
      console.log("");
      break;
    }

    case "delete": {
      if (!options.sessionId) {
        console.error("Error: --id is required for delete action");
        process.exit(1);
      }
      const deleted = await SessionPersistence.delete(options.sessionId);
      if (deleted) {
        console.log(`Deleted session: ${options.sessionId}`);
      } else {
        console.error(`Session not found: ${options.sessionId}`);
        process.exit(1);
      }
      break;
    }
  }
}
