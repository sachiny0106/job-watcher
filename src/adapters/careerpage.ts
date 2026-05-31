import axios from "axios";
import "dotenv/config";
import type { Adapter, CompanyConfig, Job } from "../types.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

interface ExtractedJob {
  title: string;
  url: string;
  location?: string;
  postedAt?: string;
}

type Provider = { kind: "gemini" | "openai"; key: string };

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff;
  return (h >>> 0).toString(36);
}

function loadProviders(): Provider[] {
  const out: Provider[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== "string" || !v.trim()) continue;
    if (/^GOOGLE_API_KEY(_\d+)?$/i.test(k)) out.push({ kind: "gemini", key: v.trim() });
    else if (/^OPENAI_API_KEY(_\d+)?$/i.test(k)) out.push({ kind: "openai", key: v.trim() });
  }
  const seen = new Set<string>();
  return out.filter((p) => {
    const id = `${p.kind}:${p.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function shuffled<T>(arr: T[]): T[] {
  return arr
    .map((x) => [Math.random(), x] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, x]) => x);
}

const buildPrompt = (cleanText: string, baseUrl: string): string => `You are extracting open job postings from a company's careers page text.

PAGE TEXT (truncated):
${cleanText}

BASE URL: ${baseUrl}

Return strict JSON. Each item: {"title": "<job title>", "url": "<absolute url>", "location": "<city/country or empty>", "postedAt": "<iso date or empty>"}. If no jobs, return [].
Rules:
- Only include real job postings, not nav links or marketing copy.
- Skip duplicates.
- Resolve relative URLs against BASE URL.
- Cap at 100 entries.`;

async function callGemini(provider: Provider, prompt: string): Promise<string | null> {
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING" },
            url: { type: "STRING" },
            location: { type: "STRING" },
            postedAt: { type: "STRING" },
          },
          required: ["title", "url"],
        },
      },
      temperature: 0,
      maxOutputTokens: 20000,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const { data } = await axios.post<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(url, body, {
    timeout: 60_000,
    headers: { "Content-Type": "application/json", "X-goog-api-key": provider.key },
  });
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

async function callOpenAI(provider: Provider, prompt: string): Promise<string | null> {
  const body = {
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [
      { role: "system", content: "Reply with JSON {\"jobs\": [...]} where jobs is the array described by the user." },
      { role: "user", content: prompt },
    ],
  };
  const { data } = await axios.post<{ choices?: { message?: { content?: string } }[] }>(
    "https://api.openai.com/v1/chat/completions",
    body,
    {
      timeout: 60_000,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.key}` },
    }
  );
  const content = data.choices?.[0]?.message?.content ?? null;
  if (!content) return null;
  try {
    const obj = JSON.parse(content);
    if (Array.isArray(obj)) return JSON.stringify(obj);
    if (Array.isArray(obj?.jobs)) return JSON.stringify(obj.jobs);
    const firstArrayKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
    if (firstArrayKey) return JSON.stringify(obj[firstArrayKey]);
  } catch {
    // fall through
  }
  return content;
}

async function llmExtract(html: string, baseUrl: string): Promise<ExtractedJob[]> {
  const providers = shuffled(loadProviders());
  if (providers.length === 0) return [];
  const prompt = buildPrompt(stripHtml(html).slice(0, 25_000), baseUrl);

  let text: string | null = null;
  for (const p of providers) {
    const tag = `${p.kind} ${p.key.slice(0, 8)}…`;
    try {
      text = p.kind === "gemini" ? await callGemini(p, prompt) : await callOpenAI(p, prompt);
      if (text) break;
    } catch (err) {
      const ax = err as { response?: { status?: number }; message?: string };
      const status = ax?.response?.status;
      console.warn(`[careerpage] extract ${tag} failed status=${status} ${ax?.message ?? ""}`);
    }
  }
  if (!text) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    parsed = JSON.parse(m[0]);
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is ExtractedJob =>
    !!x && typeof (x as ExtractedJob).title === "string" && typeof (x as ExtractedJob).url === "string"
  );
}

async function renderWithPlaywright(url: string, waitFor?: string): Promise<string> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      // dom may have partially loaded; continue
    }
    if (waitFor) {
      try {
        await page.waitForSelector(waitFor, { timeout: 15_000 });
      } catch {
        // continue
      }
    } else {
      await page.waitForTimeout(3500);
    }
    return await page.content();
  } finally {
    await browser.close();
  }
}

export const careerpageAdapter: Adapter = {
  kind: "careerpage" as never,
  async fetch(config: CompanyConfig, company: string): Promise<Job[]> {
    const url = config.url;
    if (!url) throw new Error(`careerpage adapter needs 'url' for ${company}`);

    let html: string;
    if (config.renderJs) {
      console.log(`[careerpage] ${company}: rendering ${url} with playwright…`);
      html = await renderWithPlaywright(url, config.waitFor);
    } else {
      const { data } = await axios.get<string>(url, {
        timeout: 25_000,
        maxRedirects: 5,
        headers: { "User-Agent": UA, Accept: "text/html,*/*" },
        responseType: "text",
        transformResponse: (d) => d,
      });
      html = typeof data === "string" ? data : String(data);
    }

    const extracted = await llmExtract(html, url);
    return extracted.map((j) => ({
      id: `cp-${hash(j.url || j.title)}`,
      company,
      title: j.title,
      location: j.location ?? "",
      postedAt: j.postedAt && j.postedAt.length >= 8 ? j.postedAt : new Date().toISOString(),
      url: j.url,
      snippet: "",
      description: "",
      source: "careerpage",
    }));
  },
};
