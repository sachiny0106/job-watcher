import axios from "axios";
import type { Adapter, CompanyConfig, Job } from "../types.js";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at: string;
  location?: { name?: string };
  content?: string;
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/gi, (_, e) =>
      ({ nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[String(e).toLowerCase()] ?? " ")
    )
    .replace(/\s+/g, " ")
    .trim();
}

export const greenhouseAdapter: Adapter = {
  kind: "greenhouse",
  async fetch(config: CompanyConfig, company: string): Promise<Job[]> {
    if (!config.slug) throw new Error(`greenhouse adapter needs slug for ${company}`);
    const url = `https://boards-api.greenhouse.io/v1/boards/${config.slug}/jobs?content=true`;
    const { data } = await axios.get<{ jobs: GreenhouseJob[] }>(url, {
      timeout: 30_000,
      headers: { "User-Agent": "job-watcher/0.1 (personal use)" },
    });
    return data.jobs.map((j) => {
      const description = j.content ? decode(j.content) : "";
      return {
        id: `gh-${j.id}`,
        company,
        title: j.title,
        location: j.location?.name ?? "",
        postedAt: j.updated_at,
        url: j.absolute_url,
        snippet: description.slice(0, 200),
        description,
        source: "greenhouse",
      };
    });
  },
};
