import axios from "axios";
import type { Adapter, CompanyConfig, Job } from "../types.js";

interface MSJob {
  jobId: string;
  title: string;
  postingDate?: string;
  properties?: {
    primaryLocation?: string;
    locations?: string[];
    description?: string;
  };
}

export const microsoftAdapter: Adapter = {
  kind: "microsoft",
  async fetch(_config: CompanyConfig, company: string): Promise<Job[]> {
    const out: Job[] = [];
    const pageSize = 20;
    const maxPages = 5;
    for (let page = 1; page <= maxPages; page++) {
      const url = `https://gcsservices.careers.microsoft.com/search/api/v1/search?q=&l=en_us&pg=${page}&pgSz=${pageSize}&o=Recent&flt=true`;
      const { data } = await axios.get<{ operationResult: { result: { jobs: MSJob[]; totalJobs: number } } }>(url, {
        timeout: 25_000,
        headers: { "User-Agent": "job-watcher/0.1 (personal use)" },
      });
      const jobs = data.operationResult?.result?.jobs ?? [];
      for (const j of jobs) {
        const description = j.properties?.description ?? "";
        out.push({
          id: `ms-${j.jobId}`,
          company,
          title: j.title,
          location: j.properties?.primaryLocation ?? (j.properties?.locations ?? []).join(", "),
          postedAt: j.postingDate ?? new Date().toISOString(),
          url: `https://jobs.careers.microsoft.com/global/en/job/${j.jobId}`,
          snippet: description.slice(0, 200),
          description,
          source: "microsoft",
        });
      }
      if (jobs.length < pageSize) break;
      await new Promise((r) => setTimeout(r, 600));
    }
    return out;
  },
};
