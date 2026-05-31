import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "..", "state.sqlite");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS seen_jobs (
    id            TEXT NOT NULL,
    company       TEXT NOT NULL,
    posted_at     TEXT,
    first_seen_at TEXT NOT NULL,
    PRIMARY KEY (id, company)
  );

  CREATE TABLE IF NOT EXISTS run_log (
    company         TEXT PRIMARY KEY,
    last_checked_at TEXT NOT NULL,
    last_status     TEXT,
    last_error      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_seen_company ON seen_jobs(company);
`);

const insertSeen = db.prepare(
  `INSERT OR IGNORE INTO seen_jobs (id, company, posted_at, first_seen_at)
   VALUES (@id, @company, @posted_at, @first_seen_at)`
);

const selectSeenIds = db.prepare(
  `SELECT id FROM seen_jobs WHERE company = ?`
);

const upsertRunLog = db.prepare(
  `INSERT INTO run_log (company, last_checked_at, last_status, last_error)
   VALUES (@company, @last_checked_at, @last_status, @last_error)
   ON CONFLICT(company) DO UPDATE SET
     last_checked_at = excluded.last_checked_at,
     last_status     = excluded.last_status,
     last_error      = excluded.last_error`
);

export function getSeenIds(company: string): Set<string> {
  const rows = selectSeenIds.all(company) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

export function markSeen(
  company: string,
  jobs: { id: string; postedAt?: string }[]
) {
  const now = new Date().toISOString();
  const tx = db.transaction((items: typeof jobs) => {
    for (const j of items) {
      insertSeen.run({
        id: j.id,
        company,
        posted_at: j.postedAt ?? null,
        first_seen_at: now,
      });
    }
  });
  tx(jobs);
}

export function logRun(
  company: string,
  status: "ok" | "error",
  error?: string
) {
  upsertRunLog.run({
    company,
    last_checked_at: new Date().toISOString(),
    last_status: status,
    last_error: error ?? null,
  });
}

export function closeDb() {
  db.close();
}
