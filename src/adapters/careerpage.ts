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

function loadKeys(): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (/^GOOGLE_API_KEY(_\d+)?$/i.test(k) && typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return Array.from(new Set(out));
}

async function geminiExtract(html: string, baseUrl: string): Promise<ExtractedJob[]> {
  const keys = loadKeys();
  if (keys.length === 0) return [];
  const key = keys[Math.floor(Math.random() * keys.length)];

  const trimmed = stripHtml(html).slice(0, 25_000);
  const prompt = `You are extracting open job postings from a company's careers page text. The page may have been server-rendered HTML or scraped from a JS app.

PAGE TEXT (truncated):
${trimmed}

BASE URL: ${baseUrl}

Return a strict JSON array. Each item: {"title": "<job title>", "url": "<absolute url to apply or details>", "location": "<city/country if found, else empty>", "postedAt": "<iso date if found, else empty>"}. If the page does not list jobs, return [].
Rules:
- Only include real job postings, not nav links or marketing copy.
- Skip duplicates.
- Resolve relative URLs against BASE URL.
- Cap at 100 entries.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
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
  try {
    const { data } = await axios.post<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(url, body, {
      timeout: 60_000,
      headers: { "Content-Type": "application/json" },
    });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
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
    return parsed.filter((x): x is ExtractedJob => !!x && typeof (x as ExtractedJob).title === "string" && typeof (x as ExtractedJob).url === "string");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[careerpage] gemini extract failed: ${msg}`);
    return [];
  }
}

export const careerpageAdapter: Adapter = {
  kind: "careerpage" as never,
  async fetch(config: CompanyConfig, company: string): Promise<Job[]> {
    const url = (config as CompanyConfig & { url?: string }).url;
    if (!url) throw new Error(`careerpage adapter needs 'url' for ${company}`);

    const { data: html } = await axios.get<string>(url, {
      timeout: 25_000,
      maxRedirects: 5,
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      responseType: "text",
      transformResponse: (d) => d,
    });

    const extracted = await geminiExtract(typeof html === "string" ? html : String(html), url);
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
