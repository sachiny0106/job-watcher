import axios from "axios";
import type { Adapter, CompanyConfig, Job } from "../types.js";

interface IHJob {
  id: number;
  position?: string;
  title?: string;
  company_name?: string;
  locations?: unknown;
  location?: unknown;
  min_experience?: number;
  max_experience?: number;
  created_on?: string;
  short_description?: string;
}

function normalizeLocation(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object") {
          const obj = x as Record<string, unknown>;
          return (obj.location ?? obj.name ?? obj.city ?? "") as string;
        }
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return String(obj.location ?? obj.name ?? obj.city ?? "");
  }
  return "";
}

export const instahyreAdapter: Adapter = {
  kind: "instahyre",
  async fetch(config: CompanyConfig, company: string): Promise<Job[]> {
    const query = config.slug ?? "";
    const url = "https://www.instahyre.com/api/v1/job_search";
    const { data } = await axios.get<{ objects: IHJob[] }>(url, {
      params: { job_position_q: query, limit: 50 },
      timeout: 25_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    return (data.objects ?? []).map((j) => {
      const description = j.short_description ?? "";
      return {
        id: `ih-${j.id}`,
        company: j.company_name ?? company,
        title: j.position ?? j.title ?? "(no title)",
        location: normalizeLocation(j.locations ?? j.location),
        postedAt: j.created_on ?? new Date().toISOString(),
        url: `https://www.instahyre.com/job/${j.id}/`,
        snippet: description.slice(0, 200),
        description,
        source: "instahyre",
      };
    });
  },
};
