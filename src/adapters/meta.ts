import axios from "axios";
import type { Adapter, CompanyConfig, Job } from "../types.js";

interface MetaJob {
  id: string;
  title: string;
  locations?: string[];
  posted_date?: string;
  url?: string;
}

export const metaAdapter: Adapter = {
  kind: "meta",
  async fetch(_config: CompanyConfig, company: string): Promise<Job[]> {
    const url = "https://www.metacareers.com/graphql";
    const variables = {
      search_input: {
        q: null,
        divisions: [],
        offices: [],
        roles: [],
        leadership_levels: [],
        teams: [],
        sub_teams: [],
        is_leadership: false,
        is_remote_only: false,
        sort_by_new: true,
        page: 1,
        results_per_page: 50,
      },
    };
    const body = {
      doc_id: "9114524511922157",
      variables: JSON.stringify(variables),
    };
    const { data } = await axios.post<{
      data: { job_search: MetaJob[] };
    }>(url, body, {
      timeout: 25_000,
      headers: {
        "User-Agent": "job-watcher/0.1 (personal use)",
        "Content-Type": "application/x-www-form-urlencoded",
        "X-FB-Friendly-Name": "CareersJobSearchResultsQuery",
      },
    });
    const jobs = data?.data?.job_search ?? [];
    return jobs.map((j) => ({
      id: `meta-${j.id}`,
      company,
      title: j.title,
      location: (j.locations ?? []).join(", "),
      postedAt: j.posted_date ?? new Date().toISOString(),
      url: j.url ?? `https://www.metacareers.com/jobs/${j.id}/`,
      snippet: "",
      description: "",
      source: "meta",
    }));
  },
};
