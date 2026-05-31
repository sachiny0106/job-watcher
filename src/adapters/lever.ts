import axios from "axios";
import type { Adapter, CompanyConfig, Job } from "../types.js";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt: number;
  categories?: { location?: string; team?: string; commitment?: string };
  descriptionPlain?: string;
}

export const leverAdapter: Adapter = {
  kind: "lever",
  async fetch(config: CompanyConfig, company: string): Promise<Job[]> {
    if (!config.slug) throw new Error(`lever adapter needs slug for ${company}`);
    const url = `https://api.lever.co/v0/postings/${config.slug}?mode=json`;
    const { data } = await axios.get<LeverPosting[]>(url, {
      timeout: 20_000,
      headers: { "User-Agent": "job-watcher/0.1 (personal use)" },
    });
    return data.map((p) => {
      const description = p.descriptionPlain ?? "";
      return {
        id: `lv-${p.id}`,
        company,
        title: p.text,
        location: p.categories?.location ?? "",
        postedAt: new Date(p.createdAt).toISOString(),
        url: p.hostedUrl,
        snippet: description.slice(0, 200),
        description,
        source: "lever",
      };
    });
  },
};
