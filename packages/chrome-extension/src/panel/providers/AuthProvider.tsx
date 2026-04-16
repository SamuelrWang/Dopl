/**
 * AuthProvider — single source of truth for the extension's auth state.
 *
 * Before this existed, `useAuth` held local state per hook instance. App.tsx
 * and SettingsView each called `useAuth`, so when SettingsView successfully
 * connected, App.tsx's separate instance never heard about it — leaving the
 * UI stuck on the pre-connect branch while SettingsView internally showed
 * "Connected". AuthProvider fixes this by sharing one state object across
 * every consumer.
 *
 * Also subscribes to `chrome.storage.onChanged` so cross-window disconnects
 * (or external extensions clearing the key) propagate without a reload.
 */

import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AuthState } from "@/background/messages";
import { STORAGE_KEYS } from "@/shared/constants";
import { useBgMessage } from "../hooks/useBgMessage";

export interface AuthContextValue {
  auth: AuthState;
  loading: boolean;
  connect: (apiKey: string, apiUrl: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
}

const INITIAL_STATE: AuthState = {
  mode: "none",
  apiUrl: "",
  authenticated: false,
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { send } = useBgMessage();
  const [auth, setAuth] = useState<AuthState>(INITIAL_STATE);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const state = await send<AuthState>({ type: "GET_AUTH_STATE" });
      setAuth(state);
    } catch {
      // Background not ready yet — leave INITIAL_STATE so consumers see
      // `authenticated: false` and route to ConnectView.
    }
  }, [send]);

  // Initial load
  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Cross-window / external sync. If another window disconnects, or the
  // extension is reloaded and the service worker clears auth, we hear
  // about it here and flip back to ConnectView.
  useEffect(() => {
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== "sync") return;
      if (
        STORAGE_KEYS.API_KEY in changes ||
        STORAGE_KEYS.AUTH_MODE in changes ||
        STORAGE_KEYS.API_URL in changes
      ) {
        void refresh();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refresh]);

  const connect = useCallback(
    async (apiKey: string, apiUrl: string) => {
      setLoading(true);
      try {
        const state = await send<AuthState>({
          type: "SET_API_KEY",
          apiKey,
          apiUrl,
        });
        setAuth(state);
        return state.authenticated;
      } catch {
        return false;
      } finally {
        setLoading(false);
      }
    },
    [send]
  );

  const disconnect = useCallback(async () => {
    await send({ type: "CLEAR_AUTH" });
    setAuth(INITIAL_STATE);
  }, [send]);

  return (
    <AuthContext.Provider value={{ auth, loading, connect, disconnect }}>
      {children}
    </AuthContext.Provider>
  );
}
