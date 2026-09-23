"use client";

/** Live controls on a running agent — tool mode, messaging and model. Moves one session; stores nothing. */

import { useState, type ReactNode } from "react";
import { SelectMenu } from "@/shared/ui/select-menu";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { MESSAGE_OPTIONS } from "./permission-preset-row";
import type { MessageMode } from "../lib/permission-modes";
import { catalogSelection, modelOptionsFor } from "../lib/model-catalog";
import {
  canSetAgentMode,
  canSetAgentModel,
  setAgentMode,
  setAgentModel,
} from "./agents-controls";
import { agentRunningModel } from "./agents-model";
import { useChannelLaunchPosture } from "../hooks/use-channel-launch-posture";
import {
  canSwitchModelLive,
  normalizeToolMode,
  toolModeOptions,
} from "../lib/runtime-capability";

/** What a refused posture change says. */
export const POSTURE_REFUSED = "That didn't apply. The agent may have just ended.";

/** No `"ask"` on a running agent: a windowless session has no accept surface. Main clamps it too
 *  (`session-profiles.js › floorWindowlessMessage`); this list mirrors that floor, never enforces it. */
const LIVE_MESSAGE_OPTIONS = MESSAGE_OPTIONS.filter((o) => o.value !== "ask");

/**
 * Both axes apply from the next gate decision (`main/session-io.js › grantArgs`). The value shown is
 * always main's, off the pushed summary — no optimistic stamp, so a refusal leaves the select unmoved.
 */
export function PostureControls({
  agent,
  channelId,
  taskId,
  stats,
}: {
  agent: DesktopSessionSummary;
  channelId: string;
  taskId: string;
  /** The usage readout, rendered inside this box. */
  stats?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [canSet] = useState(() => canSetAgentMode());
  // A separate capability: a build may carry the two axes and no model op.
  const [bridgeCanModel] = useState(() => canSetAgentModel());
  // The agent's own runtime (`descriptorOf(agent.runtimeId)`), never the channel's current pick.
  const posture = useChannelLaunchPosture(channelId);
  const runtime = posture.descriptorOf(agent.runtimeId);
  const catalog = posture.catalogOf(agent.runtimeId);
  // No catalog, no picker; main refuses a runtime without `liveModelSwitch` (`session-reopen.js`).
  const canModel =
    bridgeCanModel && runtime !== null && catalog !== null && canSwitchModelLive(runtime);
  const toolOptions = toolModeOptions(runtime).map((o) => ({
    value: o.value,
    label: o.label,
    description: o.description ?? undefined,
  }));
  // An ended agent has no posture to change (main answers `no-session`): no controls.
  const canPosture = canSet && agent.state !== "ended";
  // The box stays while it holds stats: the usage meter does not depend on the posture gate.
  if (!canPosture && !stats) return null;

  // Main's value; `modelOptionsFor` appends an off-roster id so the control still shows it.
  const running = agentRunningModel(agent);
  const model = catalogSelection(catalog, running);
  const modelOptions = modelOptionsFor(catalog, model);

  const apply = (axis: "tools" | "messages", mode: string) => {
    setBusy(true);
    setNotice(null);
    // `agentId` names the instance; without it main moves the oldest live agent on the thread.
    void setAgentMode({ channelId, taskId, agentId: agent.agentId, axis, mode })
      .then((res) => {
        if (!res.ok) setNotice(POSTURE_REFUSED);
      })
      .finally(() => setBusy(false));
  };

  const applyModel = (next: string) => {
    setBusy(true);
    setNotice(null);
    void setAgentModel({ channelId, taskId, agentId: agent.agentId, model: next })
      .then((res) => {
        // Success says nothing (the feed is the confirmation); `no-model` carries main's sentence.
        if (!res.ok) setNotice(res.detail || POSTURE_REFUSED);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="shrink-0 border-b border-border-default px-4 py-2.5">
      {/* `raisedField` + `flex-nowrap` set the width `main/agent-window.js › createAgentWindow` opens
          at; change them together. Long labels truncate inside the trigger. */}
      {canPosture && (
        <div className="flex flex-nowrap items-center gap-2">
          {/* An unknown value shows as the narrowest — main's fail-closed answer. */}
          {toolOptions.length > 0 && (
            <SelectMenu<string>
              value={normalizeToolMode(runtime, agent.toolMode) ?? toolOptions[0].value}
              options={toolOptions}
              onChange={(next) => apply("tools", next)}
              prefix="Tools"
              ariaLabel="Tool permissions for this agent"
              variant="raisedField"
              disabled={busy}
            />
          )}
          <SelectMenu<MessageMode>
            // Fallback: the list's first entry (the windowless floor), never `"ask"`.
            value={agent.messageMode ?? LIVE_MESSAGE_OPTIONS[0].value}
            options={LIVE_MESSAGE_OPTIONS}
            onChange={(next) => apply("messages", next)}
            prefix="Messages"
            ariaLabel="Message permissions for this agent"
            variant="raisedField"
            disabled={busy}
          />
          {canModel && modelOptions.length > 0 && (
            <SelectMenu<string>
              value={model}
              options={modelOptions}
              onChange={applyModel}
              prefix="Model"
              ariaLabel="Model for this agent"
              variant="raisedField"
              disabled={busy}
            />
          )}
        </div>
      )}
      {/* `mt-2.5` matches this block's `py-2.5`; the caller clears the meter's own `mt-3`. */}
      {stats && <div className={canPosture ? "mt-2.5" : undefined}>{stats}</div>}
      {notice && (
        <p role="status" className="mt-1.5 text-caption text-text-muted">
          {notice}
        </p>
      )}
    </div>
  );
}

