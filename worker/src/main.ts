import { VoteConsumer } from "./consumer";
import { ensurePartitionExists, getPool } from "./database";

async function bootstrap() {
  console.log("[Main] Tabs vs Spaces — Vote Worker");
  console.log("[Main] ─────────────────────────────");

  // ─── Wait for PostgreSQL to be ready ──────────────────────────────────────
  let dbReady = false;
  let retries = 0;
  while (!dbReady && retries < 10) {
    try {
      await getPool().query("SELECT 1");
      dbReady = true;
      console.log("[Main] PostgreSQL connected");
    } catch (err) {
      retries++;
      console.log(`[Main] Waiting for PostgreSQL... (attempt ${retries}/10)`);
      await sleep(2000);
    }
  }

  if (!dbReady) {
    console.error(
      "[Main] Could not connect to PostgreSQL after 10 attempts. Exiting.",
    );
    process.exit(1);
  }

  // ─── Ensure today's and tomorrow's partitions exist ───────────────────────
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  await ensurePartitionExists(today);
  await ensurePartitionExists(tomorrow);

  // ─── Start consumer ───────────────────────────────────────────────────────
  const consumer = new VoteConsumer();
  await consumer.start();

  // ─── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[Main] Received ${signal}. Flushing and shutting down...`);
    await consumer.stop();
    await getPool().end();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  console.log("[Main] Worker is running. Press Ctrl+C to stop.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

bootstrap().catch((err) => {
  console.error("[Main] Fatal error:", err);
  process.exit(1);
});
