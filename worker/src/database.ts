import { Pool, PoolClient } from "pg";
import { config } from "./config";

let pool: Pool;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.postgres.connectionString,
      max: config.postgres.poolMax,
      idleTimeoutMillis: config.postgres.idleTimeoutMs,
      connectionTimeoutMillis: config.postgres.connectionTimeoutMs,
    });

    pool.on("error", (err) => {
      console.error("PostgreSQL pool error:", err);
    });

    pool.on("connect", () => {
      console.log("PostgreSQL pool connected");
    });
  }

  return pool;
}

// ─── Ensure tomorrow's partition exists ──────────────────────────────────────
// Called once at startup and then at midnight via the worker scheduler
export async function ensurePartitionExists(date: Date): Promise<void> {
  const client: PoolClient = await getPool().connect();

  try {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();

    const tableName = `votes_${formatUtcDate(y, m, d)}`;
    const startStr = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    const end = new Date(Date.UTC(y, m, d + 1));
    const endStr = `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;

    const exists = await client.query<{ exists: number }>(
      `SELECT 1 AS exists FROM pg_tables WHERE schemaname = 'public' AND tablename = $1`,
      [tableName],
    );

    if (exists.rowCount === 0) {
      await client.query(
        `CREATE TABLE ${quoteIdent(tableName)} PARTITION OF votes FOR VALUES FROM (${quoteLiteral(startStr)}) TO (${quoteLiteral(endStr)})`,
      );
    }

    console.log(`[DB] partition ensured: ${tableName}`);
  } catch (error) {
    console.error("Error ensuring partition exists:", error);
    throw error;
  } finally {
    client.release();
  }
}

// ─── Batch insert ─────────────────────────────────────────────────────────────
export interface VoteRecord {
  choice: string;
  user_id: string;
  zone?: string;
  timestamp?: string;
}

export async function batchInsertVotes(
  votes: VoteRecord[],
  workerId: string,
): Promise<number> {
  if (votes.length === 0) return 0;

  const pool = getPool();

  // Build parameterized query:
  // INSERT INTO votes (choice, user_id, zone, worker_id, created_at)
  // VALUES ($1,$2,$3,$4,$5), ($6,$7,$8,$9,$10), ...
  const values: unknown[] = [];
  const placeholders = votes.map((vote, i) => {
    const base = i * 5;
    values.push(
      vote.choice,
      vote.user_id,
      vote.zone ?? "unknown",
      workerId,
      vote.timestamp ? new Date(vote.timestamp) : new Date(),
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });

  const query = `
      INSERT INTO votes (choice, user_id, zone, worker_id, created_at)
      VALUES ${placeholders.join(", ")}
      ON CONFLICT DO NOTHING
    `;

  const result = await pool.query(query, values);
  return result.rowCount ?? 0;
}

// ─── Refresh materialized view for frontend reads ────────────────────────────
export async function refreshTotals(): Promise<void> {
  await getPool().query("REFRESH MATERIALIZED VIEW CONCURRENTLY vote_totals");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatUtcDate(y: number, m: number, d: number): string {
  return `${y}_${pad2(m + 1)}_${pad2(d)}`;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
