import { describe, expect, it } from "vitest";
import { normalizeMovie } from "../src/normalize";
import { syntheticMovie } from "./fixtures/synthetic";

describe("normalizeMovie", () => {
  const n = normalizeMovie(syntheticMovie());

  it("maps core fields, nulls empty strings and zero money", () => {
    expect(n.core).toMatchObject({
      id: 900001,
      imdb_id: "tt9000001",
      wikidata_id: "Q900001",
      release_date: "2021-10-29",
      runtime: 97,
      budget: 1_000_000,
      revenue: null,
      homepage: null,
      collection_id: 7001,
      vote_count: 321,
    });
  });

  it("picks the best-voted Russian poster", () => {
    expect(n.core.poster_path).toBe("/en-poster.jpg");
    expect(n.core.poster_path_ru).toBe("/ru-best.jpg");
  });

  it("keeps only en and ru translations, preferring the language's home region", () => {
    expect(n.translations.map((t) => t.lang)).toEqual(["en", "ru"]);
    const ru = n.translations.find((t) => t.lang === "ru");
    expect(ru).toMatchObject({ title: "Фальшивое проклятие", tagline: null });
  });

  it("fills an empty translated title with original_title for the original language", () => {
    expect(n.translations.find((t) => t.lang === "en")?.title).toBe("The Fake Haunting");
  });

  it("stores no row for a language without any translated text", () => {
    const m = normalizeMovie(syntheticMovie({ translations: { translations: [] }, original_language: "ja" }));
    expect(m.translations).toEqual([]);
  });

  it("keeps the top 15 cast by order plus Director/Writer/Screenplay crew", () => {
    const cast = n.credits.filter((c) => c.kind === "cast");
    const crew = n.credits.filter((c) => c.kind === "crew");
    expect(cast).toHaveLength(15);
    expect(cast.map((c) => c.ord)).toEqual([...Array(15).keys()]);
    expect(crew.map((c) => c.job).sort()).toEqual(["Director", "Screenplay", "Writer"]);
  });

  it("dedupes people that appear in several credits", () => {
    expect(n.people).toHaveLength(17);
    expect(n.people.filter((p) => p.id === 200)).toHaveLength(1);
  });

  it("filters release dates to US and RU and keeps their order", () => {
    expect(n.releaseDates.map((r) => `${r.country}:${r.ord}:${r.type}`)).toEqual(["US:0:3", "US:1:4", "RU:0:3"]);
    expect(n.releaseDates[1]).toMatchObject({ certification: null, note: "Digital", release_date: "2021-11-19" });
  });

  it("keeps only YouTube trailers/teasers in en/ru", () => {
    expect(n.videos.map((v) => v.id)).toEqual(["v-en-trailer", "v-ru-teaser"]);
    expect(n.videos[0]?.official).toBe(1);
  });

  it("dedupes companies and sorts countries and genres", () => {
    expect(n.companies.map((c) => c.id)).toEqual([5001, 5002]);
    expect(n.countries).toEqual(["NO", "US"]);
    expect(n.genres).toEqual([27, 9648]);
  });
});
