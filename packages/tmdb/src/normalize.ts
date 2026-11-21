import {
  CAST_LIMIT,
  CREW_JOBS,
  LANG_REGION,
  LANGS,
  type Lang,
  RELEASE_COUNTRIES,
  VIDEO_SITE,
  VIDEO_TYPES,
} from "./config";
import type { TmdbImage, TmdbMovie, TmdbTranslation } from "./types";

export interface MovieCore {
  id: number;
  imdb_id: string | null;
  wikidata_id: string | null;
  original_title: string;
  original_language: string | null;
  release_date: string | null;
  runtime: number | null;
  status: string | null;
  budget: number | null;
  revenue: number | null;
  vote_average: number | null;
  vote_count: number;
  poster_path: string | null;
  poster_path_ru: string | null;
  backdrop_path: string | null;
  collection_id: number | null;
  homepage: string | null;
}

export interface TranslationRow {
  movie_id: number;
  lang: Lang;
  title: string | null;
  overview: string | null;
  tagline: string | null;
}

export interface KeywordRow {
  id: number;
  name: string;
}

export interface CompanyRow {
  id: number;
  name: string;
  logo_path: string | null;
  origin_country: string | null;
}

export interface CollectionRow {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
}

export interface ReleaseDateRow {
  movie_id: number;
  country: string;
  ord: number;
  type: number;
  release_date: string | null;
  certification: string | null;
  note: string | null;
}

export interface VideoRow {
  id: string;
  movie_id: number;
  iso_639_1: string;
  key: string;
  name: string;
  type: string;
  official: 0 | 1;
  published_at: string | null;
}

export interface CreditRow {
  credit_id: string;
  movie_id: number;
  person_id: number;
  kind: "cast" | "crew";
  character: string | null;
  job: string | null;
  ord: number;
}

export interface PersonRow {
  id: number;
  name: string;
  original_name: string | null;
  gender: number | null;
  known_for_department: string | null;
  profile_path: string | null;
  adult: 0 | 1;
}

export interface NormalizedMovie {
  id: number;
  adult: boolean;
  video: boolean;
  voteCount: number;
  core: MovieCore;
  translations: TranslationRow[];
  genres: number[];
  keywords: KeywordRow[];
  companies: CompanyRow[];
  countries: string[];
  collection: CollectionRow | null;
  releaseDates: ReleaseDateRow[];
  videos: VideoRow[];
  credits: CreditRow[];
  people: PersonRow[];
}

const str = (v: string | null | undefined): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return t.length > 0 ? t : null;
};
const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const date = (v: string | null | undefined): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

function pickTranslation(list: TmdbTranslation[], lang: Lang): TmdbTranslation | undefined {
  const candidates = list.filter((t) => t.iso_639_1 === lang);
  return candidates.find((t) => t.iso_3166_1 === LANG_REGION[lang]) ?? candidates[0];
}

function buildTranslations(m: TmdbMovie): TranslationRow[] {
  const list = m.translations?.translations ?? [];
  const rows: TranslationRow[] = [];
  for (const lang of LANGS) {
    const t = pickTranslation(list, lang);
    let title = str(t?.data.title);
    let overview = str(t?.data.overview);
    let tagline = str(t?.data.tagline);
    // The base response is requested in en-US; use it for English-original films lacking an "en" translation entry.
    if (!t && lang === "en" && m.original_language === "en") {
      title = str(m.title);
      overview = str(m.overview);
      tagline = str(m.tagline);
    }
    // TMDB leaves the translated title empty when it equals the original title.
    if (!title && (t || overview || tagline) && m.original_language === lang) title = str(m.original_title);
    if (title || overview || tagline) rows.push({ movie_id: m.id, lang, title, overview, tagline });
  }
  return rows;
}

function bestPoster(posters: TmdbImage[] | undefined, lang: string): string | null {
  const sorted = (posters ?? [])
    .filter((p) => p.iso_639_1 === lang)
    .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0) || (b.vote_count ?? 0) - (a.vote_count ?? 0));
  return sorted[0]?.file_path ?? null;
}

