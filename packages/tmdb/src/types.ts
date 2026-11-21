/** Subset of TMDB response shapes the pipeline relies on. Unknown fields are ignored. */

export interface TmdbPersonCredit {
  id: number;
  adult?: boolean;
  gender?: number | null;
  known_for_department?: string | null;
  name: string;
  original_name?: string | null;
  profile_path?: string | null;
  credit_id: string;
}

export interface TmdbCast extends TmdbPersonCredit {
  character?: string | null;
  order?: number | null;
}

export interface TmdbCrew extends TmdbPersonCredit {
  department?: string | null;
  job: string;
}

export interface TmdbTranslation {
  iso_3166_1: string;
  iso_639_1: string;
  data: {
    title?: string | null;
    overview?: string | null;
    tagline?: string | null;
    homepage?: string | null;
    runtime?: number | null;
  };
}

export interface TmdbReleaseDate {
  certification?: string | null;
  iso_639_1?: string | null;
  note?: string | null;
  release_date: string;
  type: number;
}

export interface TmdbVideo {
  id: string;
  iso_639_1: string;
  iso_3166_1?: string;
  name: string;
  key: string;
  site: string;
  type: string;
  official?: boolean;
  published_at?: string | null;
}

export interface TmdbImage {
  file_path: string;
  iso_639_1: string | null;
  vote_average?: number;
  vote_count?: number;
}

export interface TmdbMovie {
  id: number;
  imdb_id?: string | null;
  title?: string | null;
  original_title: string;
  original_language?: string | null;
  overview?: string | null;
  tagline?: string | null;
  release_date?: string | null;
  runtime?: number | null;
  status?: string | null;
  budget?: number | null;
  revenue?: number | null;
  vote_average?: number | null;
  vote_count?: number | null;
  adult?: boolean;
  video?: boolean;
  homepage?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: { id: number; name: string }[];
  production_companies?: { id: number; name: string; logo_path?: string | null; origin_country?: string | null }[];
  production_countries?: { iso_3166_1: string; name?: string }[];
  belongs_to_collection?: {
    id: number;
    name: string;
    poster_path?: string | null;
    backdrop_path?: string | null;
  } | null;
  credits?: { cast?: TmdbCast[]; crew?: TmdbCrew[] };
  translations?: { translations?: TmdbTranslation[] };
  release_dates?: { results?: { iso_3166_1: string; release_dates: TmdbReleaseDate[] }[] };
  keywords?: { keywords?: { id: number; name: string }[] };
  external_ids?: { imdb_id?: string | null; wikidata_id?: string | null };
  videos?: { results?: TmdbVideo[] };
  images?: { posters?: TmdbImage[]; backdrops?: TmdbImage[] };
}

export interface DiscoverResult {
  id: number;
  vote_count: number;
  genre_ids?: number[];
}

export interface PagedResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export type DiscoverPage = PagedResponse<DiscoverResult>;
export type ChangesPage = PagedResponse<{ id: number; adult: boolean | null }>;

export interface GenreList {
  genres: { id: number; name: string }[];
}

export interface FindResponse {
  movie_results: { id: number; title?: string; release_date?: string }[];
}
