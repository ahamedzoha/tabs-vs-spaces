import Redis from "ioredis";
import { config } from "./config";

let client: Redis | null = null;

export async function connectRedis(): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    console.log("[Redis] Skipped (REDIS_URL not set)");
    return;
  }

  if (redis.status === "ready") {
    console.log("[Redis] Connected");
    return;
  }

  await redis.connect();
}

export function getRedis(): Redis | null {
  // Redis is optional, worker can still run without it
  if (!config.redis.url) return null;

  if (!client) {
    client = new Redis(config.redis.url, {
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 3000),
      maxRetriesPerRequest: 3,
    });

    client.on("connect", () => {
      console.log("[Redis] Connected");
    });

    client.on("error", (err) => {
      console.error("[Redis] Error:", err.message);
    });
  }
  return client;
}

// ─── Increment vote counters atomically ──────────────────────────────────────
export async function incrementCounters(
  votes: Array<{ choice: string }>,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const tabCount = votes.filter((v) => v.choice === "tabs").length;
  const spaceCount = votes.filter((v) => v.choice === "spaces").length;

  // Pipeline: send both commands in a single round-trip
  const pipeline = redis.pipeline();
  if (tabCount > 0) pipeline.incrby("votes:tabs", tabCount);
  if (spaceCount > 0) pipeline.incrby("votes:spaces", spaceCount);
  pipeline.set("votes:last_updated", new Date().toISOString());

  await pipeline.exec();
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
    console.log("[Redis] Disconnected");
  }
}
