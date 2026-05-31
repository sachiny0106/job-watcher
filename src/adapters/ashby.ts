import axios from "axios";
import type { Adapter, CompanyConfig, Job } from "../types.js";

interface AshbyJob {
  id: string;
  title: string;
  locationName?: string;
  publishedDate?: string;
  jobUrl: string;
  departmentName?: string;
  teamName?: string;
  descriptionPlain?: string;
}

export const ashbyAdapter: Adapter = {
  kind: "ashby",
  async fetch(config: CompanyConfig, company: string): Promise<Job[]> {
    if (!config.slug) throw new Error(`ashby adapter needs slug for ${company}`);
    const url = `https://api.ashbyhq.com/posting-api/job-board/${config.slug}?includeCompensation=false`;
    const { data } = await axios.get<{ jobs: AshbyJob[] }>(url, {
      timeout: 20_000,
      headers: { "User-Agent": "job-watcher/0.1 (personal use)" },
    });
    return (data.jobs ?? []).map((j) => {
      const description = j.descriptionPlain ?? "";
      const meta = [j.departmentName, j.teamName].filter(Boolean).join(" / ");
      return {
        id: `ab-${j.id}`,
        company,
        title: j.title,
        location: j.locationName ?? "",
        postedAt: j.publishedDate ?? new Date().toISOString(),
        url: j.jobUrl,
        snippet: meta || description.slice(0, 200),
        description,
        source: "ashby",
      };
    });
  },
};
