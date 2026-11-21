import type { MovieCard } from "@movies/tmdb";
import { useEffect, useRef, useState } from "react";
import { MIN_QUERY_LENGTH, useMovieSearch, usePopularMovies } from "../api";
import { Poster } from "../components/Poster";
import { Link, navigate, useLocation } from "../router";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function HomePage() {
  const url = useLocation();
  const urlQuery = url.searchParams.get("q") ?? "";
  const [input, setInput] = useState(urlQuery);
  const query = useDebounced(input, 250);
  const lastPushed = useRef(urlQuery);

  // Typing → URL (?q=…), so a reload or the back button keeps the search.
  useEffect(() => {
    if (query === lastPushed.current) return;
    lastPushed.current = query;
    navigate(query ? `/?q=${encodeURIComponent(query)}` : "/", { replace: true });
  }, [query]);
  // URL → input (back/forward navigation).
  useEffect(() => {
    if (urlQuery !== lastPushed.current) {
      lastPushed.current = urlQuery;
      setInput(urlQuery);
    }
  }, [urlQuery]);

  const searching = query.trim().length >= MIN_QUERY_LENGTH;
  const results = useMovieSearch(query);
  const popular = usePopularMovies();

  const openFirst = () => {
    const first = results.data?.[0];
    if (searching && first) navigate(`/movie/${first.id}`);
  };

  return (
    <div className="home">
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          openFirst();
        }}
      >
        <input
          type="search"
          className="search-input"
          placeholder="Search horror & thriller movies — English or русский"
          aria-label="Search movies"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
      </form>

      {searching ? (
        <section aria-live="polite" aria-busy={results.isFetching}>
          {results.isPending ? (
            <p className="muted center">Searching…</p>
          ) : results.isError ? (
            <p className="error center">Search failed. Try again.</p>
          ) : results.data.length === 0 ? (
            <p className="muted center">No movies match “{query.trim()}”.</p>
          ) : (
            <ul className="results">
              {results.data.map((m) => (
                <li key={m.id}>
                  <ResultRow movie={m} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section aria-labelledby="popular-title">
          <h2 id="popular-title" className="section-title">
            Most popular
          </h2>
          {popular.isPending ? (
            <div className="grid">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="poster skeleton" />
              ))}
            </div>
          ) : popular.isError ? (
            <p className="error center">Couldn’t load movies.</p>
          ) : (
            <div className="grid">
              {popular.data.map((m) => (
                <Link key={m.id} to={`/movie/${m.id}`} className="card">
                  <Poster path={m.posterPath} size="w342" title={m.title} />
                  <span className="card-title">{m.title}</span>
                  <span className="card-meta">
                    {m.year ?? "—"}
                    {m.titleRu && m.titleRu !== m.title ? ` · ${m.titleRu}` : ""}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ResultRow({ movie: m }: { movie: MovieCard }) {
  return (
    <Link to={`/movie/${m.id}`} className="result">
      <Poster path={m.posterPath} size="w92" title={m.title} className="thumb" />
      <span className="result-text">
        <span className="result-title">
          {m.title} {m.year && <span className="muted">({m.year})</span>}
        </span>
        {m.titleRu && m.titleRu !== m.title && <span className="muted">{m.titleRu}</span>}
        {m.originalTitle !== m.title && m.originalTitle !== m.titleRu && <span className="muted small">{m.originalTitle}</span>}
      </span>
      {m.voteAverage ? <span className="rating">★ {m.voteAverage.toFixed(1)}</span> : null}
    </Link>
  );
}
