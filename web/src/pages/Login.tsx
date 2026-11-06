import { WhatMurmurSends } from "./WhatMurmurSends";

export function Login() {
  return (
    <main className="center">
      <h1>Murmur</h1>
      <p className="muted">See what Claude is building, live.</p>
      <p>
        <a
          className="link-button primary"
          href="/auth/github"
          style={{ display: "inline-block", textDecoration: "none" }}
        >
          Sign in with GitHub
        </a>
      </p>
      <p>
        <a href="#what-murmur-sends">What Murmur sends</a>
      </p>
      <WhatMurmurSends />
    </main>
  );
}
