const HTML_TAG = /<[^>]+>/g;
const HTML_ENT = /&(nbsp|amp|lt|gt|quot|#39);/gi;

function stripHtml(s: string): string {
  return s
    .replace(HTML_TAG, " ")
    .replace(HTML_ENT, (_: string, e: string) => {
      const map: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
      return map[e.toLowerCase()] ?? " ";
    })
    .replace(/\s+/g, " ");
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function wordToNum(s: string): number {
  return NUMBER_WORDS[s.toLowerCase()] ?? NaN;
}

const YEARS_NUM_RX = /(\d+)\s*\+?\s*(?:to\s*\d+|-\s*\d+)?\s*(?:years?|yrs?)\b(?:[^.,\n]{0,80}?(?:experience|exp\b|work))?/gi;
const YEARS_WORD_RX = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+\+?\s*(?:years?|yrs?)\b(?:[^.,\n]{0,80}?(?:experience|exp\b|work))?/gi;
const POSITIVE_RX = /\b(fresher|fresh\s+graduate|new\s+grad|recent\s+graduate|recent\s+grad|no\s+prior\s+experience|no\s+experience\s+required|0\s*[-+]\s*[12]\s*years?|0\s+to\s+[12]\s+years?|entry[\s-]+level|college\s+graduate)\b/i;

export function isFresherFriendly(text: string, maxYears: number): boolean {
  if (!text || text.trim().length === 0) return true;

  const clean = stripHtml(text).toLowerCase();

  if (POSITIVE_RX.test(clean)) return true;

  let maxFound = 0;
  for (const m of clean.matchAll(YEARS_NUM_RX)) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > maxFound) maxFound = n;
  }
  for (const m of clean.matchAll(YEARS_WORD_RX)) {
    const n = wordToNum(m[1]);
    if (!isNaN(n) && n > maxFound) maxFound = n;
  }

  if (maxFound === 0) return true;
  return maxFound <= maxYears;
}

export function experienceReason(text: string, maxYears: number): string {
  if (!text) return "no description";
  const clean = stripHtml(text).toLowerCase();
  if (POSITIVE_RX.test(clean)) return "explicit fresher / entry-level signal";
  let maxFound = 0;
  for (const m of clean.matchAll(YEARS_NUM_RX)) {
    const n = parseInt(m[1], 10);
    if (n > maxFound) maxFound = n;
  }
  if (maxFound === 0) return "no explicit years requirement";
  if (maxFound <= maxYears) return `requires ${maxFound}y ≤ ${maxYears}y threshold`;
  return `requires ${maxFound}y > ${maxYears}y threshold`;
}
