/**
 * Drizzle definitions of the tmdb_* tables (SPEC § 4).
 * Source of truth for migrations (`pnpm --filter @movies/tmdb db:generate`) and for typed reads in the app.
 * The Void app must import these from "@movies/tmdb/schema" and NEVER copy them into its own db/schema.ts.
 */
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const movieStates = ["active", "excluded", "deleted"] as const;
export type MovieState = (typeof movieStates)[number];

export const tmdbMovies = sqliteTable(
  "tmdb_movies",
  {
    id: integer("id").primaryKey(),
    imdbId: text("imdb_id"),
    wikidataId: text("wikidata_id"),
    originalTitle: text("original_title").notNull(),
    originalLanguage: text("original_language"),
    releaseDate: text("release_date"),
    runtime: integer("runtime"),
    status: text("status"),
    budget: integer("budget"),
    revenue: integer("revenue"),
    voteAverage: real("vote_average"),
    voteCount: integer("vote_count").notNull().default(0),
    posterPath: text("poster_path"),
    posterPathRu: text("poster_path_ru"),
    backdropPath: text("backdrop_path"),
    collectionId: integer("collection_id"),
    homepage: text("homepage"),
    state: text("state", { enum: movieStates }).notNull(),
    stateChangedAt: integer("state_changed_at").notNull(),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSyncedAt: integer("last_synced_at").notNull(),
    sectionHashes: text("section_hashes"),
  },
  (t) => [
    index("tmdb_movies_state_synced_idx").on(t.state, t.lastSyncedAt),
    // App: "most popular" = most voted (SPEC § 4.1).
    index("tmdb_movies_state_votes_idx").on(t.state, t.voteCount),
  ],
);

export const tmdbMovieTranslations = sqliteTable(
  "tmdb_movie_translations",
  {
    movieId: integer("movie_id").notNull(),
    lang: text("lang").notNull(),
    title: text("title"),
    overview: text("overview"),
    tagline: text("tagline"),
  },
  (t) => [primaryKey({ columns: [t.movieId, t.lang] })],
);

export const tmdbGenres = sqliteTable("tmdb_genres", {
  id: integer("id").primaryKey(),
  nameEn: text("name_en"),
  nameRu: text("name_ru"),
});

export const tmdbMovieGenres = sqliteTable(
  "tmdb_movie_genres",
  {
    movieId: integer("movie_id").notNull(),
    genreId: integer("genre_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.movieId, t.genreId] }), index("tmdb_movie_genres_genre_idx").on(t.genreId)],
);

export const tmdbKeywords = sqliteTable("tmdb_keywords", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
});

export const tmdbMovieKeywords = sqliteTable(
  "tmdb_movie_keywords",
  {
    movieId: integer("movie_id").notNull(),
    keywordId: integer("keyword_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.movieId, t.keywordId] })],
);

export const tmdbCompanies = sqliteTable("tmdb_companies", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  logoPath: text("logo_path"),
  originCountry: text("origin_country"),
});

export const tmdbMovieCompanies = sqliteTable(
  "tmdb_movie_companies",
  {
    movieId: integer("movie_id").notNull(),
    companyId: integer("company_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.movieId, t.companyId] })],
);

export const tmdbMovieCountries = sqliteTable(
  "tmdb_movie_countries",
  {
    movieId: integer("movie_id").notNull(),
    iso31661: text("iso_3166_1").notNull(),
  },
  (t) => [primaryKey({ columns: [t.movieId, t.iso31661] })],
);

export const tmdbCollections = sqliteTable("tmdb_collections", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  posterPath: text("poster_path"),
  backdropPath: text("backdrop_path"),
});

export const tmdbReleaseDates = sqliteTable(
  "tmdb_release_dates",
  {
    movieId: integer("movie_id").notNull(),
    country: text("country").notNull(),
    ord: integer("ord").notNull(),
    type: integer("type").notNull(),
    releaseDate: text("release_date"),
    certification: text("certification"),
    note: text("note"),
  },
  (t) => [primaryKey({ columns: [t.movieId, t.country, t.ord] })],
);

export const tmdbVideos = sqliteTable(
  "tmdb_videos",
  {
    id: text("id").primaryKey(),
    movieId: integer("movie_id").notNull(),
    iso6391: text("iso_639_1").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    official: integer("official").notNull().default(0),
    publishedAt: text("published_at"),
  },
  (t) => [index("tmdb_videos_movie_idx").on(t.movieId)],
);

export const tmdbPeople = sqliteTable("tmdb_people", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  originalName: text("original_name"),
  gender: integer("gender"),
  knownForDepartment: text("known_for_department"),
  profilePath: text("profile_path"),
  adult: integer("adult").notNull().default(0),
});

export const tmdbMovieCredits = sqliteTable(
  "tmdb_movie_credits",
  {
    creditId: text("credit_id").primaryKey(),
    movieId: integer("movie_id").notNull(),
    personId: integer("person_id").notNull(),
    kind: text("kind", { enum: ["cast", "crew"] }).notNull(),
    character: text("character"),
    job: text("job"),
    ord: integer("ord").notNull(),
  },
  (t) => [
    index("tmdb_movie_credits_movie_idx").on(t.movieId),
    index("tmdb_movie_credits_person_idx").on(t.personId),
  ],
);

export const tmdbMovieRedirects = sqliteTable("tmdb_movie_redirects", {
  oldId: integer("old_id").primaryKey(),
  newId: integer("new_id").notNull(),
  method: text("method", { enum: ["imdb", "wikidata"] }).notNull(),
  createdAt: integer("created_at").notNull(),
});

export const tmdbPinnedMovies = sqliteTable("tmdb_pinned_movies", {
  movieId: integer("movie_id").primaryKey(),
  reason: text("reason"),
  createdAt: integer("created_at").notNull(),
});

export const tmdbSyncState = sqliteTable("tmdb_sync_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const tmdbSyncRuns = sqliteTable("tmdb_sync_runs", {
  runId: text("run_id").primaryKey(),
  mode: text("mode").notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  status: text("status").notNull(),
  stats: text("stats"),
});

export const tmdbRunCounters = sqliteTable(
  "tmdb_run_counters",
  {
    runId: text("run_id").notNull(),
    metric: text("metric").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.runId, t.metric] })],
);

export const tmdbGuardCounters = sqliteTable(
  "tmdb_guard_counters",
  {
    day: text("day").notNull(),
    metric: text("metric").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.metric] })],
);

export const tmdbParked = sqliteTable("tmdb_parked", {
  movieId: integer("movie_id").primaryKey(),
  reason: text("reason").notNull(),
  parkedAt: integer("parked_at").notNull(),
});

export const tmdbSyncFailures = sqliteTable(
  "tmdb_sync_failures",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    movieId: integer("movie_id").notNull(),
    runId: text("run_id"),
    reason: text("reason").notNull(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [index("tmdb_sync_failures_movie_idx").on(t.movieId)],
);
