import axios from "axios";
import type { Adapter, CompanyConfig, Job } from "../types.js";

interface NaukriJob {
  jobId: string;
  title: string;
  companyName?: string;
  placeholders?: { label: string; type: string }[];
  createdDate?: number;
  jobDescription?: string;
}

export const naukriAdapter: Adapter = {
  kind: "naukri",
  async fetch(config: CompanyConfig, company: string): Promise<Job[]> {
    const query = config.slug ?? "";
    const url = "https://www.naukri.com/jobapi/v3/search";
    const { data } = await axios.get<{ jobDetails: NaukriJob[] }>(url, {
      params: { keyword: query, noOfResults: 50, sort: "f" },
      timeout: 25_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        appid: "109",
        systemid: "Naukri",
        clientid: "d3skt0p",
        gid: "LOCATION,INDUSTRY,EDUCATION,FAREA_ROLE",
        Referer: "https://www.naukri.com/jobs-in-india",
      },
    });
    return (data.jobDetails ?? []).map((j) => {
      const loc = (j.placeholders ?? []).find((p) => p.type === "location")?.label ?? "";
      const description = j.jobDescription ?? "";
      return {
        id: `nk-${j.jobId}`,
        company: j.companyName ?? company,
        title: j.title,
        location: loc,
        postedAt: j.createdDate ? new Date(j.createdDate).toISOString() : new Date().toISOString(),
        url: `https://www.naukri.com/job-listings-${j.jobId}`,
        snippet: description.slice(0, 200),
        description,
        source: "naukri",
      };
    });
  },
};
