import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import TelegramBot from "node-telegram-bot-api";
import { CompaniesFileSchema, type CompaniesFile } from "./types.js";
import { discover } from "./discovery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANIES_PATH = path.resolve(__dirname, "..", "companies.json");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

function loadCompanies(): CompaniesFile {
  const raw = fs.readFileSync(COMPANIES_PATH, "utf8");
  return CompaniesFileSchema.parse(JSON.parse(raw));
}

function saveCompanies(c: CompaniesFile): void {
  fs.writeFileSync(COMPANIES_PATH, JSON.stringify(c, null, 2) + "\n", "utf8");
}

function authorized(chatId: number | string): boolean {
  if (!ALLOWED_CHAT_ID) return true;
  return String(chatId) === String(ALLOWED_CHAT_ID);
}

bot.onText(/^\/start$|^\/help$/, (msg) => {
  if (!authorized(msg.chat.id)) return;
  bot.sendMessage(
    msg.chat.id,
    [
      "*job-watcher commands*",
      "/add <company> — auto-discover ATS and start watching",
      "/list — show watched companies",
      "/remove <company> — stop watching",
      "/help — this message",
    ].join("\n"),
    { parse_mode: "Markdown" }
  );
});

bot.onText(/^\/list/, (msg) => {
  if (!authorized(msg.chat.id)) return;
  const c = loadCompanies();
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
  await bot.sendMessage(msg.chat.id, `discovering ${name}…`);
  const r = await discover(name);
  if (!r.ok || !r.config) {
    await bot.sendMessage(msg.chat.id, `❌ couldn't add ${name}: ${r.reason ?? "unknown"}`);
    return;
  }
  const companies = loadCompanies();
  companies[name] = r.config;
  saveCompanies(companies);
  await bot.sendMessage(
    msg.chat.id,
    `✅ added *${name}* → ${r.config.ats}${r.config.slug ? ` (${r.config.slug})` : ""} — ${r.jobCount ?? "?"} open jobs`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/^\/remove\s+(.+)$/, async (msg, m) => {
  if (!authorized(msg.chat.id)) return;
  if (!m) return;
  const name = m[1].trim().toLowerCase();
  const companies = loadCompanies();
  if (!(name in companies)) {
    await bot.sendMessage(msg.chat.id, `not watching ${name}`);
    return;
  }
  delete companies[name];
  saveCompanies(companies);
  await bot.sendMessage(msg.chat.id, `removed ${name}`);
});

bot.on("polling_error", (e) => console.error("polling_error:", e.message));

console.log("job-watcher bot started, listening for commands…");
