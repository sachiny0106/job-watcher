import axios from "axios";
import "dotenv/config";
import type { Job } from "./types.js";
import type { FitVerdict } from "./llm-score.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const MAX_PER_MESSAGE = 8;

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatCard(job: Job, verdict?: FitVerdict): string {
  const age = timeAgo(job.postedAt);
  const loc = job.location ? ` · ${esc(job.location)}` : "";
  const meta = age ? ` · ${age}` : "";
  const head = `<b><a href="${job.url}">${esc(job.title)}</a></b>\n${esc(job.company)}${loc}${meta}`;
  if (!verdict) return head;
  const emoji = verdict.fit === "yes" ? "✅" : verdict.fit === "maybe" ? "🟡" : "❌";
  return `${head}\n${emoji} <i>${verdict.score}/10 — ${esc(verdict.reasoning)}</i>`;
}

async function send(text: string): Promise<void> {
  if (!TOKEN || !CHAT_ID) {
    console.warn("[notifier] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — skipping send");
    console.log("[notifier] would send:\n", text);
    return;
  }
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

export async function notifyJobs(jobs: Job[], verdicts?: Map<string, FitVerdict>): Promise<void> {
  if (jobs.length === 0) return;

  const ranked = [...jobs].sort((a, b) => {
    const av = verdicts?.get(a.id);
    const bv = verdicts?.get(b.id);
    const score = (v?: FitVerdict) =>
      v ? (v.fit === "yes" ? 1000 + v.score : v.fit === "maybe" ? 100 + v.score : v.score) : 0;
    return score(bv) - score(av);
  });

  const byCompany = new Map<string, Job[]>();
  for (const j of ranked) {
    if (!byCompany.has(j.company)) byCompany.set(j.company, []);
    byCompany.get(j.company)!.push(j);
  }

  for (const [company, list] of byCompany) {
    const visible = list.slice(0, MAX_PER_MESSAGE);
    const overflow = list.length - visible.length;
    const header = `<b>${esc(company)}</b> — ${list.length} new job${list.length === 1 ? "" : "s"}`;
    const cards = visible.map((j) => formatCard(j, verdicts?.get(j.id))).join("\n\n");
    const footer = overflow > 0 ? `\n\n… and ${overflow} more` : "";
    await send(`${header}\n\n${cards}${footer}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function notifyText(text: string): Promise<void> {
  await send(text);
}
