/**
 * Hand-made, TMDB-shaped FAKE movie (Q32: no real TMDB content is committed).
 * Shape mirrors /movie/{id}?append_to_response=credits,translations,release_dates,keywords,external_ids,videos,images,…
 */
import type { TmdbMovie } from "../../src/types";

const CAST_ORDERS = [5, 0, 17, 2, 9, 1, 3, 16, 4, 8, 6, 7, 10, 12, 11, 15, 13, 14];

export function syntheticMovie(overrides: Partial<TmdbMovie> = {}): TmdbMovie {
  return {
    id: 900001,
    imdb_id: "tt9000001",
    title: "The Fake Haunting",
    original_title: "The Fake Haunting",
    original_language: "en",
    overview: "A synthetic family moves into a synthetic house.",
    tagline: "Nothing here is real.",
    release_date: "2021-10-29",
    runtime: 97,
    status: "Released",
    budget: 1_000_000,
    revenue: 0,
    vote_average: 6.4,
    vote_count: 321,
    adult: false,
    video: false,
    homepage: "",
    poster_path: "/en-poster.jpg",
    backdrop_path: "/backdrop.jpg",
    genres: [
      { id: 27, name: "Horror" },
      { id: 9648, name: "Mystery" },
    ],
    production_companies: [
      { id: 5001, name: "Fake Pictures", logo_path: "/logo.png", origin_country: "US" },
      { id: 5002, name: "Nordic Fakes", logo_path: null, origin_country: "NO" },
      { id: 5001, name: "Fake Pictures", logo_path: "/logo.png", origin_country: "US" },
    ],
    production_countries: [
      { iso_3166_1: "US", name: "United States of America" },
      { iso_3166_1: "NO", name: "Norway" },
    ],
    belongs_to_collection: { id: 7001, name: "The Fake Haunting Collection", poster_path: "/coll.jpg", backdrop_path: null },
    credits: {
      cast: CAST_ORDERS.map((order, i) => ({
        id: 100 + i,
        adult: false,
        gender: i % 3,
        known_for_department: "Acting",
        name: `Actor ${i}`,
        original_name: `Actor ${i}`,
        profile_path: i % 2 ? `/actor-${i}.jpg` : null,
        credit_id: `c-cast-${i}`,
        character: `Character ${i}`,
        order,
      })),
      crew: [
        { id: 200, name: "Dee Rector", credit_id: "c-crew-dir", job: "Director", department: "Directing", known_for_department: "Directing" },
        { id: 201, name: "Scree N. Play", credit_id: "c-crew-scr", job: "Screenplay", department: "Writing", known_for_department: "Writing" },
        { id: 200, name: "Dee Rector", credit_id: "c-crew-wri", job: "Writer", department: "Writing", known_for_department: "Directing" },
        { id: 202, name: "Pro Ducer", credit_id: "c-crew-pro", job: "Producer", department: "Production" },
        { id: 203, name: "Com Poser", credit_id: "c-crew-mus", job: "Original Music Composer", department: "Sound" },
      ],
    },
    translations: {
      translations: [
        { iso_3166_1: "US", iso_639_1: "en", data: { title: "", overview: "A synthetic family moves into a synthetic house.", tagline: "Nothing here is real." } },
        { iso_3166_1: "UA", iso_639_1: "ru", data: { title: "Не тот перевод", overview: "Региональный вариант.", tagline: "" } },
        { iso_3166_1: "RU", iso_639_1: "ru", data: { title: "Фальшивое проклятие", overview: "Синтетическая семья переезжает в синтетический дом.", tagline: "" } },
        { iso_3166_1: "FR", iso_639_1: "fr", data: { title: "La Fausse Hantise", overview: "Une famille synthétique.", tagline: "" } },
      ],
    },
    release_dates: {
      results: [
        {
          iso_3166_1: "US",
          release_dates: [
            { certification: "R", iso_639_1: "", note: "", release_date: "2021-10-29T00:00:00.000Z", type: 3 },
            { certification: "", iso_639_1: "", note: "Digital", release_date: "2021-11-19T00:00:00.000Z", type: 4 },
          ],
        },
        { iso_3166_1: "RU", release_dates: [{ certification: "18+", note: "", release_date: "2021-11-04T00:00:00.000Z", type: 3 }] },
        { iso_3166_1: "DE", release_dates: [{ certification: "16", note: "", release_date: "2021-11-05T00:00:00.000Z", type: 3 }] },
      ],
    },
    keywords: {
      keywords: [
        { id: 8001, name: "haunted house" },
        { id: 8002, name: "family" },
      ],
    },
    external_ids: { imdb_id: "tt9000001", wikidata_id: "Q900001" },
    videos: {
      results: [
        { id: "v-en-trailer", iso_639_1: "en", iso_3166_1: "US", name: "Official Trailer", key: "yt_en_1", site: "YouTube", type: "Trailer", official: true, published_at: "2021-09-01T16:00:00.000Z" },
        { id: "v-ru-teaser", iso_639_1: "ru", iso_3166_1: "RU", name: "Тизер", key: "yt_ru_1", site: "YouTube", type: "Teaser", official: false, published_at: null },
        { id: "v-vimeo", iso_639_1: "en", name: "Vimeo Trailer", key: "vm_1", site: "Vimeo", type: "Trailer" },
        { id: "v-featurette", iso_639_1: "en", name: "Behind the scenes", key: "yt_en_2", site: "YouTube", type: "Featurette" },
      ],
    },
    images: {
      posters: [
        { file_path: "/ru-low.jpg", iso_639_1: "ru", vote_average: 3.1, vote_count: 2 },
        { file_path: "/ru-best.jpg", iso_639_1: "ru", vote_average: 5.5, vote_count: 4 },
        { file_path: "/en-poster.jpg", iso_639_1: "en", vote_average: 5.3, vote_count: 10 },
      ],
      backdrops: [],
    },
    ...overrides,
  };
}
