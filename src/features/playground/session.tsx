"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Client half of the playground session (server half:
 * `features/playground/server/service.ts`). One POST provisions a guest
 * workspace + bearer; the token then authenticates BOTH the visitor's agent
 * (MCP, token-in-URL) and this page's own REST polling — the guest bearer is
 * a normal `dopl_at_*` token, so the existing workspace routes accept it via
 * `withUserAuth`'s bearer branch with `X-Workspace-Id` pinning the workspace.
 *
 * Persisted in localStorage so a reload (or returning later the same day)
 * keeps the same workspace the visitor's agent is already connected to.
 */

export interface PlaygroundSession {
  token: string;
  workspaceId: string;
  expiresAt: string;
}

const STORAGE_KEY = "dopl-playground-session";

function readStored(): PlaygroundSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaygroundSession;
    if (!parsed?.token || !parsed?.workspaceId || !parsed?.expiresAt) return null;
    // Expired sessions are dead server-side (validateAccessToken refuses the
    // bearer); dropping them here keeps the UI from polling into 401s.
    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

interface PlaygroundSessionState {
  /** Null until started (or when the stored one expired). */
  session: PlaygroundSession | null;
  starting: boolean;
  error: string | null;
  start: () => void;
}

const Ctx = createContext<PlaygroundSessionState>({
  session: null,
  starting: false,
  error: null,
  start: () => undefined,
});

export function PlaygroundSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PlaygroundSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // localStorage is unreachable during SSR; hydrate after mount.
  useEffect(() => {
    setSession(readStored());
  }, []);

  // The token dies server-side at expiry (`validateAccessToken` refuses it);
  // this is the client half — drop the session at that moment so the page
  // falls back to the demo content and offers a fresh start, instead of
  // polling a dead bearer into 401s.
  useEffect(() => {
    if (!session) return;
    const remaining = Date.parse(session.expiresAt) - Date.now();
    if (remaining <= 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      setSession(null);
      return;
    }
    const timer = setTimeout(() => {
      window.localStorage.removeItem(STORAGE_KEY);
      setSession(null);
    }, remaining);
    return () => clearTimeout(timer);
  }, [session]);

  const start = useCallback(() => {
    if (starting) return;
    setStarting(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch("/api/playground/session", { method: "POST" });
        const body = (await res.json().catch(() => null)) as
          | (PlaygroundSession & { message?: string })
          | null;
        if (!res.ok || !body?.token) {
          setError(body?.message ?? "Could not start a playground session.");
          return;
        }
        const next: PlaygroundSession = {
          token: body.token,
          workspaceId: body.workspaceId,
          expiresAt: body.expiresAt,
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setSession(next);
      } catch {
        setError("Could not start a playground session.");
      } finally {
        setStarting(false);
      }
    })();
  }, [starting]);

  return (
    <Ctx.Provider value={{ session, starting, error, start }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePlaygroundSession(): PlaygroundSessionState {
  return useContext(Ctx);
}

/** Poll cadence. Slow on purpose: every GET spends the token's shared rate
 *  budget (`mcp:<tokenId>` covers REST and MCP alike), and the demo's real
 *  writer is the agent — the page only needs to look fresh, not live. */
const POLL_MS = 10_000;

interface PollState<T> {
  /** Last successful payload — held through later errors so the page never
   *  blanks mid-demo. */
  data: T | null;
  /** True only before the FIRST answer. */
  loading: boolean;
  error: boolean;
}

/**
 * Poll one workspace-scoped GET with the guest bearer. `path` null (no
 * session, or pane prefers its static fallback) disables entirely.
 */
export function usePlaygroundPoll<T>(path: string | null): PollState<T> {
  const { session } = usePlaygroundSession();
  const [state, setState] = useState<PollState<T>>({
    data: null,
    loading: true,
    error: false,
  });
  // The active request's generation — a stale response from a previous
  // path/session must not clobber the current one.
  const generation = useRef(0);

  const token = session?.token ?? null;
  const workspaceId = session?.workspaceId ?? null;

  useEffect(() => {
    if (!path || !token || !workspaceId) return;
    const gen = ++generation.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const tick = async () => {
      try {
        const res = await fetch(path, {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Workspace-Id": workspaceId,
          },
        });
        if (gen !== generation.current || stopped) return;
        if (res.ok) {
          const body = (await res.json()) as T;
          if (gen !== generation.current || stopped) return;
          setState({ data: body, loading: false, error: false });
        } else {
          setState((prev) => ({ ...prev, loading: false, error: true }));
        }
      } catch {
        if (gen !== generation.current || stopped) return;
        setState((prev) => ({ ...prev, loading: false, error: true }));
      }
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    };

    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [path, token, workspaceId]);

  return path && token ? state : { data: null, loading: false, error: false };
}
