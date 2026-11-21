/** Data fetching: TanStack Query on top of Void's typed fetch (paths, params and responses are type-checked). */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetch as api } from "void/client/react";

export const movieKeys = {
  all: ["movies"] as const,
  popular: () => [...movieKeys.all, "popular"] as const,
  search: (q: string) => [...movieKeys.all, "search", q] as const,
  detail: (id: number) => [...movieKeys.all, "detail", id] as const,
};

export const MIN_QUERY_LENGTH = 2;

export function usePopularMovies() {
  return useQuery({
    queryKey: movieKeys.popular(),
    queryFn: ({ signal }) => api("/api/movies/popular", { signal }),
    select: (d) => d.movies,
  });
}

export function useMovieSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: movieKeys.search(term),
    queryFn: ({ signal }) => api("/api/movies/search", { query: { q: term }, signal }),
    select: (d) => d.movies,
    enabled: term.length >= MIN_QUERY_LENGTH,
    placeholderData: keepPreviousData, // keep the old list while typing
  });
}

export function useMovie(id: number) {
  return useQuery({
    queryKey: movieKeys.detail(id),
    queryFn: ({ signal }) => api("/api/movies/:id", { params: { id: String(id) }, signal }),
    select: (d) => d.movie,
  });
}
