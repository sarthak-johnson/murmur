import { useEffect, useState } from "react";

/**
 * ISO time the viewer last left this session (tab hidden or window blurred), or
 * null on a first visit. It only changes on mount or when the viewer comes back,
 * so a catch-up line stays steady while they are looking.
 */
export function useLastLooked(sessionId: string): string | null {
  const key = `murmur:lastLooked:${sessionId}`;
  const read = () => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const [value, setValue] = useState<string | null>(read);

  // biome-ignore lint/correctness/useExhaustiveDependencies: read/key derive from sessionId
  useEffect(() => {
    setValue(read());
    let left: string | null = null;
    const leave = () => {
      left = new Date().toISOString();
      try {
        localStorage.setItem(key, left);
      } catch {}
    };
    const back = () => {
      if (left) setValue(left);
      left = null;
    };
    const onVisibility = () =>
      document.visibilityState === "hidden" ? leave() : back();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
    };
  }, [sessionId]);

  return value;
}
