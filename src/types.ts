import { z } from "zod";

export const JobSchema = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string().optional().default(""),
  postedAt: z.string().datetime().or(z.string()),
  url: z.string().url(),
  snippet: z.string().optional().default(""),
  description: z.string().optional().default(""),
  source: z.string(),
});
export type Job = z.infer<typeof JobSchema>;

export const AtsKindSchema = z.enum([
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "smartrecruiters",
  "microsoft",
  "amazon",
  "google",
  "apple",
  "meta",
  "instahyre",
  "naukri",
  "serpapi",
  "careerpage",
]);
export type AtsKind = z.infer<typeof AtsKindSchema>;

export const CompanyConfigSchema = z.object({
  ats: AtsKindSchema,
  slug: z.string().optional(),
  tenant: z.string().optional(),
  site: z.string().optional(),
  cluster: z.string().optional(),
  url: z.string().url().optional(),
});
export type CompanyConfig = z.infer<typeof CompanyConfigSchema>;

export const CompaniesFileSchema = z.record(z.string(), CompanyConfigSchema);
export type CompaniesFile = z.infer<typeof CompaniesFileSchema>;

export const FilterConfigSchema = z.object({
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  maxAgeDays: z.number().int().positive().default(14),
  maxYearsExperience: z.number().int().nonnegative().default(2),
});
export type FilterConfig = z.infer<typeof FilterConfigSchema>;

export const SearchSchema = z.object({
  board: z.enum(["instahyre", "naukri", "serpapi"]),
  query: z.string(),
  location: z.string().optional(),
  minExp: z.number().optional(),
  maxExp: z.number().optional(),
  engine: z.enum(["google_jobs", "indeed", "linkedin"]).optional(),
});
export type Search = z.infer<typeof SearchSchema>;

export interface Adapter {
  kind: AtsKind;
  fetch(config: CompanyConfig, companyName: string): Promise<Job[]>;
}
