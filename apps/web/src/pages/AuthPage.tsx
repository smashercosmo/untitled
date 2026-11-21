import { type FormEvent, useState } from "react";
import { auth } from "void/client/react";
import { Link } from "../router";

type Mode = "signin" | "signup";

export function AuthPage({ mode, next }: { mode: Mode; next: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const signup = mode === "signup";
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = signup
      ? await auth.signUp.email({ email, password, name: name.trim() || email.split("@")[0] || "Movie fan" })
      : await auth.signIn.email({ email, password });
    setPending(false);
    // On success the session updates and <App> redirects; only errors need handling here.
    if (res.error) setError(res.error.message || "Something went wrong. Please try again.");
  };

  return (
    <div className="auth">
      <h1>{signup ? "Create an account" : "Sign in"}</h1>
      <p className="muted">Horror &amp; thriller movies, in English and Russian.</p>
      <form className="auth-form" onSubmit={submit}>
        {signup && (
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
          </label>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={8}
            required
          />
          {signup && <span className="hint">At least 8 characters.</span>}
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={pending}>
          {pending ? "Please wait…" : signup ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="muted">
        {signup ? (
          <>
            Already have an account? <Link to={`/signin${nextQuery}`}>Sign in</Link>
          </>
        ) : (
          <>
            New here? <Link to={`/signup${nextQuery}`}>Create an account</Link>
          </>
        )}
      </p>
    </div>
  );
}
