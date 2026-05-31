# job-watcher

Self-hosted agent that monitors company career pages and job boards, filters by keywords/location, and pushes new postings to Telegram.

## What it does

- Polls a watchlist of companies hourly via GitHub Actions cron
- Uses ATS APIs directly (Greenhouse, Lever, Ashby, Workday, SmartRecruiters) — no HTML scraping
- Hits internal JSON endpoints for big-tech (Microsoft, Amazon, Google, Apple, Meta)
- Searches Indian job boards (Instahyre, Naukri) by query
- Diffs against SQLite state so you only get notified about new postings
- Filters by include/exclude keywords, location, max age
- Sends Telegram cards grouped by company

## Quick start

```powershell
cd c:\Users\Asus\job-watcher
npm install
copy .env.example .env
# edit .env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
npm run cron
```

The default `companies.json` ships with Stripe / Airbnb / Coinbase (Greenhouse), Netflix (Lever), Ramp (Ashby).

## Getting a Telegram bot token

1. DM `@BotFather` on Telegram → `/newbot` → follow prompts → copy the token into `TELEGRAM_BOT_TOKEN`.
2. Start a chat with your new bot, send any message.
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` → find `chat.id` → copy into `TELEGRAM_CHAT_ID`.

## Interactive bot (optional)

To add companies via Telegram instead of editing `companies.json`:

```powershell
npm run bot
```

Then DM your bot:
- `/add coinbase` — auto-detects ATS and starts watching
- `/list` — shows watched companies
- `/remove coinbase` — stops watching
- `/help` — list commands

`bot.ts` writes to local `companies.json`. To make changes from your phone reach GH Actions, host the bot on a small VPS (Fly.io free tier, Hetzner $5/mo) and have it `git push` after each edit.

## Customizing filters

Edit [filters.json](filters.json):
- `include` — at least one keyword must match the job title/location/snippet
- `exclude` — any match disqualifies the job
- `locations` — at least one must appear in the job's location
- `maxAgeDays` — drop jobs older than N days

## Adapter coverage

| ATS | Companies covered |
|---|---|
| greenhouse | Stripe, Airbnb, Coinbase, Discord, Notion, Plaid, … |
| lever | Netflix, Brex, KAYAK, … |
| ashby | Ramp, Linear, Vanta, … |
| workday | Adobe, Salesforce, Nvidia, Visa, JPMorgan, … |
| smartrecruiters | Bosch, McDonald's, Visa, … |
| microsoft / amazon / google / apple / meta | each big-tech site's internal JSON endpoint |
| instahyre / naukri | search-query-based, configure via `searches.json` |

## Adding a Workday company manually

Workday companies need three fields. Visit their careers page and read the URL:

```
https://adobe.wd5.myworkdayjobs.com/external_experienced
        └─tenant─┘└cluster┘                  └────site────┘
```

Then in `companies.json`:

```json
"adobe": { "ats": "workday", "tenant": "adobe", "cluster": "wd5", "site": "external_experienced" }
```

## GitHub Actions deployment

1. Push this repo to GitHub (private is fine).
2. Settings → Secrets → Actions → add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, optionally `ANTHROPIC_API_KEY`.
3. Actions → enable workflows.
4. The cron runs hourly. Each run commits `state.sqlite` + any `companies.json` changes back to `main`.

## Caveats

- **Indeed / LinkedIn / Google Jobs** are intentionally not direct-scraped. They block aggressively. If you want them, use the SerpAPI path (paid, see plan file).
- **Naukri** fingerprints aggressively. Use 1-hour cadence, don't parallelize.
- **State.sqlite** is committed back to the repo. After ~100k seen jobs, migrate to a remote DB (Turso/Supabase).
