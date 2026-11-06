import { WhatMurmurSends } from "./WhatMurmurSends";

export function Login() {
  return (
    <main className="center">
      <h1 className="title-lg">Murmur</h1>
      <p className="muted">See what Claude is building, live.</p>
      <p>
        <a
          className="link-button"
          href="/auth/github"
          style={{ display: "inline-block", textDecoration: "none" }}
        >
          Sign in with GitHub
        </a>
      </p>
      <WhatMurmurSends />
    </main>
  );
}
