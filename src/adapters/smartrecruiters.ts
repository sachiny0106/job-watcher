import axios from "axios";
import type { Adapter, CompanyConfig, Job } from "../types.js";

interface SRPosting {
  id: string;
  name: string;
  ref: string;
  releasedDate?: string;
  location?: { city?: string; country?: string; remote?: boolean };
}

export const smartRecruitersAdapter: Adapter = {
  kind: "smartrecruiters",
  async fetch(config: CompanyConfig, company: string): Promise<Job[]> {
    if (!config.slug) throw new Error(`smartrecruiters adapter needs slug for ${company}`);
    const out: Job[] = [];
    const limit = 100;
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const url = `https://api.smartrecruiters.com/v1/companies/${config.slug}/postings?limit=${limit}&offset=${offset}`;
      const { data } = await axios.get<{ content: SRPosting[]; totalFound: number }>(url, {
        timeout: 20_000,
        headers: { "User-Agent": "job-watcher/0.1 (personal use)" },
      });
      total = data.totalFound ?? 0;
      for (const p of data.content ?? []) {
        const locParts = [p.location?.city, p.location?.country].filter(Boolean);
        const loc = p.location?.remote ? "Remote" : locParts.join(", ");
        out.push({
          id: `sr-${p.id}`,
          company,
          title: p.name,
          location: loc,
          postedAt: p.releasedDate ?? new Date().toISOString(),
          url: p.ref,
          snippet: "",
          description: "",
          source: "smartrecruiters",
        });
      }
      if ((data.content ?? []).length < limit) break;
      offset += limit;
      await new Promise((r) => setTimeout(r, 500));
    }
    return out;
  },
};
