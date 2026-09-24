"use client";

/** The New Agent dialog — the one launch form; identity launches open it preselected. */

import { useMemo } from "react";
import { useAgentIdentities } from "@/features/agent-identities/hooks/use-agent-identities";
import { authorMarker } from "@/features/agent-identities/components/identity-picker";
import { IdentityApprovalDialog } from "@/features/agent-identities/components/identity-approval";
import { FormDialog, PillChoice, UnderlineField } from "@/shared/ui/form-dialog";
import { useLaunchDialogRuntime } from "./launch-agent-dialog-state";
import { AgentColorCircles, agentColorsTaken } from "./agent-color-circles";
import { firstFreeAgentColor } from "../lib/agent-colors";
import type { AgentColorKey } from "../types";
import type { AgentLaunchControls } from "./use-agents-panel";
import type { AgentLaunchPanel } from "./use-agent-launch";
import { useLaunchRunner } from "./use-agent-launch-run";
import { RuntimeSignInButton } from "./runtime-signin-button";
import { signedOutLaunchCopy } from "../lib/runtime-copy";

/** The blank-agent key: `SegmentedControl` keys are strings; maps to `identityId: null`. */
const BLANK_IDENTITY = "";

/** Module scope: a fresh `[]` default would rebuild the taken set on every render. */
const EMPTY_LIVE_SESSIONS: ReadonlyArray<never> = [];

