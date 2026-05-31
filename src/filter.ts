import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FilterConfigSchema, type FilterConfig, type Job } from "./types.js";
import { isFresherFriendly } from "./experience.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILTERS_PATH = path.resolve(__dirname, "..", "filters.json");

export function loadFilters(): FilterConfig {
  const raw = fs.readFileSync(FILTERS_PATH, "utf8");
  return FilterConfigSchema.parse(JSON.parse(raw));
}

function containsAny(haystack: string, needles: string[]): boolean {
  if (needles.length === 0) return false;
  const lc = haystack.toLowerCase();
  return needles.some((n) => lc.includes(n.toLowerCase()));
}

export function passesFilter(job: Job, filters: FilterConfig): boolean {
  const title = job.title;
  const blob = `${job.title} ${job.location} ${job.snippet}`;

  if (filters.exclude.length && containsAny(title, filters.exclude)) return false;

  if (filters.include.length && !containsAny(blob, filters.include)) return false;

  if (filters.locations.length) {
    const loc = job.location.toLowerCase();
    const matchesLoc = filters.locations.some((l) => loc.includes(l.toLowerCase()));
    if (!matchesLoc) return false;
  }

  if (filters.maxAgeDays && job.postedAt) {
    const posted = new Date(job.postedAt).getTime();
    if (!isNaN(posted)) {
      const ageDays = (Date.now() - posted) / 86_400_000;
      if (ageDays > filters.maxAgeDays) return false;
    }
  }

  const corpus = `${job.description ?? ""} ${job.snippet ?? ""}`;
  if (corpus.trim() && !isFresherFriendly(corpus, filters.maxYearsExperience)) return false;

  return true;
}
