import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import TelegramBot from "node-telegram-bot-api";
import { CompaniesFileSchema, type CompaniesFile } from "./types.js";
import { discover } from "./discovery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANIES_PATH = path.resolve(__dirname, "..", "companies.json");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

async function loadCompanies(): Promise<CompaniesFile> {
  if (process.env.COMPANIES_FROM_GITHUB === "1" && GITHUB_REPO) {
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/companies.json`;
    try {
      const { data } = await axios.get<unknown>(url, { timeout: 10_000, responseType: "json" });
      return CompaniesFileSchema.parse(data);
    } catch (e) {
      console.warn("[bot] failed to fetch companies.json from GitHub, falling back to local file:", e instanceof Error ? e.message : e);
    }
  }
  const raw = fs.readFileSync(COMPANIES_PATH, "utf8");
  return CompaniesFileSchema.parse(JSON.parse(raw));
}

function saveCompaniesLocal(c: CompaniesFile): string {
  const text = JSON.stringify(c, null, 2) + "\n";
  fs.writeFileSync(COMPANIES_PATH, text, "utf8");
  return text;
}

async function pushToGitHub(text: string, message: string): Promise<{ ok: boolean; detail: string }> {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return { ok: false, detail: "GITHUB_TOKEN / GITHUB_REPO not set" };
  const api = `https://api.github.com/repos/${GITHUB_REPO}/contents/companies.json`;
  try {
    const get = await axios.get<{ sha: string }>(`${api}?ref=${GITHUB_BRANCH}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "job-watcher-bot",
      },
    });
    const sha = get.data.sha;
    const contentB64 = Buffer.from(text, "utf8").toString("base64");
    await axios.put(
      api,
      { message, content: contentB64, branch: GITHUB_BRANCH, sha },
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "job-watcher-bot",
        },
      }
    );
    return { ok: true, detail: `pushed to ${GITHUB_REPO}@${GITHUB_BRANCH}` };
  } catch (e) {
    const ax = e as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status = ax?.response?.status ?? "?";
    const msg = ax?.response?.data?.message ?? ax?.message ?? "unknown";
    return { ok: false, detail: `github API ${status}: ${msg}` };
  }
}

function authorized(chatId: number | string): boolean {
  if (!ALLOWED_CHAT_ID) return true;
  return String(chatId) === String(ALLOWED_CHAT_ID);
}

bot.onText(/^\/start$|^\/help$/, (msg) => {
  if (!authorized(msg.chat.id)) return;
  const githubLine = GITHUB_TOKEN && GITHUB_REPO
    ? `_Auto-push: ✅ ${GITHUB_REPO}_`
    : "_Auto-push: ❌ (set GITHUB\\_TOKEN + GITHUB\\_REPO in .env)_";
  bot.sendMessage(
    msg.chat.id,
    [
      "*job-watcher commands*",
      "/add <company> — auto-discover ATS and start watching",
      "/list — show watched companies",
      "/remove <company> — stop watching",
      "/help — this message",
      "",
      githubLine,
    ].join("\n"),
    { parse_mode: "Markdown" }
  );
});

bot.onText(/^\/list/, async (msg) => {
  if (!authorized(msg.chat.id)) return;
  const c = await loadCompanies();
  const names = Object.keys(c).sort();
  if (names.length === 0) {
    bot.sendMessage(msg.chat.id, "no companies watched yet — try /add stripe");
    return;
  }
  const lines = names.map((n) => `• ${n} (${c[n].ats}${c[n].slug ? `: ${c[n].slug}` : ""})`);
  bot.sendMessage(msg.chat.id, `*Watching ${names.length}:*\n${lines.join("\n")}`, {
    parse_mode: "Markdown",
  });
});

bot.onText(/^\/add\s+(.+)$/, async (msg, m) => {
  if (!authorized(msg.chat.id)) return;
  if (!m) return;
  const name = m[1].trim().toLowerCase();
  await bot.sendMessage(msg.chat.id, `🔎 discovering *${name}*…`, { parse_mode: "Markdown" });
  const r = await discover(name);
  if (!r.ok || !r.config) {
    await bot.sendMessage(msg.chat.id, `❌ couldn't add ${name}: ${r.reason ?? "unknown"}`);
    return;
  }
  const companies = await loadCompanies();
  companies[name] = r.config;
  const text = saveCompaniesLocal(companies);
  const slugBit = r.config.slug
    ? `: ${r.config.slug}`
    : r.config.tenant
    ? `: ${r.config.tenant}/${r.config.site}`
    : "";
  let line = `✅ added *${name}* → ${r.config.ats}${slugBit} — ${r.jobCount ?? "?"} open jobs`;
  const push = await pushToGitHub(text, `chore: /add ${name} via bot`);
  line += `\n${push.ok ? "📤 " + push.detail : "💾 saved locally only (" + push.detail + ")"}`;
  await bot.sendMessage(msg.chat.id, line, { parse_mode: "Markdown" });
});

bot.onText(/^\/remove\s+(.+)$/, async (msg, m) => {
  if (!authorized(msg.chat.id)) return;
  if (!m) return;
  const name = m[1].trim().toLowerCase();
  const companies = await loadCompanies();
  if (!(name in companies)) {
    await bot.sendMessage(msg.chat.id, `not watching ${name}`);
    return;
  }
  delete companies[name];
  const text = saveCompaniesLocal(companies);
  let line = `🗑️ removed *${name}*`;
  const push = await pushToGitHub(text, `chore: /remove ${name} via bot`);
  line += `\n${push.ok ? "📤 " + push.detail : "💾 saved locally only (" + push.detail + ")"}`;
  await bot.sendMessage(msg.chat.id, line, { parse_mode: "Markdown" });
});

bot.on("polling_error", (e) => console.error("polling_error:", e.message));

console.log("job-watcher bot started, listening for commands…");
if (GITHUB_TOKEN && GITHUB_REPO) {
  console.log(`auto-push enabled → ${GITHUB_REPO}@${GITHUB_BRANCH}`);
} else {
  console.log("auto-push disabled — set GITHUB_TOKEN + GITHUB_REPO in .env to enable");
}
