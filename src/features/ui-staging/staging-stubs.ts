/**
 * Shared fake identities + a fixed clock for every UI-staging page, so the
 * staged faces agree with each other and with the landing demo's roster.
 * Pure data — no Supabase, no fetch, no Electron bridge.
 */

import type { AvatarPerson } from "@/shared/ui/avatar";
import { VIEWER } from "@/features/marketing/components/banner-demo/demo-home-rows";

/** The operator (the landing demo's viewer, Daniel Ortiz). */
export const STAGING_VIEWER: AvatarPerson = VIEWER;
export const STAGING_USER_ID = VIEWER.userId;
/** The operator's `kind='home'` container. */
export const STAGING_HOME_WORKSPACE_ID = "staging-home-ws";
export const STAGING_HOME_SEGMENT = "home";

/** Two teammates with bundled photos (`public/img/avatars/`). */
export const STAGING_PEOPLE: AvatarPerson[] = [
  VIEWER,
  {
    userId: "demo-u-grace",
    email: "grace@vermillion.io",
    displayName: "Grace Kim",
    avatarUrl: "/img/avatars/grace-v2.jpg",
  },
  {
    userId: "demo-u-anthony",
    email: "anthony@vermillion.io",
    displayName: "Anthony Reyes",
    avatarUrl: "/img/avatars/anthony.jpg",
  },
];

/**
 * ⚠ A FIXED anchor, not `Date.now()`: the server render and the client render
 * must print the same stamps or React throws a hydration mismatch. Relative
 * labels ("3m ago") computed against the real clock may still differ by a minute;
 * keep such labels client-only if they matter.
 */
export const STAGING_NOW_MS = Date.UTC(2026, 9, 22, 17, 0, 0);
export const minsAgoIso = (m: number) =>
  new Date(STAGING_NOW_MS - m * 60_000).toISOString();
export const daysAgoIso = (d: number) => minsAgoIso(d * 24 * 60);