export function LaunchAgentDialog({
  panel,
  newAgent,
  openThreadId,
  channelId,
  workspaceId,
  currentUserId,
  members,
  liveSessions = EMPTY_LIVE_SESSIONS,
}: {
  panel: AgentLaunchPanel;
  /** Absent ⇒ this surface cannot launch. */
  newAgent?: AgentLaunchControls;
  /** Which exchange the new agent lands on; `null` is a CHANNEL-LEVEL agent. */
  openThreadId: string | null;
  channelId: string;
  /** `null` = no workspace to list: no roster read, and the Identity row holds None alone. */
  workspaceId: string | null;
  /** Whose identities wear no author marker. */
  currentUserId: string;
  /** The channel roster, for the marker's name; an unknown author still reads "by another member". */
  members: ReadonlyArray<{ userId: string; displayName: string | null; email: string | null }>;
  /**
   * The channel's live sessions (peer + own) — the Colour row's taken set. Empty = nothing KNOWN
   * taken; the server's unique index is the authority and rejects a taken key at launch.
   */
  liveSessions?: ReadonlyArray<{
    /** Absent reads as live (`agentColorsTaken`). */
    state?: string | null;
    color?: AgentColorKey | null;
    name?: string | null;
    displayName?: string | null;
  }>;
}) {
  // Fetched only while open; shares the Agents tab's cache entry (F-331).
  const { identities } = useAgentIdentities(workspaceId ?? "", {
    enabled: panel.open && workspaceId !== null,
  });

  const memberNames = useMemo(
    () => new Map(members.map((m) => [m.userId, m.displayName || m.email || ""] as const)),
    [members]
  );

  // Every identity wears its author marker (INVARIANTS §5A); `hint` reaches the accessible name.
  const identityOptions = useMemo(
    () => [
      { key: BLANK_IDENTITY, label: "None" },
      ...identities.map((t) => ({
        key: t.id,
        label: t.name,
        hint: authorMarker(t, currentUserId, memberNames) ?? undefined,
      })),
    ],
    [identities, currentUserId, memberNames]
  );

  const runtime = useLaunchDialogRuntime(panel, channelId, identities);
  const {
    runtimes,
    selectedRuntime,
    launchRuntime,
    runtimeOptions,
    modelRow,
    nativeLine,
    connectionNote,
    stopWarning,
    chooseRuntime,
  } = runtime;
  const runner = useLaunchRunner({ newAgent, panel, openThreadId, runtime: selectedRuntime });

  // Off the rendered roster, so an unloaded or invisible identity leaves the title "New agent".
  const selectedIdentity = useMemo(
    () => identities.find((t) => t.id === panel.identityId) ?? null,
    [identities, panel.identityId]
  );

  // Also the dialog's `aria-label`; `titleCase={false}` preserves the identity's own casing.
  const title = selectedIdentity ? `New ${selectedIdentity.name} agent` : "New agent";

  // Pick + prefill; `setIdentityId` for a panel without `applyIdentity`, or an id the roster lacks
  // (routing that through `applyIdentity(null)` would turn the pick into None).
  const pickIdentity = (next: string) => {
    if (next === BLANK_IDENTITY) {
      if (panel.applyIdentity) panel.applyIdentity(null);
      else panel.setIdentityId(null);
      return;
    }
    const picked = identities.find((t) => t.id === next) ?? null;
    if (picked && panel.applyIdentity) panel.applyIdentity(picked);
    else panel.setIdentityId(next);
  };

  const { taken, takenBy } = useMemo(() => agentColorsTaken(liveSessions), [liveSessions]);
  // Display only: `panel.color` stays `null` until a circle is clicked, so the server assigns the
  // first free key. `null` when every key is taken — the launch is still allowed.
  const effectiveColor = useMemo<AgentColorKey | null>(
    () => panel.color ?? firstFreeAgentColor(taken),
    [panel.color, taken]
  );

  // Every exit discards: `reset` closes AND clears.
  const discard = () => panel.reset();

  return (
    <>
      <FormDialog
        open={panel.open}
        onDiscard={discard}
        title={title}
        titleCase={false}
        closeLabel="Close new agent"
        primary={{
          label: "Launch",
          onClick: runner.launch,
          busy: newAgent?.launchBusy,
          // Never disabled: a blank name launches as `New Agent`.
          hint: "Launch",
        }}
      >
        <UnderlineField
          id="launch-agent-name"
          label="Name"
          value={panel.name}
          onChange={panel.setName}
          ariaLabel="Agent name"
        />
        <UnderlineField
          id="launch-agent-description"
          label="Description"
          multiline
          value={panel.description}
          onChange={panel.setDescription}
          ariaLabel="Agent description"
        />
        <UnderlineField
          id="launch-agent-instructions"
          label="Instructions"
          multiline
          minRows={1}
          value={panel.instructions ?? ""}
          // Optional on hand-built panel literals; absent ⇒ inert.
          onChange={(next) => panel.setInstructions?.(next)}
          ariaLabel="Agent instructions"
        />

        <PillChoice
          label="Identity"
          options={identityOptions}
          value={panel.identityId ?? BLANK_IDENTITY}
          onChange={pickIdentity}
          ariaLabel="Identity"
          className="flex-wrap"
        />

        {modelRow.selectable ? (
          <PillChoice
            label="Model"
            options={modelRow.options}
            value={modelRow.shown}
            onChange={panel.setModel}
            ariaLabel="Agent model"
            className="flex-wrap"
          />
        ) : (
          <PillChoice
            label="Model"
            options={[{ key: modelRow.shown, label: modelRow.shownLabel }]}
            value={modelRow.shown}
            onChange={() => {}}
            ariaLabel="Agent model"
            className="flex-wrap"
          />
        )}
        {modelRow.reason && (
          <p role="note" className="text-caption text-text-secondary">
            {modelRow.reason}
          </p>
        )}
        {modelRow.mismatch && (
          <p role="note" className="text-caption text-warning">
            {modelRow.mismatch.sentence}
          </p>
        )}

        {/* Nothing reported ⇒ no row and no runtime key; one reported runtime still renders it. */}
        {runtimes.length > 0 && (
          <PillChoice
            label="Runtime"
            options={runtimeOptions}
            value={selectedRuntime}
            onChange={chooseRuntime}
            ariaLabel="Agent runtime"
            className="flex-wrap"
          />
        )}

        {/* Always rendered, unlike Runtime: the colour bank is the room's, not the desktop's. */}
        <AgentColorCircles
          value={effectiveColor}
          // Optional on hand-built panel literals; absent ⇒ inert.
          onChange={(next) => panel.setColor?.(next)}
          taken={taken}
          takenBy={takenBy}
        />

        {nativeLine && (
          <p role="note" className="text-caption text-text-secondary">
            {nativeLine}
          </p>
        )}
        {connectionNote && (
          <p role="note" className="text-caption text-warning">
            {connectionNote}
          </p>
        )}
        {stopWarning && (
          <p role="note" className="text-caption text-warning">
            {stopWarning}
          </p>
        )}

        {/* A refusal pushes nothing, so this is the only place it is said. A signed-out refusal
            carries its runtime's sign-in; a sign-in that takes re-runs the launch. */}
        {newAgent?.launchError && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-caption text-danger">
              {newAgent.launchError}
            </p>
            {launchRuntime && newAgent.launchError === signedOutLaunchCopy(launchRuntime) && (
              <RuntimeSignInButton runtime={launchRuntime} onSignedIn={runner.relaunch} />
            )}
          </div>
        )}
        {/* The agent is already running; the dialog stays open holding the report. */}
        {panel.identityError && (
          <p role="alert" className="text-caption text-danger">
            {panel.identityError}
          </p>
        )}

      </FormDialog>

      {/* A separate dialog: another member's instructions must never read as Dopl's own form. */}
      <IdentityApprovalDialog
        open={runner.approval !== null}
        request={runner.approval}
        error={runner.approvalError}
        busy={newAgent?.launchBusy}
        onCancel={runner.cancelApproval}
        onConfirm={runner.confirmApproval}
      />
    </>
  );
}
