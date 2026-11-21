import type { NormalizedMovie } from "./normalize";

export const SECTIONS = [
  "core",
  "translations",
  "genres",
  "keywords",
  "companies",
  "countries",
  "collection",
  "release_dates",
  "videos",
  "credits",
] as const;
export type Section = (typeof SECTIONS)[number];
export type SectionHashes = Record<Section, string>;

/** JSON with sorted object keys, so hashes don't depend on property order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** cyrb53 — fast, non-cryptographic 53-bit hash. Change detection only. */
export function cyrb53(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function sectionData(n: NormalizedMovie): Record<Section, unknown> {
  return {
    core: n.core,
    translations: n.translations,
    genres: n.genres,
    keywords: n.keywords,
    companies: n.companies,
    countries: n.countries,
    collection: n.collection,
    release_dates: n.releaseDates,
    videos: n.videos,
    // People are derived from credits, so person changes (name, photo) also change this hash.
    credits: { credits: n.credits, people: n.people },
  };
}

export function hashSections(n: NormalizedMovie): SectionHashes {
  const data = sectionData(n);
  return Object.fromEntries(SECTIONS.map((s) => [s, cyrb53(stableStringify(data[s]))])) as SectionHashes;
}

export function parseSectionHashes(json: string | null | undefined): Partial<SectionHashes> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Partial<SectionHashes>) : null;
  } catch {
    return null;
  }
}

export function changedSections(next: SectionHashes, prev: Partial<SectionHashes> | null): Section[] {
  if (!prev) return [...SECTIONS];
  return SECTIONS.filter((s) => prev[s] !== next[s]);
}
