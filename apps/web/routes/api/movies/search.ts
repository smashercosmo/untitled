import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { z } from "zod";
import { searchMovies } from "../../../server/tmdb";

/** Title search (en / ru / original, prefix match, ё = е) via the FTS5 index. */
export const GET = defineHandler.withValidator({
  query: z.object({ q: z.string().trim().max(100) }),
})(async (c, { query }) => {
  requireAuth(c);
  return { movies: await searchMovies(c.env.DB, query.q, 20) };
});
