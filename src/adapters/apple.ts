import axios from "axios";
import type { Adapter, CompanyConfig, Job } from "../types.js";

interface ApplePost {
  positionId: string;
  postingTitle: string;
  postingPostedDate?: string;
  locations?: { name?: string }[];
  postDateInGMT?: string;
}

export const appleAdapter: Adapter = {
  kind: "apple",
  async fetch(_config: CompanyConfig, company: string): Promise<Job[]> {
    const out: Job[] = [];
    const limit = 20;
    const maxPages = 5;
    for (let page = 1; page <= maxPages; page++) {
      const url = "https://jobs.apple.com/api/role/search";
      const { data } = await axios.post<{ searchResults: ApplePost[]; totalRecords: number }>(
        url,
        { query: "", filters: {}, page, locale: "en-us", sort: "newest" },
        {
          timeout: 25_000,
          headers: {
            "User-Agent": "job-watcher/0.1 (personal use)",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );
      const jobs = data.searchResults ?? [];
      for (const j of jobs) {
        out.push({
          id: `apl-${j.positionId}`,
          company,
          title: j.postingTitle,
          location: (j.locations ?? []).map((l) => l.name).filter(Boolean).join(", "),
          postedAt: j.postDateInGMT ?? j.postingPostedDate ?? new Date().toISOString(),
          url: `https://jobs.apple.com/en-us/details/${j.positionId}`,
          snippet: "",
          description: "",
          source: "apple",
        });
      }
      if (jobs.length < limit) break;
      await new Promise((r) => setTimeout(r, 600));
    }
    return out;
  },
};
