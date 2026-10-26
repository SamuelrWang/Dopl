"use client";

/** STAGING STUB of `src/shared/auth/use-current-profile.ts`: the staging viewer, no auth read. */
import type { CurrentProfile } from "@/shared/auth/use-current-profile";
import { STAGING_VIEWER } from "@/features/ui-staging/staging-stubs";

export type { CurrentProfile };

const PROFILE: CurrentProfile = {
  userId: STAGING_VIEWER.userId,
  displayName: STAGING_VIEWER.displayName ?? "Daniel Ortiz",
  avatarUrl: STAGING_VIEWER.avatarUrl ?? null,
};

export function useCurrentProfile(): CurrentProfile | null {
  return PROFILE;
}
