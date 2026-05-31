import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import { z } from "zod";
import type { Job } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_PATH = path.resolve(__dirname, "..", "profile.json");

const ProfileSchema = z.object({
  graduationDate: z.string(),
  experienceLevel: z.string(),
  yearsOfExperience: z.number().nonnegative(),
  internshipExperience: z.string().optional().default(""),
  currentRole: z.string().optional().default(""),
  skills: z.array(z.string()).default([]),
  preferredRoles: z.array(z.string()).default([]),
  avoidRoles: z.array(z.string()).default([]),
  preferredLocations: z.array(z.string()).default([]),
  minSalaryLPA: z.number().nonnegative().default(15),
  summary: z.string().optional().default(""),
});
export type Profile = z.infer<typeof ProfileSchema>;

export function loadProfile(): Profile {
  const envRaw = process.env.PROFILE_JSON;
  if (envRaw && envRaw.trim()) {
    try {
      return ProfileSchema.parse(JSON.parse(envRaw));
    } catch (e) {
      console.warn("[llm-score] PROFILE_JSON env var failed to parse:", e instanceof Error ? e.message : e);
    }
  }
  const localPath = path.resolve(path.dirname(PROFILE_PATH), "profile.local.json");
  if (fs.existsSync(localPath)) {
    return ProfileSchema.parse(JSON.parse(fs.readFileSync(localPath, "utf8")));
  }
  return ProfileSchema.parse(JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8")));
}

export interface FitVerdict {
  fit: "yes" | "maybe" | "no";
  score: number;
  reasoning: string;
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

function buildPrompt(job: Job, profile: Profile): string {
  return `You are a strict career filter judging whether a specific job opening is a good fit for a fresher candidate in India. Default to "no" if anything is uncertain. The candidate cannot apply to roles requiring real professional experience.

CANDIDATE PROFILE
- Graduation: ${profile.graduationDate} — graduating very soon, NO full-time professional experience yet
- Experience level: ${profile.experienceLevel} (${profile.yearsOfExperience} years full-time)
- Internships: ${profile.internshipExperience || "none stated"}  (IMPORTANT: internships DO NOT count as professional / full-time / industry experience for this candidate)
- Current role: ${profile.currentRole}
- Skills: ${profile.skills.join(", ")}
- Preferred roles: ${profile.preferredRoles.join(", ")}
- Avoid roles: ${profile.avoidRoles.join(", ")}
- Preferred locations: ${profile.preferredLocations.join(", ")}
- Minimum base salary: ₹${profile.minSalaryLPA} LPA (Indian Rupees, Lakhs Per Annum)
- Summary: ${profile.summary}

JOB POSTING
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Description: ${(job.description || job.snippet || "").slice(0, 4000)}

HARD REJECT RULES (return "no" with confidence 0-3 if ANY of these apply)
1. Title contains: Senior, Sr., Lead, Staff, Principal, Architect, Manager, Director, Head, VP, II, III, IV, L4, L5, L6, Level 2, Level 3, SDE-2, SDE-3, SDE 2, SDE 3, SE2, SE3
2. Description requires ≥ 2 years of professional / non-internship / full-time / industry / work experience (treat "3+ years" or similar as a hard reject — internships don't satisfy this)
3. Job is at a physical non-India office AND has no remote/WFH/anywhere option open to India
4. Company is a service / consulting / IT-outsourcing firm typically paying freshers below ₹${profile.minSalaryLPA} LPA (TCS, Infosys, Wipro, HCL, Cognizant, Capgemini, LTI / LTIMindtree, Tech Mahindra, Mphasis, Hexaware, Genpact, Mindtree, NIIT, Persistent, Tata, Mahindra Tech, Birlasoft, Coforge, Cyient, Zensar, L&T, KPIT)
5. Description explicitly mentions a CTC / package / salary below ₹${profile.minSalaryLPA} LPA

ACCEPT RULES — return "yes" (score 8-10) ONLY if ALL of these hold:
- Fresher-appropriate role (SDE-1 / SDE I / Software Engineer / Associate / Junior / Graduate / Entry-level / no level suffix)
- Description either says ≤ 1 year, "fresher", "new grad", "entry level", "0-1 years", "0-2 years", OR makes no explicit experience requirement
- At least one of the candidate's skills overlaps with the role's stack
- Location is India / Indian city OR fully remote (remote-anywhere / remote-global / WFH without a non-India country restriction)
- Company is a known product / well-funded / top-tier firm likely paying ≥ ₹${profile.minSalaryLPA} LPA to a fresher (FAANG, Microsoft, Amazon, Google, Apple, Meta, Stripe, Razorpay, Atlassian, Postman, Uber, Adobe, Salesforce, PhonePe, CRED, Swiggy, Zomato, Flipkart, Walmart, Coinbase, ByteDance, ServiceNow, Oracle, Nvidia, Intuit, Booking, Airbnb, Hasura, Browserstack, Freshworks, Zerodha)

"maybe" (score 4-7) — entry-level, decent skill overlap, India, but company unknown or salary uncertain.

Reply with strict JSON only, no prose: {"fit": "yes"|"maybe"|"no", "score": 0-10, "reasoning": "one short sentence covering experience requirement, skill match, location, and salary signal"}`;
}

const VerdictSchema = {
  type: "OBJECT",
  properties: {
    fit: { type: "STRING", enum: ["yes", "maybe", "no"] },
    score: { type: "NUMBER" },
    reasoning: { type: "STRING" },
  },
  required: ["fit", "score", "reasoning"],
};

export async function scoreJob(job: Job, profile: Profile, apiKey: string): Promise<FitVerdict | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: buildPrompt(job, profile) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: VerdictSchema,
      temperature: 0,
      maxOutputTokens: 250,
    },
  };
  try {
    let resp;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        resp = await axios.post<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(url, body, {
          timeout: 30_000,
          headers: { "Content-Type": "application/json" },
        });
        break;
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 429 && attempt < 2) {
          const wait = (attempt + 1) * 4000;
          console.warn(`[llm-score] 429 — sleeping ${wait}ms before retry`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw err;
      }
    }
    if (!resp) return null;
    const { data } = resp;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    let parsed: { fit?: string; score?: number; reasoning?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return null;
      parsed = JSON.parse(m[0]);
    }
    const fit = parsed.fit === "yes" || parsed.fit === "maybe" || parsed.fit === "no" ? parsed.fit : "no";
    return {
      fit,
      score: typeof parsed.score === "number" ? parsed.score : 0,
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch (e) {
    const ax = e as { response?: { status?: number; data?: unknown }; message?: string };
    const status = ax?.response?.status;
    const body = ax?.response?.data ? JSON.stringify(ax.response.data).slice(0, 400) : "";
    console.warn(`[llm-score] failed for "${job.title}" @ ${job.company}: status=${status} ${ax?.message ?? ""} ${body}`);
    return null;
  }
}

