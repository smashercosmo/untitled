import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type AuthUser, auth } from "void/client/react";
import { Link, navigate } from "../router";

export function Header({ user }: { user: Pick<AuthUser, "email" | "name"> | null }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const signOut = async () => {
    setPending(true);
    await auth.signOut();
    setPending(false);
    navigate("/signin", { replace: true });
    // Never keep the previous user's data. Clear after the signed-in pages unmount, otherwise their
    // still-mounted queries refetch immediately and hit a 401.
    setTimeout(() => queryClient.clear(), 0);
  };

  return (
    <header className="header">
      <Link to="/" className="brand">
        Night<span>Reel</span>
      </Link>
      {user && (
        <div className="account">
          <span className="account-name" title={user.email}>
            {user.name || user.email}
          </span>
          <button type="button" className="button ghost" onClick={signOut} disabled={pending}>
            Log out
          </button>
        </div>
      )}
    </header>
  );
}
