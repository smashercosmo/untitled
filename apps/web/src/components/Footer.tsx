/** Required by the TMDB API terms: TMDB logo (less prominent than ours) + the exact notice. */
export function Footer() {
  return (
    <footer className="footer">
      <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer" className="tmdb-logo">
        <img src="/tmdb-logo.svg" alt="The Movie Database (TMDB)" width={96} height={12} />
      </a>
      <p>This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.</p>
    </footer>
  );
}