export function normalizeMovie(m: TmdbMovie): NormalizedMovie {
  const collection = m.belongs_to_collection
    ? {
        id: m.belongs_to_collection.id,
        name: m.belongs_to_collection.name,
        poster_path: str(m.belongs_to_collection.poster_path),
        backdrop_path: str(m.belongs_to_collection.backdrop_path),
      }
    : null;

  const core: MovieCore = {
    id: m.id,
    imdb_id: str(m.external_ids?.imdb_id) ?? str(m.imdb_id),
    wikidata_id: str(m.external_ids?.wikidata_id),
    original_title: m.original_title,
    original_language: str(m.original_language),
    release_date: date(m.release_date),
    runtime: num(m.runtime) || null,
    status: str(m.status),
    budget: num(m.budget) || null,
    revenue: num(m.revenue) || null,
    vote_average: num(m.vote_average),
    vote_count: num(m.vote_count) ?? 0,
    poster_path: str(m.poster_path),
    poster_path_ru: bestPoster(m.images?.posters, "ru"),
    backdrop_path: str(m.backdrop_path),
    collection_id: collection?.id ?? null,
    homepage: str(m.homepage),
  };

  const keywords = dedupeBy(m.keywords?.keywords ?? [], (k) => k.id).map((k) => ({ id: k.id, name: k.name }));
  const companies = dedupeBy(m.production_companies ?? [], (c) => c.id).map((c) => ({
    id: c.id,
    name: c.name,
    logo_path: str(c.logo_path),
    origin_country: str(c.origin_country),
  }));
  const countries = [...new Set((m.production_countries ?? []).map((c) => c.iso_3166_1))].sort();
  const genres = [...new Set((m.genres ?? []).map((g) => g.id))].sort((a, b) => a - b);

  const releaseDates: ReleaseDateRow[] = [];
  for (const r of m.release_dates?.results ?? []) {
    if (!RELEASE_COUNTRIES.includes(r.iso_3166_1)) continue;
    r.release_dates.forEach((d, ord) =>
      releaseDates.push({
        movie_id: m.id,
        country: r.iso_3166_1,
        ord,
        type: d.type,
        release_date: date(d.release_date),
        certification: str(d.certification),
        note: str(d.note),
      }),
    );
  }

  const videos: VideoRow[] = dedupeBy(m.videos?.results ?? [], (v) => v.id)
    .filter((v) => v.site === VIDEO_SITE && VIDEO_TYPES.includes(v.type) && (v.iso_639_1 === "en" || v.iso_639_1 === "ru"))
    .map((v) => ({
      id: v.id,
      movie_id: m.id,
      iso_639_1: v.iso_639_1,
      key: v.key,
      name: v.name,
      type: v.type,
      official: v.official ? 1 : 0,
      published_at: str(v.published_at),
    }));

  const cast = [...(m.credits?.cast ?? [])]
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .slice(0, CAST_LIMIT);
  const crew = (m.credits?.crew ?? []).filter((c) => CREW_JOBS.includes(c.job));
  const credits: CreditRow[] = dedupeBy(
    [
      ...cast.map((c, i) => ({
        credit_id: c.credit_id,
        movie_id: m.id,
        person_id: c.id,
        kind: "cast" as const,
        character: str(c.character),
        job: null,
        ord: c.order ?? i,
      })),
      ...crew.map((c, i) => ({
        credit_id: c.credit_id,
        movie_id: m.id,
        person_id: c.id,
        kind: "crew" as const,
        character: null,
        job: c.job,
        ord: i,
      })),
    ],
    (c) => c.credit_id,
  );
  const people: PersonRow[] = dedupeBy([...cast, ...crew], (p) => p.id).map((p) => ({
    id: p.id,
    name: p.name,
    original_name: str(p.original_name),
    gender: num(p.gender),
    known_for_department: str(p.known_for_department),
    profile_path: str(p.profile_path),
    adult: p.adult ? 1 : 0,
  }));

  return {
    id: m.id,
    adult: m.adult === true,
    video: m.video === true,
    voteCount: core.vote_count,
    core,
    translations: buildTranslations(m),
    genres,
    keywords,
    companies,
    countries,
    collection,
    releaseDates,
    videos,
    credits,
    people,
  };
}

function dedupeBy<T, K>(items: T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
