import type { Adapter, AtsKind } from "../types.js";
import { greenhouseAdapter } from "./greenhouse.js";
import { leverAdapter } from "./lever.js";
import { ashbyAdapter } from "./ashby.js";
import { workdayAdapter } from "./workday.js";
import { smartRecruitersAdapter } from "./smartrecruiters.js";
import { microsoftAdapter } from "./microsoft.js";
import { amazonAdapter } from "./amazon.js";
import { googleAdapter } from "./google.js";
import { appleAdapter } from "./apple.js";
import { metaAdapter } from "./meta.js";
import { instahyreAdapter } from "./instahyre.js";
import { naukriAdapter } from "./naukri.js";
import { careerpageAdapter } from "./careerpage.js";

const registry: Partial<Record<AtsKind, Adapter>> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  workday: workdayAdapter,
  smartrecruiters: smartRecruitersAdapter,
  microsoft: microsoftAdapter,
  amazon: amazonAdapter,
  google: googleAdapter,
  apple: appleAdapter,
  meta: metaAdapter,
  instahyre: instahyreAdapter,
  naukri: naukriAdapter,
  careerpage: careerpageAdapter,
};

export function getAdapter(kind: AtsKind): Adapter {
  const a = registry[kind];
  if (!a) throw new Error(`no adapter registered for ats=${kind}`);
  return a;
}

export const supportedKinds = Object.keys(registry) as AtsKind[];
