"use client";

import { Users } from "lucide-react";
import { IdentityFace } from "@/shared/ui/identity-face";
import { useRuntimeLogo } from "@/shared/ui/runtime-logo";
import { StatusPill } from "@/shared/ui/status-pill";
import type { StagingAgentTeam, StagingTeamRun } from "../data/agent-teams";
import { identityOf, runProgress, SEAT_STATE } from "./team-model";

/**
 * A launched team as ONE group (PROPOSAL §2): the team's name and task progress, then each seat's
 * agent with its state. The Identities activity rail and the channel Agents tab both draw it.
 */
export function TeamRunGroup({
  team,
  run,
  ownerPhoto,
  onOpen,
}: {
  team: StagingAgentTeam;
  run: StagingTeamRun;
  /** The operator's photo: every seat is their own agent. */
  ownerPhoto: string | null;
  onOpen?: () => void;
}) {
  const logoFor = useRuntimeLogo();
  const template = team.templates.find((t) => t.id === run.templateId);
  const { done, total } = runProgress(run);
  const slotOf = (slotId: string) => team.slots.find((s) => s.id === slotId);

  const head = (
    <span className="flex w-full min-w-0 items-center gap-2">
      <span className="flex size-7 flex-none items-center justify-center rounded-full bg-bg-inset text-text-muted">
        <Users size={14} strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="min-w-0 truncate text-small font-semibold text-text-primary">{team.name}</span>
        <span className="min-w-0 truncate text-caption text-text-muted">
          {template?.title ?? "Run"} · #{run.channelName}
        </span>
      </span>
      <span className="flex-none text-caption font-medium tabular-nums text-text-secondary">
        {done}/{total}
      </span>
    </span>
  );

  return (
    <div className="white-card flex w-full min-w-0 flex-col gap-2 px-3 py-2.5">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="flex w-full cursor-pointer text-left">
          {head}
        </button>
      ) : (
        head
      )}
      <span className="h-1 w-full overflow-hidden rounded-full bg-bg-inset" aria-hidden="true">
        <span
          className="block h-full rounded-full bg-success"
          style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }}
        />
      </span>
      <ul className="flex flex-col gap-1.5">
        {run.seats.map((seat) => {
          const identity = identityOf(slotOf(seat.slotId)?.identityId ?? "");
          const state = SEAT_STATE[seat.state];
          return (
            <li key={seat.agentName} className="flex min-w-0 items-center gap-2">
              <IdentityFace
                size={24}
                photo={ownerPhoto}
                ring={seat.color}
                runtimeLogo={logoFor(identity?.runtime)}
              />
              <span className="min-w-0 flex-1 truncate text-caption text-text-primary">
                {seat.agentName}
              </span>
              <StatusPill dot tone={state.tone}>
                {state.label}
              </StatusPill>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
