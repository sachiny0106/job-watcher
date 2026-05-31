import axios from "axios";
import type { Adapter, CompanyConfig, Job } from "../types.js";

interface WorkdayPost {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

export const workdayAdapter: Adapter = {
  kind: "workday",
  async fetch(config: CompanyConfig, company: string): Promise<Job[]> {
    const { tenant, site, cluster } = config;
    if (!tenant || !site || !cluster) {
      throw new Error(
        `workday adapter needs tenant + site + cluster for ${company} (got ${JSON.stringify(config)})`
      );
    }
    const host = `${tenant}.${cluster}.myworkdayjobs.com`;
    const url = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
    const out: Job[] = [];

    const limit = 20;
    const maxPages = 5;
    for (let offset = 0; offset < limit * maxPages; offset += limit) {
      const { data } = await axios.post<{ jobPostings: WorkdayPost[]; total: number }>(
        url,
        { limit, offset, searchText: "", appliedFacets: {} },
        {
          timeout: 30_000,
          headers: {
            "User-Agent": "job-watcher/0.1 (personal use)",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );
      const postings = data.jobPostings ?? [];
      for (const p of postings) {
        out.push({
          id: `wd-${tenant}-${p.externalPath}`,
          company,
          title: p.title,
          location: p.locationsText ?? "",
          postedAt: relativeToIso(p.postedOn),
          url: `https://${host}${p.externalPath}`,
          snippet: (p.bulletFields ?? []).join(" · "),
          description: "",
          source: "workday",
        });
      }
      if (postings.length < limit) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    return out;
  },
};

function relativeToIso(rel?: string): string {
  if (!rel) return new Date().toISOString();
  const m = rel.match(/(\d+)\s+(day|days|hour|hours|minute|minutes)/i);
  if (!m) return new Date().toISOString();
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const ms =
    unit.startsWith("day") ? n * 86_400_000 :
    unit.startsWith("hour") ? n * 3_600_000 :
    n * 60_000;
  return new Date(Date.now() - ms).toISOString();
}
