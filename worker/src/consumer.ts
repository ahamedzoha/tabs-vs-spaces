import * as amqp from "amqp-connection-manager";
import { ChannelWrapper } from "amqp-connection-manager";
import { ConsumeMessage } from "amqplib";
import { config } from "./config";
import { batchInsertVotes, refreshTotals, VoteRecord } from "./database";

export class VoteConsumer {
  private connection!: amqp.AmqpConnectionManager;
  private channelWrapper!: ChannelWrapper;

  // ─── In-memory batch ───────────────────────────────────────────────────────
  private batch: VoteRecord[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  // ─── Stats ─────────────────────────────────────────────────────────────────
  private totalProcessed = 0;
  private flushCount = 0;
  private totalsRefreshTimer: NodeJS.Timeout | null = null;
  private static readonly TOTALS_REFRESH_DEBOUNCE_MS = 2_000;

  constructor() {}

  async start(): Promise<void> {
    const { url, queue, exchange, routingKey, prefetch } = config.rabbitmq;
    const workerId = config.worker.id;

    console.log(`[Consumer] Starting worker: ${workerId}`);
    console.log(
      `[Consumer] Batch size: ${config.worker.batchSize}, timeout: ${config.worker.batchTimeoutMs}ms`,
    );

    // ─── Connection (auto-reconnects on failure) ───────────────────────────
    this.connection = amqp.connect([url], {
      heartbeatIntervalInSeconds: 5,
      reconnectTimeInSeconds: 3,
    });

    this.connection.on("connect", () =>
      console.log("[Consumer] Connected to RabbitMQ"),
    );
    this.connection.on("disconnect", ({ err }) =>
      console.error("[Consumer] Disconnected:", err?.message),
    );

    // ─── Channel setup ─────────────────────────────────────────────────────
    this.channelWrapper = this.connection.createChannel({
      json: false, // We'll parse manually for control
      setup: async (channel: amqp.Channel) => {
        // Mirror what the API declared so topology is consistent
        await channel.assertExchange(exchange, "topic", { durable: true });
        await channel.assertQueue(queue, { durable: true });
        await channel.bindQueue(queue, exchange, routingKey);

        // Only pull `prefetch` messages at once — backpressure control
        await channel.prefetch(prefetch);

        // Start consuming
        await channel.consume(queue, (msg) => this.handleMessage(msg, channel));

        console.log(`[Consumer] Listening on queue: ${queue}`);
      },
    });

    // ─── Partition check scheduler ─────────────────────────────────────────
    // Every hour, ensure next day's partition exists (safe to call repeatedly)
    setInterval(() => this.checkUpcomingPartition(), 60 * 60 * 1000);
  }

  // ─── Per-message handler ───────────────────────────────────────────────────
  private handleMessage(
    msg: ConsumeMessage | null,
    channel: amqp.Channel,
  ): void {
    if (!msg) return;

    try {
      const vote = JSON.parse(msg.content.toString()) as VoteRecord;

      // Add to batch
      this.batch.push(vote);

      // ACK immediately — high throughput mode
      // Trade-off: messages in batch could be lost if process crashes before flush
      // For financial systems, move ACK to after DB write (with idempotency keys)
      channel.ack(msg);

      // Flush if batch is full
      if (this.batch.length >= config.worker.batchSize) {
        this.flush("batch-full");
      } else {
        // Otherwise reset the timeout so we don't wait forever on a partial batch
        this.resetTimer();
      }
    } catch (err) {
      console.error("[Consumer] Failed to parse message:", err);
      channel.nack(msg, false, false); // Dead-letter — don't requeue garbage
    }
  }

  // ─── Flush mechanics ───────────────────────────────────────────────────────
  private resetTimer(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(
      () => this.flush("timeout"),
      config.worker.batchTimeoutMs,
    );
  }

  private flush(reason: "batch-full" | "timeout"): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Drain current batch, reset immediately so new messages accumulate
    const toFlush = this.batch.splice(0);

    if (toFlush.length === 0) return;
    if (this.isFlushing) {
      // Previous flush still running — put messages back (rare under normal load)
      this.batch.unshift(...toFlush);
      return;
    }

    this.isFlushing = true;

    this.flushToDb(toFlush, reason).finally(() => {
      this.isFlushing = false;

      // If new messages arrived while we were flushing, check if we should flush again
      if (this.batch.length >= config.worker.batchSize) {
        this.flush("batch-full");
      }
    });
  }

  private async flushToDb(votes: VoteRecord[], reason: string): Promise<void> {
    const start = Date.now();

    try {
      const inserted = await batchInsertVotes(votes, config.worker.id);
      const duration = Date.now() - start;

      this.totalProcessed += inserted;
      this.flushCount++;

      console.log(
        `[Consumer] Flushed ${inserted}/${votes.length} votes | ` +
          `reason=${reason} | ${duration}ms | ` +
          `total=${this.totalProcessed} | flushes=${this.flushCount}`,
      );

      if (inserted > 0) {
        this.scheduleTotalsRefresh();
      }
    } catch (err) {
      console.error("[Consumer] DB flush failed:", err);
      // In production: push to dead-letter queue or write to local file as fallback
    }
  }

  private scheduleTotalsRefresh(): void {
    if (this.totalsRefreshTimer) clearTimeout(this.totalsRefreshTimer);
    this.totalsRefreshTimer = setTimeout(() => {
      this.totalsRefreshTimer = null;
      refreshTotals().catch((err) =>
        console.warn("[Consumer] View refresh failed:", err.message),
      );
    }, VoteConsumer.TOTALS_REFRESH_DEBOUNCE_MS);
  }

  private async flushTotalsRefresh(): Promise<void> {
    if (this.totalsRefreshTimer) {
      clearTimeout(this.totalsRefreshTimer);
      this.totalsRefreshTimer = null;
    }
    await refreshTotals().catch((err) =>
      console.warn("[Consumer] View refresh failed:", err.message),
    );
  }

  // ─── Partition management ──────────────────────────────────────────────────
  private async checkUpcomingPartition(): Promise<void> {
    const { ensurePartitionExists } = await import("./database");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await ensurePartitionExists(tomorrow).catch((err) =>
      console.error("[Consumer] Partition check failed:", err.message),
    );
  }

  // ─── Graceful shutdown ─────────────────────────────────────────────────────
  async stop(): Promise<void> {
    console.log("[Consumer] Shutting down gracefully...");

    // Flush any remaining batch
    if (this.batch.length > 0) {
      await this.flushToDb(this.batch.splice(0), "shutdown");
    }

    await this.flushTotalsRefresh();

    await this.channelWrapper.close();
    await this.connection.close();
    console.log("[Consumer] Shutdown complete");
  }
}
