-- Full-text search over movie titles (SPEC § 4.1). Custom migration: Drizzle can't model FTS5 tables.
-- rowid = tmdb_movies.id. Columns hold match text only (display text comes from the real tables).
-- unicode61 folds case for Cyrillic and strips Latin diacritics; "ё" is folded to "е" by hand,
-- because remove_diacritics only applies to Latin script. Queries must apply the same folding.
CREATE VIRTUAL TABLE `tmdb_movie_search` USING fts5(
	original_title,
	title_en,
	title_ru,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `tmdb_movies_search_ai` AFTER INSERT ON `tmdb_movies` BEGIN
	DELETE FROM tmdb_movie_search WHERE rowid = NEW.id;
	INSERT INTO tmdb_movie_search (rowid, original_title, title_en, title_ru) VALUES (
		NEW.id,
		replace(replace(NEW.original_title, 'ё', 'е'), 'Ё', 'Е'),
		(SELECT replace(replace(title, 'ё', 'е'), 'Ё', 'Е') FROM tmdb_movie_translations WHERE movie_id = NEW.id AND lang = 'en'),
		(SELECT replace(replace(title, 'ё', 'е'), 'Ё', 'Е') FROM tmdb_movie_translations WHERE movie_id = NEW.id AND lang = 'ru')
	);
END;
--> statement-breakpoint
CREATE TRIGGER `tmdb_movies_search_au` AFTER UPDATE OF original_title ON `tmdb_movies`
WHEN OLD.original_title IS NOT NEW.original_title BEGIN
	DELETE FROM tmdb_movie_search WHERE rowid = NEW.id;
	INSERT INTO tmdb_movie_search (rowid, original_title, title_en, title_ru) VALUES (
		NEW.id,
		replace(replace(NEW.original_title, 'ё', 'е'), 'Ё', 'Е'),
		(SELECT replace(replace(title, 'ё', 'е'), 'Ё', 'Е') FROM tmdb_movie_translations WHERE movie_id = NEW.id AND lang = 'en'),
		(SELECT replace(replace(title, 'ё', 'е'), 'Ё', 'Е') FROM tmdb_movie_translations WHERE movie_id = NEW.id AND lang = 'ru')
	);
END;
--> statement-breakpoint
CREATE TRIGGER `tmdb_movies_search_ad` AFTER DELETE ON `tmdb_movies` BEGIN
	DELETE FROM tmdb_movie_search WHERE rowid = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER `tmdb_translations_search_ai` AFTER INSERT ON `tmdb_movie_translations` BEGIN
	DELETE FROM tmdb_movie_search WHERE rowid = NEW.movie_id;
	INSERT INTO tmdb_movie_search (rowid, original_title, title_en, title_ru)
	SELECT m.id,
		replace(replace(m.original_title, 'ё', 'е'), 'Ё', 'Е'),
		(SELECT replace(replace(title, 'ё', 'е'), 'Ё', 'Е') FROM tmdb_movie_translations WHERE movie_id = m.id AND lang = 'en'),
		(SELECT replace(replace(title, 'ё', 'е'), 'Ё', 'Е') FROM tmdb_movie_translations WHERE movie_id = m.id AND lang = 'ru')
	FROM tmdb_movies m WHERE m.id = NEW.movie_id;
END;
--> statement-breakpoint
CREATE TRIGGER `tmdb_translations_search_au` AFTER UPDATE ON `tmdb_movie_translations` BEGIN
	DELETE FROM tmdb_movie_search WHERE rowid = NEW.movie_id;
	INSERT INTO tmdb_movie_search (rowid, original_title, title_en, title_ru)
	SELECT m.id,
		replace(replace(m.original_title, 'ё', 'е'), 'Ё', 'Е'),
		(SELECT replace(replace(title, 'ё', 'е'), 'Ё', 'Е') FROM tmdb_movie_translations WHERE movie_id = m.id AND lang = 'en'),
		(SELECT replace(replace(title, 'ё', 'е'), 'Ё', 'Е') FROM tmdb_movie_translations WHERE movie_id = m.id AND lang = 'ru')
	FROM tmdb_movies m WHERE m.id = NEW.movie_id;
END;
--> statement-breakpoint
CREATE TRIGGER `tmdb_translations_search_ad` AFTER DELETE ON `tmdb_movie_translations` BEGIN
	DELETE FROM tmdb_movie_search WHERE rowid = OLD.movie_id;
	INSERT INTO tmdb_movie_search (rowid, original_title, title_en, title_ru)
	SELECT m.id,
		replace(replace(m.original_title, 'ё', 'е'), 'Ё', 'Е'),
		(SELECT replace(replace(title, 'ё', 'е'), 'Ё', 'Е') FROM tmdb_movie_translations WHERE movie_id = m.id AND lang = 'en'),
		(SELECT replace(replace(title, 'ё', 'е'), 'Ё', 'Е') FROM tmdb_movie_translations WHERE movie_id = m.id AND lang = 'ru')
	FROM tmdb_movies m WHERE m.id = OLD.movie_id;
END;
--> statement-breakpoint
-- Backfill rows that existed before this migration.
INSERT INTO tmdb_movie_search (rowid, original_title, title_en, title_ru)
SELECT m.id,
	replace(replace(m.original_title, 'ё', 'е'), 'Ё', 'Е'),
	(SELECT replace(replace(title, 'ё', 'е'), 'Ё', 'Е') FROM tmdb_movie_translations WHERE movie_id = m.id AND lang = 'en'),
	(SELECT replace(replace(title, 'ё', 'е'), 'Ё', 'Е') FROM tmdb_movie_translations WHERE movie_id = m.id AND lang = 'ru')
FROM tmdb_movies m;
