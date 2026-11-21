/** Data-scope and pipeline constants. See docs/SPEC.md § 2 and § 5. */

export const GENRE_HORROR = 27;
export const GENRE_THRILLER = 53;
/** A movie qualifies if it has ANY of these genres (Q24). */
export const MEMBER_GENRES: readonly number[] = [GENRE_HORROR, GENRE_THRILLER];
/** Entry threshold only (Q30): once in, a movie stays even if votes drop. */
export const MIN_VOTE_COUNT = 5;

export const LANGS = ["en", "ru"] as const;
export type Lang = (typeof LANGS)[number];
/** Preferred region per language when picking a translation. */
export const LANG_REGION: Record<Lang, string> = { en: "US", ru: "RU" };

export const RELEASE_COUNTRIES: readonly string[] = ["US", "RU"];
export const CAST_LIMIT = 15;
export const CREW_JOBS: readonly string[] = ["Director", "Writer", "Screenplay"];
export const VIDEO_SITE = "YouTube";
export const VIDEO_TYPES: readonly string[] = ["Trailer", "Teaser"];

/** Fetch wide (R2 keeps everything), store narrow (D1). Q14. */
export const MOVIE_APPEND = [
  "credits",
  "translations",
  "release_dates",
  "keywords",
  "external_ids",
  "videos",
  "images",
  "alternative_titles",
  "watch/providers",
] as const;

export const MOVIE_QUERY = {
  language: "en-US",
  append_to_response: MOVIE_APPEND.join(","),
  include_image_language: "en,ru,null",
  include_video_language: "en,ru",
} as const;

/** /discover hard limits (measured, docs/knowledge/tmdb.md). */
export const DISCOVER_PAGE_SIZE = 20;
export const DISCOVER_MAX_PAGES = 500;
export const DISCOVER_MAX_RESULTS = DISCOVER_PAGE_SIZE * DISCOVER_MAX_PAGES;
/** Upper bound used when slicing vote_count ranges. */
export const VOTE_COUNT_CEILING = 10_000_000;

/** /movie/changes accepts at most 14 days per query. */
export const CHANGES_MAX_DAYS = 14;
export const CHANGES_PAGE_SIZE = 100;

/** TMDB terms: cache ≤ 6 months. We refresh everything within 90 days (Q9). */
export const MAX_AGE_DAYS = 90;
/** Sweep ≈ active/80 per day ⇒ a full cycle in ≤ 80 days. */
export const SWEEP_DIVISOR = 80;
/** Soft-deleted / excluded rows are purged after this many days. */
export const PURGE_AFTER_DAYS = 90;
/** Crawl mode skips movies whose R2 copy is younger than this (resumable bootstrap). */
export const CRAWL_SKIP_FRESH_HOURS = 24;

export const DAY_MS = 86_400_000;
