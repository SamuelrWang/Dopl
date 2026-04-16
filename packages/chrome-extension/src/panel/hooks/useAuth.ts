/**
 * Auth state hook — reads from the shared AuthProvider context so every
 * consumer in the panel tree sees the same state. Throws if used outside
 * the provider so the bug that caused the original state-isolation issue
 * (two independent useState copies) surfaces loudly in dev.
 */

import { useContext } from "react";
import {
  AuthContext,
  type AuthContextValue,
} from "../providers/AuthProvider";

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
