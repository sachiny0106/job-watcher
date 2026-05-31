import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CompaniesFileSchema, type Job } from "./types.js";
import { getAdapter } from "./adapters/index.js";
import { getSeenIds, markSeen, logRun, closeDb } from "./state.js";
import { loadFilters, passesFilter } from "./filter.js";
import { notifyJobs, notifyText } from "./notifier.js";
import { loadProfile, scoreJobs, type FitVerdict } from "./llm-score.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANIES_PATH = path.resolve(__dirname, "..", "companies.json");
const CURSOR_PATH = path.resolve(__dirname, "..", ".cron-cursor");
const BATCH_SIZE = parseInt(process.env.CRON_BATCH_SIZE || "50", 10);

function loadCursor(): number {
  try {
    const n = parseInt(fs.readFileSync(CURSOR_PATH, "utf8").trim(), 10);
    return isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
function saveCursor(n: number): void {
  fs.writeFileSync(CURSOR_PATH, String(n) + "\n", "utf8");
}

async function main(): Promise<void> {
  const raw = fs.readFileSync(COMPANIES_PATH, "utf8");
  const allCompanies = CompaniesFileSchema.parse(JSON.parse(raw));
  const entries = Object.entries(allCompanies);
  const cursor = loadCursor() % Math.max(entries.length, 1);
  const end = Math.min(cursor + BATCH_SIZE, entries.length);
  const batch = entries.slice(cursor, end);
  const wrapNeeded = batch.length < BATCH_SIZE && entries.length > BATCH_SIZE;
  if (wrapNeeded) batch.push(...entries.slice(0, BATCH_SIZE - batch.length));
  const nextCursor = (cursor + BATCH_SIZE) % entries.length;
  const companies = Object.fromEntries(batch);
  console.log(
    `processing batch ${cursor}..${cursor + batch.length - 1} of ${entries.length} (next cursor will be ${nextCursor})`
  );
  const filters = loadFilters();

  const startedAt = Date.now();
  const allNew: Job[] = [];
  const pendingByWatch = new Map<string, Job[]>();
  let okCount = 0;
  let errCount = 0;

  for (const [name, config] of Object.entries(companies)) {
    try {
      const adapter = getAdapter(config.ats);
      const jobs = await adapter.fetch(config, name);
      const seen = getSeenIds(name);

      const fresh = jobs.filter((j) => !seen.has(j.id));
      const relevant = fresh.filter((j) => passesFilter(j, filters));
      const filteredOut = fresh.filter((j) => !relevant.includes(j));

      markSeen(name, filteredOut);

      const pending: Job[] = [];
      for (const j of relevant) {
        if (!allNew.some((existing) => existing.id === j.id)) allNew.push(j);
        pending.push(j);
      }
      if (pending.length > 0) pendingByWatch.set(name, pending);

      logRun(name, "ok");
      okCount++;
      console.log(
        `[${name}] ats=${config.ats} fetched=${jobs.length} new=${fresh.length} relevant=${relevant.length}`
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logRun(name, "error", msg);
      errCount++;
      console.error(`[${name}] FAILED: ${msg}`);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  let verdicts = new Map<string, FitVerdict>();
  const geminiKey = process.env.GOOGLE_API_KEY;
  if (geminiKey && allNew.length > 0) {
    console.log(`scoring ${allNew.length} candidates with Gemini…`);
    try {
      const profile = loadProfile();
      verdicts = await scoreJobs(allNew, profile, geminiKey);
      for (const j of allNew) {
        const v = verdicts.get(j.id);
        console.log(`  [${v?.fit ?? "?"}] ${j.title} @ ${j.company} — ${v?.reasoning ?? "(no verdict)"}`);
      }
    } catch (e: unknown) {
      console.warn("llm scoring failed:", e instanceof Error ? e.message : e);
    }
  } else if (!geminiKey) {
    console.log("GOOGLE_API_KEY not set — skipping AI fit check, sending all kept jobs");
  }

  const MIN_SCORE = 5;
  const toNotify = geminiKey
    ? allNew.filter((j) => {
        const v = verdicts.get(j.id);
        return v && v.fit !== "no" && v.score >= MIN_SCORE;
      })
    : allNew;
  if (geminiKey) {
    const dropped = allNew.length - toNotify.length;
    if (dropped > 0)
      console.log(
        `AI rejected/below-threshold ${dropped} candidate(s) (min score ${MIN_SCORE}); kept ${toNotify.length}`
      );
  }

  for (const [watchName, pending] of pendingByWatch) {
    let toMark: Job[];
    if (geminiKey) {
      toMark = pending.filter((j) => verdicts.get(j.id));
    } else {
      toMark = pending;
    }
    if (toMark.length > 0) markSeen(watchName, toMark);
    const retry = pending.length - toMark.length;
    if (retry > 0) console.log(`  [${watchName}] retaining ${retry} unscored job(s) for next run`);
  }

  if (toNotify.length > 0) {
    await notifyJobs(toNotify, verdicts);
  } else {
    console.log("no jobs passed AI fit check this tick");
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `done in ${elapsed}s — companies=${Object.keys(companies).length} ok=${okCount} err=${errCount} candidates=${allNew.length} notified=${toNotify.length}`
  );

  if (errCount > 0 && process.env.TELEGRAM_NOTIFY_ERRORS === "1") {
    await notifyText(`job-watcher: ${errCount} adapter error(s) this run`);
  }

  saveCursor(nextCursor);
  closeDb();
}

main().catch((e: unknown) => {
  console.error("FATAL:", e);
  process.exit(1);
});
