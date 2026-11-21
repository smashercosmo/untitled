import { MEMBER_GENRES, MIN_VOTE_COUNT } from "./config";
import type { NormalizedMovie } from "./normalize";
import type { MovieState } from "./schema";

export function hasMemberGenre(genreIds: readonly number[]): boolean {
  return genreIds.some((g) => MEMBER_GENRES.includes(g));
}

export interface StateInput {
  movie: Pick<NormalizedMovie, "genres" | "adult" | "video" | "voteCount">;
  existingState: MovieState | null;
  pinned: boolean;
}

/**
 * SPEC § 2 / § 5.3:
 * - pinned movies always stay active;
 * - losing both genres (or becoming adult/video) excludes;
 * - vote_count ≥ MIN_VOTE_COUNT is an ENTRY rule only (Q30): an active movie never leaves because of votes.
 */
export function decideState({ movie, existingState, pinned }: StateInput): MovieState {
  if (pinned) return "active";
  if (movie.adult || movie.video || !hasMemberGenre(movie.genres)) return "excluded";
  if (existingState === "active") return "active";
  return movie.voteCount >= MIN_VOTE_COUNT ? "active" : "excluded";
}
