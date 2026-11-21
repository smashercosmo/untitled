import { MOVIE_QUERY } from "./config";
import type { ChangesPage, DiscoverPage, FindResponse, GenreList, TmdbMovie } from "./types";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type TmdbErrorKind = "not_found" | "rate_limited" | "transient" | "auth" | "bad_request";

export type TmdbResult<T> =
  | { ok: true; status: number; data: T; text: string }
  | { ok: false; status: number; kind: TmdbErrorKind; message: string };

export interface TmdbClientOptions {
  /** v4 Read Access Token (JWT, sent as Bearer) or v3 API key (sent as ?api_key=). Auto-detected. */
  token: string;
  fetch?: FetchFn;
  baseUrl?: string;
  timeoutMs?: number;
  /** Called once per outgoing request — feeds the spending guard's tmdb_requests counter. */
  onRequest?: () => void;
}

type Params = Record<string, string | number | undefined>;

export function isV4Token(token: string): boolean {
  return token.split(".").length === 3;
}

export function classifyStatus(status: number): TmdbErrorKind {
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth";
  if (status === 408 || status >= 500) return "transient";
  return "bad_request";
}

export class TmdbClient {
  readonly #token: string;
  readonly #bearer: boolean;
  readonly #fetch: FetchFn;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #onRequest: (() => void) | undefined;

  constructor(opts: TmdbClientOptions) {
    if (!opts.token) throw new Error("TMDB token is missing (set TMDB_READ_ACCESS_TOKEN)");
    this.#token = opts.token;
    this.#bearer = isV4Token(opts.token);
    // Never store the global fetch unbound — calling it detached throws "Illegal invocation" in Workers.
    this.#fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.#baseUrl = opts.baseUrl ?? "https://api.themoviedb.org/3";
    this.#timeoutMs = opts.timeoutMs ?? 15_000;
    this.#onRequest = opts.onRequest;
  }

  async get<T>(path: string, params: Params = {}): Promise<TmdbResult<T>> {
    const url = new URL(this.#baseUrl + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.#bearer) headers.Authorization = `Bearer ${this.#token}`;
    else url.searchParams.set("api_key", this.#token);

    this.#onRequest?.();
    let res: Response;
    try {
      res = await this.#fetch(url.toString(), { headers, signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch (e) {
      return { ok: false, status: 0, kind: "transient", message: e instanceof Error ? e.message : String(e) };
    }
    // TMDB responses are bounded (largest measured ≈ 270 KB), so buffering is safe.
    const text = await res.text();
    if (res.ok) {
      try {
        return { ok: true, status: res.status, data: JSON.parse(text) as T, text };
      } catch {
        return { ok: false, status: res.status, kind: "transient", message: "invalid JSON from TMDB" };
      }
    }
    let message = text.slice(0, 200);
    try {
      const body = JSON.parse(text) as { status_message?: string };
      if (body.status_message) message = body.status_message;
    } catch {
      /* keep raw text */
    }
    return { ok: false, status: res.status, kind: classifyStatus(res.status), message };
  }

  movie(id: number): Promise<TmdbResult<TmdbMovie>> {
    return this.get<TmdbMovie>(`/movie/${id}`, MOVIE_QUERY);
  }

  discover(params: Params): Promise<TmdbResult<DiscoverPage>> {
    return this.get<DiscoverPage>("/discover/movie", {
      include_adult: "false",
      include_video: "false",
      ...params,
    });
  }

  movieChanges(startDate: string, endDate: string, page: number): Promise<TmdbResult<ChangesPage>> {
    return this.get<ChangesPage>("/movie/changes", { start_date: startDate, end_date: endDate, page });
  }

  genres(language: string): Promise<TmdbResult<GenreList>> {
    return this.get<GenreList>("/genre/movie/list", { language });
  }

  find(externalId: string, source: "imdb_id" | "wikidata_id"): Promise<TmdbResult<FindResponse>> {
    return this.get<FindResponse>(`/find/${encodeURIComponent(externalId)}`, { external_source: source });
  }
}