function buildBatchPrompt(jobs: Job[], profile: Profile): string {
  const jobBlocks = jobs
    .map(
      (j, i) => `
JOB #${i + 1}  id=${j.id}
- Title: ${j.title}
- Company: ${j.company}
- Location: ${j.location}
- Description: ${(j.description || j.snippet || "").slice(0, 2500)}
`
    )
    .join("\n---\n");

  return `You are a strict career filter. Evaluate EACH job below for the same fresher candidate. Default to "no" if anything is uncertain.

CANDIDATE PROFILE
- Graduation: ${profile.graduationDate} — graduating very soon, NO full-time professional experience yet
- Internships: ${profile.internshipExperience || "none stated"} (IMPORTANT: internships DO NOT count as professional / full-time / industry / non-internship experience)
- Skills: ${profile.skills.join(", ")}
- Preferred roles: ${profile.preferredRoles.join(", ")}
- Avoid roles: ${profile.avoidRoles.join(", ")}
- Preferred locations: ${profile.preferredLocations.join(", ")}
- Minimum base salary: ₹${profile.minSalaryLPA} LPA (Lakhs Per Annum)

LOCATION RULE
- ACCEPT if job location includes India, any Indian city (Bangalore/Bengaluru, Hyderabad, Pune, Mumbai, Delhi, Gurgaon/Gurugram, Noida, Chennai, Kolkata, Ahmedabad, NCR), OR is fully remote / remote-global / remote-anywhere / work-from-home with no country restriction excluding India
- REJECT if job is at a physical non-India office (USA, UK, Singapore, etc.) with no remote option, OR remote-but-restricted to a non-India country only (e.g. "Remote US only", "Remote EMEA")

HARD REJECT (fit="no", score 0-3) if ANY:
1. Title contains: Senior, Sr., Lead, Staff, Principal, Architect, Manager, Director, Head, VP, II, III, IV, L4, L5, L6, Level 2, Level 3, SDE-2, SDE-3, SDE 2, SDE 3, SE2, SE3
2. Description requires ≥ 2 years of professional / non-internship / full-time / industry / work experience
3. Location fails the LOCATION RULE above (physical office outside India with no remote-for-India option)
4. Service / consulting / IT-outsourcing company likely paying freshers < ₹${profile.minSalaryLPA} LPA (TCS, Infosys, Wipro, HCL, Cognizant, Capgemini, LTI/LTIMindtree, Tech Mahindra, Mphasis, Hexaware, Genpact, Persistent, Mindtree, Birlasoft, Coforge, Cyient, Zensar)
5. Description states a package below ₹${profile.minSalaryLPA} LPA

ACCEPT (fit="yes", score 8-10) ONLY if ALL:
- Fresher-appropriate (SDE-1 / SDE I / Software Engineer / Associate / Junior / Graduate / Entry-level / unranked)
- ≤ 1 year experience required OR no explicit experience requirement OR mentions fresher/new-grad/entry-level
- Candidate's skills overlap with the role's stack
- Passes LOCATION RULE (India OR remote-anywhere — companies do not need to be Indian)
- Top-tier product / well-funded company likely paying ≥ ₹${profile.minSalaryLPA} LPA fresher base (FAANG, Microsoft, Amazon, Google, Apple, Meta, Stripe, Razorpay, Atlassian, Postman, Uber, Adobe, Salesforce, PhonePe, CRED, Swiggy, Zomato, Flipkart, Walmart, Coinbase, ByteDance, ServiceNow, Oracle, Nvidia, Intuit, Booking, Airbnb, Hasura, Browserstack, Freshworks, Zerodha, Groww, Ramp)

"maybe" (score 4-7) — entry-level + skill overlap + India, but company unknown or salary uncertain.

JOBS TO EVALUATE:
${jobBlocks}

Reply with strict JSON ONLY (no prose, no markdown). An array of objects, one per job, in the same order, each: {"id": "<job id>", "fit": "yes"|"maybe"|"no", "score": 0-10, "reasoning": "one short sentence covering experience requirement, skill match, location, and salary signal"}`;
}

