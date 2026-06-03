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

    // CREATE TABLE IF NOT EXISTS is idempotent AND race-safe: if two workers
    // run this at the same time, the second one is a harmless no-op instead of
    // crashing with "relation already exists".
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${quoteIdent(tableName)} PARTITION OF votes FOR VALUES FROM (${quoteLiteral(startStr)}) TO (${quoteLiteral(endStr)})`,
    );

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

// ─── Authoritative vote counts (used to seed Redis on startup) ────────────────
// Counts straight from the `votes` table so the numbers are always current,
// even if the debounced `vote_totals` materialized view is briefly stale.
export async function getCountsByChoice(): Promise<Record<string, number>> {
  const result = await getPool().query<{ choice: string; total: string }>(
    "SELECT choice, COUNT(*)::bigint AS total FROM votes GROUP BY choice",
  );

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[row.choice] = Number(row.total);
  }
  return counts;
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
