import type { FetchFn, TmdbMovie } from "@movies/tmdb";
import { env } from "cloudflare:workers";
import type { FetchMessage } from "../src/messages";

export interface FakeMessage extends Message<FetchMessage> {
  acked: boolean;
  retriedWith: QueueRetryOptions | undefined;
}

export function makeBatch(bodies: FetchMessage[], queue = "tmdb-fetch", attempts = 1) {
  const messages = bodies.map((body, i): FakeMessage => {
    const m: FakeMessage = {
      id: `msg-${i}`,
      timestamp: new Date(),
      body,
      attempts,
      acked: false,
      retriedWith: undefined,
      ack: () => {
        m.acked = true;
      },
      retry: (options?: QueueRetryOptions) => {
        m.retriedWith = options ?? {};
      },
    };
    return m;
  });
  const batch: MessageBatch<FetchMessage> = {
    queue,
    messages,
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    ackAll: () => messages.forEach((m) => m.ack()),
    retryAll: (o) => messages.forEach((m) => m.retry(o)),
  };
  return { batch, messages };
}

/** Routes fake TMDB responses by path; records every request path. */
export function fakeTmdb(routes: Record<string, (url: URL) => Response>) {
  const calls: string[] = [];
  const fetch: FetchFn = async (input) => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/3/, "");
    calls.push(path);
    const route = routes[path];
    return route ? route(url) : Response.json({ status_code: 34, status_message: "not found" }, { status: 404 });
  };
  return { fetch, calls };
}

export const movieRoute = (m: TmdbMovie) => ({ [`/movie/${m.id}`]: () => Response.json(m) });

export function recordingQueue() {
  const sent: unknown[] = [];
  const metadata = { metrics: { backlogCount: 0, backlogBytes: 0 } };
  const queue: Queue = {
    metrics: async () => ({ backlogCount: 0, backlogBytes: 0 }),
    send: async (body) => {
      sent.push(body);
      return { metadata };
    },
    sendBatch: async (msgs) => {
      for (const m of msgs) sent.push(m.body);
      return { metadata };
    },
  };
  return { queue, sent };
}

const TABLES = [
  "tmdb_movies",
  "tmdb_movie_translations",
  "tmdb_genres",
  "tmdb_movie_genres",
  "tmdb_keywords",
  "tmdb_movie_keywords",
  "tmdb_companies",
  "tmdb_movie_companies",
  "tmdb_movie_countries",
  "tmdb_collections",
  "tmdb_release_dates",
  "tmdb_videos",
  "tmdb_people",
  "tmdb_movie_credits",
  "tmdb_movie_redirects",
  "tmdb_pinned_movies",
  "tmdb_sync_state",
  "tmdb_sync_runs",
  "tmdb_run_counters",
  "tmdb_guard_counters",
  "tmdb_parked",
  "tmdb_sync_failures",
];

export async function resetStorage(): Promise<void> {
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  const listed = await env.RAW.list();
  if (listed.objects.length) await env.RAW.delete(listed.objects.map((o) => o.key));
}

export async function scalar<T = number>(sql: string, ...params: unknown[]): Promise<T> {
  const row = await env.DB.prepare(sql).bind(...params).first<Record<string, T>>();
  return Object.values(row ?? {})[0] as T;
}
