import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { movieDetail } from "../../../server/tmdb";

/**
 * Movie page data. "Not found" is `{ movie: null }` (200), not a 404: in Void's SPA mode any 404 from a
 * route — thrown or returned — falls through to index.html, which would break JSON clients.
 */
export const GET = defineHandler(async (c) => {
  requireAuth(c);
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) throw new HTTPException(400, { message: "invalid movie id" });
  return { movie: await movieDetail(c.env.DB, id) };
});
