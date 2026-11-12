import { useEffect, useState } from "react";
import { api, type Me, UNAUTHORIZED } from "./api";
import { OfficePage } from "./office/Office";
import { Device } from "./pages/Device";
import { Login } from "./pages/Login";
import { LiveSkeleton, SessionPage } from "./pages/Session";
import { Sessions } from "./pages/Sessions";
import { Settings } from "./pages/Settings";
import { navigate, useRoute } from "./router";

const PENDING = "murmur:pendingDevice";

function store(op: () => unknown): string | null {
  try {
    const v = op();
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

function Header(props: { me: Me; onSignOut: () => void }) {
  const { me, onSignOut } = props;
  const go = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(path);
  };
  return (
    <header className="header">
      <div className="header-in">
        <a className="wordmark" href="/" onClick={go("/")}>
          Murmur
        </a>
        <span className="user">
          {me.avatarUrl && <img src={me.avatarUrl} alt="" />}
          {me.login}
        </span>
        <nav>
          <a href="/settings" onClick={go("/settings")}>
            Settings
          </a>
          <button type="button" className="link" onClick={onSignOut}>
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
}

export function App() {
  const route = useRoute();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [unreachable, setUnreachable] = useState(false);

  // Only a 401 means signed out (api.me gives null); anything else retries with backoff.
  useEffect(() => {
    let stopped = false;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      api.me().then(
        (m) => {
          if (stopped) return;
          setUnreachable(false);
          setMe(m);
        },
        () => {
          if (stopped) return;
          setUnreachable(true);
          timer = setTimeout(load, delay);
          delay = Math.min(delay * 2, 30_000);
        },
      );
    load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const out = () => setMe(null);
    window.addEventListener(UNAUTHORIZED, out);
    return () => window.removeEventListener(UNAUTHORIZED, out);
  }, []);

  // Signed out on /device: remember the code, the server returns to / after sign-in.
  useEffect(() => {
    if (me === null && route.name === "device" && route.code) {
      store(() => sessionStorage.setItem(PENDING, route.code));
    }
    if (me && route.name === "home") {
      const code = store(() => sessionStorage.getItem(PENDING));
      if (code) {
        store(() => sessionStorage.removeItem(PENDING));
        navigate(`/device?code=${encodeURIComponent(code)}`);
      }
    }
  }, [me, route]);

  const wide =
    route.name === "session" ||
    route.name === "request" ||
    route.name === "part" ||
    route.name === "office";
  const note = unreachable ? "Could not reach Murmur. Retrying…" : undefined;
  if (me === undefined)
    // The live frame brings its own bar, so nothing moves when the page loads.
    return wide ? (
      <LiveSkeleton {...(note ? { note } : {})} />
    ) : (
      <>
        <header className="header">
          <div className="header-in">
            <span className="wordmark">Murmur</span>
            {note && (
              <span className="muted header-note" role="status">
                {note}
              </span>
            )}
          </div>
        </header>
        <main className="page" aria-hidden="true">
          <div className="sk" />
        </main>
      </>
    );
  if (me === null) return <Login />;

  async function signOut() {
    await api.logout().catch(() => {});
    setMe(null);
    navigate("/");
  }

  let page: React.ReactNode;
  switch (route.name) {
    case "home":
      page = <Sessions />;
      break;
    case "device":
      page = <Device code={route.code} />;
      break;
    case "settings":
      page = <Settings onSignedOut={signOut} />;
      break;
    case "notFound":
      page = (
        <main className="page">
          <p className="muted">Page not found.</p>
        </main>
      );
      break;
    case "office":
      // The office is a room of its own: its own bars, the whole window.
      return (
        <OfficePage
          key={route.sessionId}
          sessionId={route.sessionId}
          {...(route.requestId ? { requestId: route.requestId } : {})}
        />
      );
    case "session":
    case "request":
    case "part":
      // The live frame has its own bar; the account links sit in its session menu.
      return (
        <SessionPage
          key={route.sessionId}
          sessionId={route.sessionId}
          requestId={route.name === "session" ? undefined : route.requestId}
          partId={route.name === "part" ? route.partId : undefined}
          tab={route.name === "request" ? route.tab : undefined}
          sessionTab={route.name === "session" ? route.tab : undefined}
          me={me}
          onSignOut={signOut}
        />
      );
  }
  return (
    <>
      <Header me={me} onSignOut={signOut} />
      {page}
    </>
  );
}
