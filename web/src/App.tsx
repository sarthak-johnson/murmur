import { useEffect, useState } from "react";
import { api, type Me, UNAUTHORIZED } from "./api";
import { Device } from "./pages/Device";
import { Login } from "./pages/Login";
import { SessionPage } from "./pages/Session";
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

function Header(props: { me: Me; wide: boolean; onSignOut: () => void }) {
  const { me, wide, onSignOut } = props;
  const go = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(path);
  };
  return (
    <header className="header">
      <div className={wide ? "header-in wide" : "header-in"}>
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

  useEffect(() => {
    api.me().then(setMe, () => setMe(null));
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

  if (me === undefined) return null;
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
    case "session":
    case "request":
      page = (
        <SessionPage
          key={route.sessionId}
          sessionId={route.sessionId}
          requestId={route.name === "request" ? route.requestId : undefined}
        />
      );
      break;
    case "part":
      page = (
        <main className="page">
          <p className="muted">Part details arrive in a later task.</p>
        </main>
      );
      break;
  }
  return (
    <>
      <Header
        me={me}
        wide={route.name === "session" || route.name === "request"}
        onSignOut={signOut}
      />
      {page}
    </>
  );
}
