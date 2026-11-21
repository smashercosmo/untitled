# TMDB — verified facts

Facts gathered while designing the sync (2026-11-11). "Measured" means we observed it ourselves; "Docs" means TMDB's documentation says so. Re-verify anything older than a few months before relying on it.

## Authentication

- **v3 API key** (32 hex chars) → `?api_key=…` query parameter. Works, but the key ends up in URLs and logs.
- **v4 Read Access Token** (a JWT) → `Authorization: Bearer …`. Preferred; the sync uses this.
- Both work against the same v3 endpoints. Measured: both keys in `.dev.vars` authenticate.

## Daily ID exports

- Host and path: `https://files.tmdb.org/p/exports/{type}_ids_MM_DD_YYYY.json.gz`. No authentication (Docs: "could change").
- Format: gzipped, one JSON object per line (not a valid JSON document as a whole).
- Schedule: generated from about 07:00 UTC, all available by 08:00 UTC; kept for about 3 months (Docs).
- Files: `movie`, `tv_series`, `person`, `collection`, `tv_network`, `keyword`, `production_company`, plus separate `adult_movie`, `adult_tv_series`, `adult_person` files.
- Movie line (measured): `{"adult":false,"id":3924,"original_title":"Blondie","popularity":1.6248,"video":false}`.
- **Genres are NOT in the exports.** You can't select movies by genre from them, which is why the sync uses `/discover` instead (SPEC § Membership).
- Measured 2026-11-10:

  | Export | Lines |
  |---|---|
  | Movies | 1,273,418 (0 adult in the standard file; 65,776 `video:true`) |
  | TV series | 236,395 |
  | People | 5,061,272 |
  | Collections | 10,066 |

- Gzipped sizes 2026-11-10: movies 28 MB, people 78 MB, TV 5 MB.
- Daily churn, movies 11/09 → 11/10 (measured): 538 IDs added, 119 removed.
- Popularity changed for 99.9% of movies in one day (35% by more than 10%).

## `/discover/movie`

- `with_genres=27|53` means OR (either genre); `27,53` means AND (both).
- Defaults `include_adult=false`, `include_video=false`; the sync passes both explicitly.
- **At most 500 pages × 20 results = 10,000 results per query.** Page 501 returns HTTP 400 with `status_code` 22.
- **`total_results` is capped at 20,001**, so to enumerate or count a large set you split it into slices. The sync slices by `vote_count.gte`/`vote_count.lte`. Vote count is never null, so the slices cover everything.
- Horror (27) and Thriller (53) counts, measured 2026-11-11, summed over slices:

  | vote_count | Movies |
  |---|---|
  | any | ≥ 86,950 (the vote_count = 0 slice alone hits the 20,001 cap) |
  | ≥ 1 | 66,949 |
  | ≥ 5 | 39,593 ← chosen threshold |
  | ≥ 10 | 29,466 |
  | ≥ 20 | 20,775 |
  | ≥ 50 | 14,639 |

  Both genres (AND): 16,421. Horror only (27), summed the same way: about 57,109.
- Genre IDs: Horror = 27, Thriller = 53.

## `/movie/{id}`

- Request used by the sync:
  `/movie/{id}?language=en-US&append_to_response=credits,translations,release_dates,keywords,external_ids,videos,images,alternative_titles,watch/providers&include_image_language=en,ru,null&include_video_language=en,ru`
- Measured on 120 random Horror/Thriller movies (biased toward popular ones):
  - Response size: average 89 KB raw, 20 KB gzipped; p90 170 KB raw, 35 KB gzipped; max 271 KB.
  - Cast: average 31, p90 63, max 122. Crew: average 63, p90 135, max 512.
  - Top 15 cast plus Director, Writer and Screenplay jobs: average 16.2 credit rows per movie.
  - Russian title and overview present: 82%. IMDb ID: 98%. Wikidata ID: 89%.
  - Latency from a laptop in Europe: average 237 ms, p90 314 ms.
- `translations` includes every language, with `title`, `overview`, `tagline`, `homepage` and `runtime`. The title may be empty when the language equals the original language.
- Base `title`, `overview` and `poster_path` follow the `language` parameter, falling back to the original.

## Measured in the local end-to-end run (2026-11-11, the 300 most-voted Horror/Thriller movies)

- R2: about 13 MB for 300 movies gzipped (about 43 KB each; popular movies are the largest). D1: about 3 MB.
- D1 rows written by the seed: 55,208, which is **184 per movie**, index entries included.
- The 300 movies produced 3,729 distinct people, 5,247 credit rows, 2,808 keywords and 1,621 en/ru YouTube trailers and teasers.
- Every one has a Russian translation (popular titles), and all 19 genres have Russian names (`/genre/movie/list?language=ru`).
- Genre mix: 249 Thriller, 88 Horror (a movie can have both). The top four by votes are The Dark Knight, Fight Club, Pulp Fiction and Joker. TMDB applies "Thriller" broadly.
- `/movie/changes` for 11/10–11/11 matched 162 of the 300 (popular movies change often).
- A refetch minutes after the crawl left all section hashes unchanged, as expected.

## `/movie/changes`

- `start_date` and `end_date` cover up to 14 days per query. Pages hold 100 items: `{id, adult}`, and `adult` may be `null` (Docs).
- Measured: 13,714 movies changed on 2026-11-10, across all genres (138 pages).
- The docs don't say how far back `start_date` may go.

## Deleted movies

- Of 30 IDs that dropped out of the export 11/09 → 11/10: 28 return HTTP 404 with `status_code` 34; 2 now have `adult=true` (moved to the adult export).
- **No merge or redirect information exists in the API.** To remap, use the stored IMDb or Wikidata ID with `/find/{external_id}?external_source=imdb_id|wikidata_id`.

## Rate limits

- Docs: "somewhere in the 40 requests per second range", and it "could change at any time". The old 40 requests per 10 seconds limit was removed on 2019-12-16.
- Forum answers from TMDB staff mention about 20 connections per IP.
- **No rate-limit or `Retry-After` headers** (measured), so the sync implements its own exponential backoff.
- The API sits behind CloudFront. Workers share outgoing IPs with other Cloudflare customers, so some 429s may not be caused by us.

## Terms of use (abridged; read the original before going public)

- Don't cache any information "for longer than 6 months". The design refreshes everything within 90 days.
- No commercial use without a written agreement. That includes ads, subscriptions, paid apps, and use "on a chatbot or AI service".
- Don't use TMDB content to train ML or AI.
- Must show the TMDB logo (less prominent than your own branding) and the notice "uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB".
- On termination: stop using the API and "promptly delete or otherwise purge all TMDB Content, including any cached content".
