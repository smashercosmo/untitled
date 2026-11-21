import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { popularMovies } from "../../../server/tmdb";

/** The 4 most popular movies (= most voted, SPEC § 4.1) for the home page. */
export const GET = defineHandler(async (c) => {
  requireAuth(c);
  return { movies: await popularMovies(c.env.DB, 4) };
});
