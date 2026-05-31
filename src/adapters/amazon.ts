import axios from "axios";
import type { Adapter, CompanyConfig, Job } from "../types.js";

interface AmzJob {
  id_icims: string;
  title: string;
  posted_date?: string;
  updated_time?: string;
  location?: string;
  normalized_location?: string;
  job_path: string;
  description_short?: string;
}

export const amazonAdapter: Adapter = {
  kind: "amazon",
  async fetch(_config: CompanyConfig, company: string): Promise<Job[]> {
    const out: Job[] = [];
    const limit = 100;
    const maxPages = 3;
    for (let page = 0; page < maxPages; page++) {
      const offset = page * limit;
      const url = `https://www.amazon.jobs/en/search.json?result_limit=${limit}&offset=${offset}&sort=recent`;
      const { data } = await axios.get<{ jobs: AmzJob[]; hits: number }>(url, {
        timeout: 25_000,
        headers: { "User-Agent": "job-watcher/0.1 (personal use)" },
      });
      const jobs = data.jobs ?? [];
      for (const j of jobs) {
        const description = j.description_short ?? "";
        out.push({
          id: `amz-${j.id_icims}`,
          company,
          title: j.title,
          location: j.normalized_location ?? j.location ?? "",
          postedAt: j.updated_time ?? j.posted_date ?? new Date().toISOString(),
          url: `https://www.amazon.jobs${j.job_path}`,
          snippet: description.slice(0, 200),
          description,
          source: "amazon",
        });
      }
      if (jobs.length < limit) break;
      await new Promise((r) => setTimeout(r, 600));
    }
    return out;
  },
};