const BatchSchema = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "STRING" },
      fit: { type: "STRING", enum: ["yes", "maybe", "no"] },
      score: { type: "NUMBER" },
      reasoning: { type: "STRING" },
    },
    required: ["id", "fit", "score", "reasoning"],
  },
};

type Provider = { kind: "gemini" | "openai" | "nvidia"; key: string };

function loadProviders(): Provider[] {
  const out: Provider[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== "string" || !v.trim()) continue;
    if (/^GOOGLE_API_KEY(_\d+)?$/i.test(k)) out.push({ kind: "gemini", key: v.trim() });
    else if (/^OPENAI_API_KEY(_\d+)?$/i.test(k)) out.push({ kind: "openai", key: v.trim() });
    else if (/^NVIDIA_API_KEY(_\d+)?$/i.test(k)) out.push({ kind: "nvidia", key: v.trim() });
  }
  const seen = new Set<string>();
  return out.filter((p) => {
    const id = `${p.kind}:${p.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function callNvidia(provider: Provider, prompt: string): Promise<string | null> {
  const body = {
    model: process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct",
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content: "You return strict JSON only. The user's instruction will specify a JSON array. Wrap it as {\"verdicts\": [...]}.",
      },
      { role: "user", content: prompt },
    ],
  };
  const { data } = await axios.post<{ choices?: { message?: { content?: string } }[] }>(
    "https://integrate.api.nvidia.com/v1/chat/completions",
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
    if (Array.isArray(obj?.verdicts)) return JSON.stringify(obj.verdicts);
    const firstArrayKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
    if (firstArrayKey) return JSON.stringify(obj[firstArrayKey]);
    return content;
  } catch {
    return content;
  }
}

function shuffled<T>(arr: T[]): T[] {
  return arr
    .map((x) => [Math.random(), x] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, x]) => x);
}

function mask(key: string): string {
  return `${key.slice(0, 10)}…${key.slice(-4)}`;
}

async function callGemini(provider: Provider, prompt: string, jobCount: number): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: BatchSchema,
      temperature: 0,
      maxOutputTokens: Math.min(32000, 400 * jobCount + 2000),
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
  const url = "https://api.openai.com/v1/chat/completions";
  const body = {
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [
      {
        role: "system",
        content: "You return strict JSON only. The user's instruction will specify a JSON array. Wrap it as {\"verdicts\": [...]}.",
      },
      { role: "user", content: prompt },
    ],
  };
  const { data } = await axios.post<{ choices?: { message?: { content?: string } }[] }>(url, body, {
    timeout: 60_000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.key}`,
    },
  });
  const content = data.choices?.[0]?.message?.content ?? null;
  if (!content) return null;
  try {
    const obj = JSON.parse(content);
    if (Array.isArray(obj)) return JSON.stringify(obj);
    if (Array.isArray(obj?.verdicts)) return JSON.stringify(obj.verdicts);
    const firstArrayKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
    if (firstArrayKey) return JSON.stringify(obj[firstArrayKey]);
    return content;
  } catch {
    return content;
  }
}

