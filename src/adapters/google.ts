import axios from "axios";
import type { Adapter, CompanyConfig, Job } from "../types.js";

interface GoogJob {
  id?: string;
  uuid?: string;
  title: string;
  publish_date?: string;
  locations?: { display?: string }[];
  apply_url?: string;
  description?: string;
  summary?: string;
}

export const googleAdapter: Adapter = {
  kind: "google",
  async fetch(_config: CompanyConfig, company: string): Promise<Job[]> {
    const out: Job[] = [];
    const pageSize = 100;
    const maxPages = 3;
    for (let page = 1; page <= maxPages; page++) {
      const url = `https://careers.google.com/api/v3/search/?page=${page}&page_size=${pageSize}&sort_by=relevance`;
      const { data } = await axios.get<{ jobs: GoogJob[]; count: number }>(url, {
        timeout: 25_000,
        headers: { "User-Agent": "job-watcher/0.1 (personal use)" },
      });
      const jobs = data.jobs ?? [];
      for (const j of jobs) {
        const id = j.id ?? j.uuid ?? j.apply_url ?? j.title;
        const description = j.description ?? j.summary ?? "";
        out.push({
          id: `goog-${id}`,
          company,
          title: j.title,
          location: (j.locations ?? []).map((l) => l.display).filter(Boolean).join(", "),
          postedAt: j.publish_date ?? new Date().toISOString(),
          url: j.apply_url ?? `https://www.google.com/about/careers/applications/jobs/results/${id}`,
          snippet: description.slice(0, 200),
          description,
          source: "google",
        });
      }
      if (jobs.length < pageSize) break;
      await new Promise((r) => setTimeout(r, 600));
    }
    return out;
  },
};
