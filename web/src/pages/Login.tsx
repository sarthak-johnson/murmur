import { useEffect, useState } from "react";
import { WhatMurmurSends } from "./WhatMurmurSends";

interface Options {
  github: boolean;
  dev: boolean;
}

// The server says which sign-in methods it has, so the page never offers one
// that would fail (GitHub on a local server, local sign-in in production).
export function Login() {
  const [options, setOptions] = useState<Options | null>(null);
  useEffect(() => {
    fetch("/auth/options", { credentials: "same-origin" })
      .then((r) => r.json() as Promise<Options>)
      .then(setOptions)
      .catch(() => setOptions({ github: false, dev: false }));
  }, []);

  return (
    <main className="center">
      <h1 className="title-lg">Murmur</h1>
      <p className="muted">See what Claude is building, live.</p>
      {options?.github && (
        <p>
          <a
            className="link-button"
            href="/auth/github"
            style={{ display: "inline-block", textDecoration: "none" }}
          >
            Sign in with GitHub
          </a>
        </p>
      )}
      {options?.dev && (
        <form className="local-signin" action="/auth/dev" method="get">
          <label htmlFor="login">Your name</label>
          <input id="login" name="login" required autoComplete="username" />
          <button type="submit">Sign in locally</button>
        </form>
      )}
      {options && !options.github && !options.dev && (
        <p className="muted">Sign-in is not set up on this server yet.</p>
      )}
      <WhatMurmurSends />
    </main>
  );
}
