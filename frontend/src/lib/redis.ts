// Module-level singleton — Next.js hot reload can create multiple instances
// so we attach it to globalThis in development

import Redis from "ioredis";

declare global {
  // `var` is required here: global augmentation only works with `var`.
  var __redis: Redis | undefined;
}

function createClient(): Redis {
  const url = process.env.REDIS_URL;

  if (!url) {
    throw new Error("REDIS_URL environment variable is not set");
  }

  return new Redis(url, {
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 300, 5000),
    maxRetriesPerRequest: 3,
  });
}

export function getRedis(): Redis {
  if (process.env.NODE_ENV === "development") {
    if (!globalThis.__redis) {
      globalThis.__redis = createClient();
    }

    return globalThis.__redis;
  }

  return createClient();
}
