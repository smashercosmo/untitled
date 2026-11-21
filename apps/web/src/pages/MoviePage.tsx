import { FetchError } from "void/client/react";
import { useMovie } from "../api";
import { initials, Poster } from "../components/Poster";
import { Link } from "../router";
import { formatRuntime, tmdbImage } from "../tmdb";

export function MoviePage({ id }: { id: number }) {
  const movie = useMovie(id);

  if (movie.isPending) return <div className="movie-skeleton" aria-busy="true" />;
  if (movie.isError || !movie.data) {
    const notFound = !movie.data || (movie.error instanceof FetchError && movie.error.status === 400);
    return (
      <div className="empty">
        <h1>{notFound ? "Movie not found" : "Couldn’t load this movie"}</h1>
        <Link to="/">Back to search</Link>
      </div>
    );
  }

  const m = movie.data;
  const backdrop = tmdbImage(m.backdropPath, "w1280");
  const meta = [m.year, m.certification, formatRuntime(m.runtime), m.voteAverage ? `★ ${m.voteAverage.toFixed(1)} (${m.voteCount.toLocaleString("en-US")})` : null].filter(Boolean);

  return (
    <article className="movie">
      {backdrop && <div className="backdrop" style={{ backgroundImage: `url(${backdrop})` }} aria-hidden="true" />}
      <Link to="/" className="back" onClick={(e) => {
        // Prefer real "back" so the previous search (?q=…) is restored.
        if (window.history.length > 1) {
          e.preventDefault();
          window.history.back();
        }
      }}>
        ← Back
      </Link>

      <div className="movie-body">
        <Poster path={m.posterPath} size="w500" title={m.title} className="movie-poster" />
        <div className="movie-info">
          <h1>{m.title}</h1>
          {m.titleRu && m.titleRu !== m.title && <p className="subtitle">{m.titleRu}</p>}
          {m.originalTitle !== m.title && m.originalTitle !== m.titleRu && <p className="muted">{m.originalTitle}</p>}
          <p className="meta">{meta.join(" · ")}</p>
          {m.genres.length > 0 && (
            <ul className="chips">
              {m.genres.map((g) => (
                <li key={g.id} title={g.nameRu ?? undefined}>
                  {g.name ?? `#${g.id}`}
                </li>
              ))}
            </ul>
          )}
          {m.tagline && <p className="tagline">“{m.tagline}”</p>}
          {m.overview && <p className="overview">{m.overview}</p>}
          {m.overviewRu && (
            <details className="overview-ru">
              <summary>Описание на русском</summary>
              <p lang="ru">{m.overviewRu}</p>
            </details>
          )}

          <dl className="crew">
            {m.directors.length > 0 && (
              <>
                <dt>Directed by</dt>
                <dd>{m.directors.map((d) => d.name).join(", ")}</dd>
              </>
            )}
            {m.writers.length > 0 && (
              <>
                <dt>Written by</dt>
                <dd>{[...new Set(m.writers.map((w) => w.name))].join(", ")}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      {m.cast.length > 0 && (
        <section>
          <h2 className="section-title">Cast</h2>
          <ul className="cast">
            {m.cast.map((c) => (
              <li key={`${c.id}-${c.character}`}>
                <Poster path={c.profilePath} size="w185" title={c.name} className="cast-photo" fallback={initials(c.name)} />
                <span className="cast-name">{c.name}</span>
                {c.character && <span className="muted small">{c.character}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {m.trailer && (
        <section>
          <h2 className="section-title">Trailer</h2>
          <div className="trailer">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(m.trailer.key)}`}
              title={m.trailer.name}
              allow="encrypted-media; picture-in-picture; fullscreen"
              loading="lazy"
            />
          </div>
        </section>
      )}
    </article>
  );
}
