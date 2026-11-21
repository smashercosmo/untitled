import { type ReactNode, useEffect } from "react";
import { auth } from "void/client/react";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { MoviePage } from "./pages/MoviePage";
import { Link, matchPath, navigate, useLocation } from "./router";

const AUTH_PATHS = new Set(["/signin", "/signup"]);

/** The whole app is for signed-in users; everyone else lands on sign in / sign up. */
export function App() {
  const session = auth.useSession();
  const url = useLocation();
  const user = session.data?.user ?? null;
  const onAuthPage = AUTH_PATHS.has(url.pathname);

  useEffect(() => {
    if (session.isPending) return;
    if (!user && !onAuthPage) {
      const next = url.pathname + url.search;
      navigate(next === "/" ? "/signin" : `/signin?next=${encodeURIComponent(next)}`, { replace: true });
    } else if (user && onAuthPage) {
      navigate(safeNext(url.searchParams.get("next")), { replace: true });
    }
  }, [session.isPending, user, onAuthPage, url]);

  if (session.isPending) return <div className="splash">Loading…</div>;

  let page: ReactNode;
  if (!user) {
    page = <AuthPage mode={url.pathname === "/signup" ? "signup" : "signin"} next={url.searchParams.get("next")} />;
  } else {
    const movie = matchPath("/movie/:id", url.pathname);
    if (url.pathname === "/") page = <HomePage />;
    else if (movie) page = <MoviePage id={Number(movie.id)} />;
    else page = <NotFound />;
  }

  return (
    <div className="shell">
      <Header user={user} />
      <main className="main">{page}</main>
      <Footer />
    </div>
  );
}

/** Only same-app paths are allowed as a post-login redirect (no open redirects). */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function NotFound() {
  return (
    <div className="empty">
      <h1>Nothing here</h1>
      <Link to="/">Back to search</Link>
    </div>
  );
}
