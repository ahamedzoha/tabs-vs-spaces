import * as dotenv from "dotenv";
dotenv.config({ quiet: true });

export const config = {
  rabbitmq: {
    url: process.env.RABBITMQ_URL || "amqp://admin:secret@localhost:5672",
    queue: process.env.RABBITMQ_QUEUE || "votes.queue",
    exchange: process.env.RABBITMQ_EXCHANGE || "votes.exchange",
    routingKey: process.env.RABBITMQ_ROUTING_KEY || "vote.cast",
    prefetch: parseInt(process.env.RABBITMQ_PREFETCH || "100", 10),
  },
  postgres: {
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://voteuser:votepass@localhost:5432/votes",
    poolMax: 10,
    idleTimeoutMs: 30_000,
    connectionTimeoutMs: 5_000,
  },
  worker: {
    id: process.env.WORKER_ID || `worker-${process.pid}`,
    batchSize: parseInt(process.env.BATCH_SIZE || "100", 10),
    batchTimeoutMs: parseInt(process.env.BATCH_TIMEOUT_MS || "1000", 10),
  },
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },
};
