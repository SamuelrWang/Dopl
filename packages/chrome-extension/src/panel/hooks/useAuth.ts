/**
 * Auth state hook — manages connection to Dopl backend.
 */

import { useState, useEffect, useCallback } from "react";
import { useBgMessage } from "./useBgMessage";
import type { AuthState } from "@/background/messages";

const INITIAL_STATE: AuthState = {
  mode: "none",
  apiUrl: "",
  authenticated: false,
};

export function useAuth() {
  const { send } = useBgMessage();
  const [auth, setAuth] = useState<AuthState>(INITIAL_STATE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    send<AuthState>({ type: "GET_AUTH_STATE" })
      .then(setAuth)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [send]);

  const connect = useCallback(
    async (apiKey: string, apiUrl: string) => {
      setLoading(true);
      try {
        const state = await send<AuthState>({ type: "SET_API_KEY", apiKey, apiUrl });
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

  return { auth, loading, connect, disconnect };
}
