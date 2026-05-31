import "dotenv/config";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import type { AtsKind, CompanyConfig } from "./types.js";
import { getAdapter } from "./adapters/index.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export interface DiscoveryResult {
  ok: boolean;
  config?: CompanyConfig;
  reason?: string;
  jobCount?: number;
}

const BIG_TECH: Record<string, AtsKind> = {
  microsoft: "microsoft",
  amazon: "amazon",
  google: "google",
  apple: "apple",
  meta: "meta",
  facebook: "meta",
};

const DETECTORS: { ats: AtsKind; rx: RegExp; extract: (m: RegExpMatchArray) => Partial<CompanyConfig> }[] = [
  { ats: "greenhouse",      rx: /boards\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w.-]+)/i,                extract: (m) => ({ slug: m[1] }) },
  { ats: "greenhouse",      rx: /job-boards\.greenhouse\.io\/([\w.-]+)/i,                                       extract: (m) => ({ slug: m[1] }) },
  { ats: "lever",           rx: /jobs\.lever\.co\/([\w.-]+)/i,                                                  extract: (m) => ({ slug: m[1] }) },
  { ats: "ashby",           rx: /jobs\.ashbyhq\.com\/([\w.-]+)/i,                                               extract: (m) => ({ slug: m[1] }) },
  { ats: "workday",         rx: /([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:en-US\/)?([\w-]+)/i,                  extract: (m) => ({ tenant: m[1], cluster: m[2], site: m[3] }) },
  { ats: "smartrecruiters", rx: /(?:jobs|careers)\.smartrecruiters\.com\/([\w.-]+)/i,                            extract: (m) => ({ slug: m[1] }) },
];

async function tryFetch(url: string): Promise<{ finalUrl: string; html: string } | null> {
  try {
    const r = await axios.get<string>(url, {
      timeout: 15_000,
      maxRedirects: 10,
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      responseType: "text",
      transformResponse: (d) => d,
    });
    return { finalUrl: r.request?.res?.responseUrl ?? url, html: typeof r.data === "string" ? r.data : String(r.data) };
  } catch {
    return null;
  }
}

async function probe(config: CompanyConfig, companyName: string): Promise<number | null> {
  try {
    const adapter = getAdapter(config.ats);
    const jobs = await adapter.fetch(config, companyName);
    return jobs.length;
  } catch {
    return null;
  }
}

async function claudeFallback(companyName: string, html: string): Promise<CompanyConfig | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const trimmed = html.slice(0, 12_000);
  const prompt = `You are identifying which Applicant Tracking System (ATS) a company uses based on the HTML of its careers page.
Company: ${companyName}
HTML (truncated):
\`\`\`
${trimmed}
\`\`\`
Return STRICT JSON with shape {"ats": <one of: greenhouse|lever|ashby|workday|smartrecruiters|unknown>, "slug": <string or null>, "tenant": <string or null>, "site": <string or null>, "cluster": <string or null>, "confidence": <0-1>}. No prose, no markdown.`;
  const resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });
  const text = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (parsed.ats === "unknown" || parsed.confidence < 0.5) return null;
    const out: CompanyConfig = { ats: parsed.ats };
    if (parsed.slug) out.slug = parsed.slug;
    if (parsed.tenant) out.tenant = parsed.tenant;
    if (parsed.site) out.site = parsed.site;
    if (parsed.cluster) out.cluster = parsed.cluster;
    return out;
  } catch {
    return null;
  }
}

async function probeSlugCandidates(companyName: string): Promise<DiscoveryResult | null> {
  const key = companyName.toLowerCase().trim().replace(/\s+/g, "");
  const variants = Array.from(new Set([
    key,
    key.replace(/[-_.]/g, ""),
    `${key}careers`,
    `${key}llc`,
    `${key}inc`,
    `${key}hq`,
    `the${key}`,
  ]));

  const atsList: { ats: AtsKind; url: (slug: string) => string; check: (data: unknown) => boolean }[] = [
    {
      ats: "greenhouse",
      url: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=false`,
      check: (d) => !!(d as { jobs?: unknown[] })?.jobs,
    },
    {
      ats: "lever",
      url: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
      check: (d) => Array.isArray(d),
    },
    {
      ats: "ashby",
      url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
      check: (d) => !!(d as { jobs?: unknown[] })?.jobs,
    },
    {
      ats: "smartrecruiters",
      url: (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`,
      check: (d) => !!(d as { content?: unknown[] })?.content,
    },
  ];

  for (const slug of variants) {
    for (const { ats, url, check } of atsList) {
      try {
        const { data, status } = await axios.get(url(slug), {
          timeout: 8000,
          validateStatus: () => true,
          headers: { "User-Agent": "job-watcher/0.1 (personal use)", Accept: "application/json" },
        });
        if (status !== 200) continue;
        if (!check(data)) continue;
        const config: CompanyConfig = { ats, slug };
        const count = await probe(config, companyName);
        if (count !== null && count > 0) return { ok: true, config, jobCount: count };
      } catch {
        // continue
      }
    }
  }
  return null;
}

export async function discover(companyName: string): Promise<DiscoveryResult> {
  const key = companyName.toLowerCase().trim();

  if (BIG_TECH[key]) {
    const config: CompanyConfig = { ats: BIG_TECH[key] };
    const count = await probe(config, companyName);
    if (count !== null) return { ok: true, config, jobCount: count };
    return { ok: false, reason: `${key} adapter failed to fetch` };
  }

  const slugProbe = await probeSlugCandidates(companyName);
  if (slugProbe) return slugProbe;

  const candidateUrls = [
    `https://${key}.com/careers`,
    `https://careers.${key}.com`,
    `https://${key}.com/jobs`,
    `https://www.${key}.com/careers`,
  ];

  for (const u of candidateUrls) {
    const fetched = await tryFetch(u);
    if (!fetched) continue;
    const corpus = `${fetched.finalUrl}\n${fetched.html}`;

    for (const det of DETECTORS) {
      const m = corpus.match(det.rx);
      if (!m) continue;
      const extracted = det.extract(m);
      const config: CompanyConfig = { ats: det.ats, ...extracted };
      const count = await probe(config, companyName);
      if (count !== null) return { ok: true, config, jobCount: count };
    }

    const fallback = await claudeFallback(companyName, fetched.html);
    if (fallback) {
      const count = await probe(fallback, companyName);
      if (count !== null) return { ok: true, config: fallback, jobCount: count };
    }
  }

  return { ok: false, reason: "no ATS detected on any candidate careers URL" };
}

const isCli =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /discovery\.ts$|discovery\.js$/.test(process.argv[1]);

if (isCli) {
  const names = process.argv.slice(2);
  if (names.length === 0) {
    console.error("usage: npm run discover -- <company> [<company> ...]");
    process.exit(1);
  }
  (async () => {
    for (const n of names) {
      const r = await discover(n);
      console.log(n, "=>", JSON.stringify(r));
    }
  })();
}