export async function scoreJobs(jobs: Job[], profile: Profile, _apiKey: string): Promise<Map<string, FitVerdict>> {
  const verdicts = new Map<string, FitVerdict>();
  if (jobs.length === 0) return verdicts;

  const providers = shuffled(loadProviders());
  if (providers.length === 0) {
    console.warn("[llm-score] no LLM API keys configured (need GOOGLE_API_KEY or OPENAI_API_KEY)");
    return verdicts;
  }

  const prompt = buildBatchPrompt(jobs, profile);
  let text: string | null = null;

  for (const p of providers) {
    const tag = `${p.kind} ${mask(p.key)}`;
    try {
      text =
        p.kind === "gemini"
          ? await callGemini(p, prompt, jobs.length)
          : p.kind === "openai"
          ? await callOpenAI(p, prompt)
          : await callNvidia(p, prompt);
      if (text) {
        console.log(`[llm-score] succeeded with ${tag}`);
        break;
      }
      console.warn(`[llm-score] ${tag} returned empty text, trying next`);
    } catch (err) {
      const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
      const status = ax?.response?.status;
      const errBody = ax?.response?.data ? JSON.stringify(ax.response.data).slice(0, 250) : "";
      console.warn(`[llm-score] ${tag} failed: status=${status} ${errBody}`);
    }
  }
  if (!text) return verdicts;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) {
      console.warn("[llm-score] no JSON array in response. first 400 chars:", text.slice(0, 400));
      return verdicts;
    }
    parsed = JSON.parse(m[0]);
  }
  if (!Array.isArray(parsed)) {
    console.warn("[llm-score] parsed value is not an array:", JSON.stringify(parsed).slice(0, 200));
    return verdicts;
  }
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as { id?: unknown; fit?: unknown; score?: unknown; reasoning?: unknown };
    const id = typeof o.id === "string" ? o.id : "";
    const fit = o.fit === "yes" || o.fit === "maybe" || o.fit === "no" ? o.fit : "no";
    const score = typeof o.score === "number" ? o.score : 0;
    const reasoning = String(o.reasoning ?? "");
    if (id) verdicts.set(id, { fit, score, reasoning });
  }
  return verdicts;
}
