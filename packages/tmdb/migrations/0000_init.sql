CREATE TABLE `tmdb_collections` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`poster_path` text,
	`backdrop_path` text
);
--> statement-breakpoint
CREATE TABLE `tmdb_companies` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`logo_path` text,
	`origin_country` text
);
--> statement-breakpoint
CREATE TABLE `tmdb_genres` (
	`id` integer PRIMARY KEY NOT NULL,
	`name_en` text,
	`name_ru` text
);
--> statement-breakpoint
CREATE TABLE `tmdb_guard_counters` (
	`day` text NOT NULL,
	`metric` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `metric`)
);
--> statement-breakpoint
CREATE TABLE `tmdb_keywords` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tmdb_movie_companies` (
	`movie_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	PRIMARY KEY(`movie_id`, `company_id`)
);
--> statement-breakpoint
CREATE TABLE `tmdb_movie_countries` (
	`movie_id` integer NOT NULL,
	`iso_3166_1` text NOT NULL,
	PRIMARY KEY(`movie_id`, `iso_3166_1`)
);
--> statement-breakpoint
CREATE TABLE `tmdb_movie_credits` (
	`credit_id` text PRIMARY KEY NOT NULL,
	`movie_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`kind` text NOT NULL,
	`character` text,
	`job` text,
	`ord` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tmdb_movie_credits_movie_idx` ON `tmdb_movie_credits` (`movie_id`);--> statement-breakpoint
CREATE INDEX `tmdb_movie_credits_person_idx` ON `tmdb_movie_credits` (`person_id`);--> statement-breakpoint
CREATE TABLE `tmdb_movie_genres` (
	`movie_id` integer NOT NULL,
	`genre_id` integer NOT NULL,
	PRIMARY KEY(`movie_id`, `genre_id`)
);
--> statement-breakpoint
CREATE INDEX `tmdb_movie_genres_genre_idx` ON `tmdb_movie_genres` (`genre_id`);--> statement-breakpoint
CREATE TABLE `tmdb_movie_keywords` (
	`movie_id` integer NOT NULL,
	`keyword_id` integer NOT NULL,
	PRIMARY KEY(`movie_id`, `keyword_id`)
);
--> statement-breakpoint
CREATE TABLE `tmdb_movie_redirects` (
	`old_id` integer PRIMARY KEY NOT NULL,
	`new_id` integer NOT NULL,
	`method` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tmdb_movie_translations` (
	`movie_id` integer NOT NULL,
	`lang` text NOT NULL,
	`title` text,
	`overview` text,
	`tagline` text,
	PRIMARY KEY(`movie_id`, `lang`)
);
--> statement-breakpoint
CREATE TABLE `tmdb_movies` (
	`id` integer PRIMARY KEY NOT NULL,
	`imdb_id` text,
	`wikidata_id` text,
	`original_title` text NOT NULL,
	`original_language` text,
	`release_date` text,
	`runtime` integer,
	`status` text,
	`budget` integer,
	`revenue` integer,
	`vote_average` real,
	`vote_count` integer DEFAULT 0 NOT NULL,
	`poster_path` text,
	`poster_path_ru` text,
	`backdrop_path` text,
	`collection_id` integer,
	`homepage` text,
	`state` text NOT NULL,
	`state_changed_at` integer NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_synced_at` integer NOT NULL,
	`section_hashes` text
);
--> statement-breakpoint
CREATE INDEX `tmdb_movies_state_synced_idx` ON `tmdb_movies` (`state`,`last_synced_at`);--> statement-breakpoint
CREATE TABLE `tmdb_parked` (
	`movie_id` integer PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`parked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tmdb_people` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`original_name` text,
	`gender` integer,
	`known_for_department` text,
	`profile_path` text,
	`adult` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tmdb_pinned_movies` (
	`movie_id` integer PRIMARY KEY NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tmdb_release_dates` (
	`movie_id` integer NOT NULL,
	`country` text NOT NULL,
	`ord` integer NOT NULL,
	`type` integer NOT NULL,
	`release_date` text,
	`certification` text,
	`note` text,
	PRIMARY KEY(`movie_id`, `country`, `ord`)
);
--> statement-breakpoint
CREATE TABLE `tmdb_run_counters` (
	`run_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`run_id`, `metric`)
);
--> statement-breakpoint
CREATE TABLE `tmdb_sync_failures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`movie_id` integer NOT NULL,
	`run_id` text,
	`reason` text NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `tmdb_sync_failures_movie_idx` ON `tmdb_sync_failures` (`movie_id`);--> statement-breakpoint
CREATE TABLE `tmdb_sync_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`stats` text
);
--> statement-breakpoint
CREATE TABLE `tmdb_sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tmdb_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`movie_id` integer NOT NULL,
	`iso_639_1` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`official` integer DEFAULT 0 NOT NULL,
	`published_at` text
);
--> statement-breakpoint
CREATE INDEX `tmdb_videos_movie_idx` ON `tmdb_videos` (`movie_id`);