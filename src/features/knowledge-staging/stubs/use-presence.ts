"use client";

/**
 * STAGING STUB of `src/shared/realtime/use-presence.ts`. No Supabase presence channel: one fixed
 * peer (Grace) reads the open entry, so the doc pane's avatar stack renders.
 */
import type { PresencePeer } from "@/shared/realtime/use-presence";
import type { CurrentProfile } from "./use-current-profile";

export type { PresencePeer };

const GRACE_READING: PresencePeer[] = [
  {
    userId: "demo-u-grace",
    displayName: "Grace Kim",
    avatarUrl: "/img/avatars/grace-v2.jpg",
    editing: false,
  },
];
const NONE: PresencePeer[] = [];

export function usePresence(
  topic: string | null,
  self: CurrentProfile | null,
  editing: boolean
): PresencePeer[] {
  void self;
  void editing;
  return topic ? GRACE_READING : NONE;
}
