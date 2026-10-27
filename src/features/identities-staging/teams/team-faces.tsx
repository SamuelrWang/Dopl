"use client";

import { IdentityFace } from "@/shared/ui/identity-face";
import { IdentityStack, type IdentityStackFace } from "@/shared/ui/avatar-stack";
import { useRuntimeLogo } from "@/shared/ui/runtime-logo";
import { photoOf } from "../data-agents";
import type { StagingAgentTeam } from "../data/agent-teams";
import { identityOf } from "./team-model";

/** The identity a slot wears, as its face: the owner's photo, the runtime badge, a neutral ring. */
function useSlotFace() {
  const logoFor = useRuntimeLogo();
  return (identityId: string): Omit<IdentityStackFace, "key"> => {
    const identity = identityOf(identityId);
    return {
      photo: photoOf(identity?.createdBy ?? null),
      runtimeLogo: logoFor(identity?.runtime),
      ring: "neutral",
    };
  };
}

/** One face per slot, so a team reads as the roles it is made of. */
export function TeamStack({ team, size }: { team: StagingAgentTeam; size: number }) {
  const faceOf = useSlotFace();
  return (
    <IdentityStack
      size={size}
      label={team.slots.map((s) => s.label).join(", ")}
      faces={team.slots.map((s) => ({ key: s.id, ...faceOf(s.identityId) }))}
    />
  );
}

export function SlotFace({ identityId, size }: { identityId: string; size: number }) {
  const faceOf = useSlotFace();
  return <IdentityFace size={size} {...faceOf(identityId)} />;
}
