import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import { CompaniesFileSchema, type CompaniesFile } from "./types.js";
import { discover } from "./discovery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANIES_PATH = path.resolve(__dirname, "..", "companies.json");
const OFFSET_PATH = path.resolve(__dirname, "..", ".telegram-offset");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
}

function loadOffset(): number {
  try {
    return parseInt(fs.readFileSync(OFFSET_PATH, "utf8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}
function saveOffset(n: number): void {
  fs.writeFileSync(OFFSET_PATH, String(n) + "\n", "utf8");
}

function loadCompanies(): CompaniesFile {
  return CompaniesFileSchema.parse(JSON.parse(fs.readFileSync(COMPANIES_PATH, "utf8")));
}
function saveCompanies(c: CompaniesFile): void {
  fs.writeFileSync(COMPANIES_PATH, JSON.stringify(c, null, 2) + "\n", "utf8");
}

async function send(chatId: number, text: string): Promise<void> {
  try {
    await axios.post(`${API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.warn("[bot-poll] send failed:", e instanceof Error ? e.message : e);
  }
}

function authorized(chatId: number): boolean {
  if (!ALLOWED_CHAT_ID) return true;
  return String(chatId) === String(ALLOWED_CHAT_ID);
}

async function handleCommand(text: string, chatId: number): Promise<void> {
  const trimmed = text.trim();

  if (/^\/(start|help)\b/i.test(trimmed)) {
    await send(
      chatId,
      [
        "*job-watcher commands*",
        "/add <company> — auto-discover ATS and watch",
        "/list — show watched companies",
        "/remove <company> — stop watching",
        "/help — this message",
        "",
        "_runs every ~5 min via GitHub Actions_",
      ].join("\n")
    );
    return;
  }

  if (/^\/list\b/i.test(trimmed)) {
    const c = loadCompanies();
    const names = Object.keys(c).sort();
    if (names.length === 0) {
      await send(chatId, "no companies watched yet");
      return;
    }
    const chunks: string[] = [];
    let current = `*Watching ${names.length}:*\n`;
    for (const n of names) {
      const line = `• ${n} (${c[n].ats}${c[n].slug ? `: ${c[n].slug}` : ""})\n`;
      if (current.length + line.length > 3500) {
        chunks.push(current);
        current = "";
      }
      current += line;
    }
    if (current) chunks.push(current);
    for (const chunk of chunks) await send(chatId, chunk);
    return;
  }

  const addMatch = trimmed.match(/^\/add\s+(.+)$/i);
  if (addMatch) {
    const name = addMatch[1].trim().toLowerCase();
    await send(chatId, `🔎 discovering *${name}*…`);
    const r = await discover(name);
    if (!r.ok || !r.config) {
      await send(chatId, `❌ couldn't add *${name}*: ${r.reason ?? "unknown"}`);
      return;
    }
    const companies = loadCompanies();
    if (companies[name]) {
      await send(chatId, `ℹ️ *${name}* already in watchlist (${companies[name].ats})`);
      return;
    }
    companies[name] = r.config;
    saveCompanies(companies);
    const tail = r.config.slug
      ? `: ${r.config.slug}`
      : r.config.tenant
      ? `: ${r.config.tenant}/${r.config.site}`
      : "";
    await send(
      chatId,
      `✅ added *${name}* → ${r.config.ats}${tail} — ${r.jobCount ?? "?"} open jobs\n📤 will be picked up by next hourly cron`
    );
    return;
  }

  const removeMatch = trimmed.match(/^\/remove\s+(.+)$/i);
  if (removeMatch) {
    const name = removeMatch[1].trim().toLowerCase();
    const companies = loadCompanies();
    if (!(name in companies)) {
      await send(chatId, `not watching *${name}*`);
      return;
    }
    delete companies[name];
    saveCompanies(companies);
    await send(chatId, `🗑️ removed *${name}*`);
    return;
  }

  if (trimmed.startsWith("/")) {
    await send(chatId, "unknown command. try /help");
  }
}

async function main(): Promise<void> {
  const offset = loadOffset();
  let lastUpdateId = offset;
  try {
    const { data } = await axios.get<{ ok: boolean; result: TgUpdate[] }>(`${API}/getUpdates`, {
      params: { offset: offset || undefined, timeout: 0, limit: 50 },
      timeout: 15_000,
    });
    if (!data.ok) {
      console.warn("[bot-poll] getUpdates not ok");
      return;
    }
    const updates = data.result;
    console.log(`[bot-poll] ${updates.length} pending updates (offset=${offset})`);

    for (const u of updates) {
      lastUpdateId = Math.max(lastUpdateId, u.update_id);
      const msg = u.message;
      if (!msg || !msg.text) continue;
      if (!authorized(msg.chat.id)) {
        console.log(`[bot-poll] ignored msg from chat ${msg.chat.id} (not authorized)`);
        continue;
      }
      try {
        await handleCommand(msg.text, msg.chat.id);
      } catch (e) {
        console.error("[bot-poll] command error:", e instanceof Error ? e.message : e);
      }
    }

    if (lastUpdateId > offset) saveOffset(lastUpdateId + 1);
  } catch (e) {
    console.error("[bot-poll] fatal:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
