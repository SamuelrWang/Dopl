"use client";

/**
 * What the selected runtime implies for the New Agent dialog: runtime options, model row, native
 * summary, sign-in and stop notes. The dialog's only desktop read — a second reader would drift.
 */

import { useEffect, useMemo } from "react";
import { useLaunchSelection } from "../hooks/use-launch-selection";
import { interruptRefusal, type RuntimeDescriptor } from "../lib/runtime-capability";
import { signedOutLaunchCopy } from "../lib/runtime-copy";
import { nativeDimensions, nativeSummary } from "../lib/runtime-native";
import { modelRowFor, ownPickSurvives, type ModelRow } from "./launch-agent-dialog-model";
import { pickRuntime, runtimeRowOptions } from "./launch-agent-dialog-runtime";
import type { AgentLaunchPanel } from "./use-agent-launch";

/** The fields read off an identity row — a structural shape, not `AgentIdentity`. */
export interface IdentityModelRow {
  id: string;
  model?: string | null;
  /** The identity's runtime; absent/null/`''` = no preference. */
  runtime?: string | null;
}

export interface LaunchDialogRuntime {
  /** Every reported runtime — never filtered by connectivity. */
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  /** Always sent; `''` only where nothing was reported. */
  selectedRuntime: string;
  runtimeOptions: Array<{ key: string; label: string; hint?: string }>;
  modelRow: ModelRow;
  /** A report, never a control: native values ride the channel's record, not the launch. */
  nativeLine: string;
  /** The selected runtime's own sign-in sentence (never Claude's), or `null`. */
  connectionNote: string | null;
  /** Why this runtime cannot stop a running turn, or `null`. */
  stopWarning: string | null;
  chooseRuntime: (runtimeId: string) => void;
}

export function useLaunchDialogRuntime(
  panel: AgentLaunchPanel,
  channelId: string,
  identities: ReadonlyArray<IdentityModelRow>
): LaunchDialogRuntime {
  // The runtime-keyed record: the legacy reply describes only the channel's runtime.
  const selection = useLaunchSelection({ kind: "channel", channelId });
  const { setRuntime, setModel } = panel;
  const { runtimes, connected, connectedKnown, recordFor, catalogFor } = selection;

  const runtimeOptions = useMemo(
    () => runtimeRowOptions(runtimes, connected, connectedKnown),
    [runtimes, connected, connectedKnown]
  );

  // Only the Runtime row writes `panel.runtime` and `reset()` clears it, so non-empty = the
  // operator's explicit pick. Order: pick → identity's runtime → channel's.
  const identityRuntime =
    identities.find((t) => t.id === panel.identityId)?.runtime ?? "";
  const ownPick = panel.runtime || identityRuntime;
  const effectiveRuntime = useMemo(
    () => pickRuntime(runtimes, ownPick, selection.runtime, connected, connectedKnown),
    [runtimes, ownPick, selection.runtime, connected, connectedKnown]
  );
  const selectedRuntime = effectiveRuntime?.id ?? "";
  const scopeId = selectedRuntime || selection.defaultRuntime;

  // A roster is never borrowed from another runtime: no catalog ⇒ platform default.
  const catalog = useMemo(() => catalogFor(scopeId), [catalogFor, scopeId]);
  const record = useMemo(() => recordFor(scopeId), [recordFor, scopeId]);

  // Display ≠ submission: `panel.model` stays `''` until the operator touches the row, so main's
  // order launcher > identity > runtime default stays the one authority (as `panel.color`:
  // `null` ⇒ the server assigns the first free key).
  const modelRow = useMemo(
    () =>
      modelRowFor({
        runtimes,
        catalogs: selection.catalogs,
        catalog,
        selected: effectiveRuntime,
        own: panel.model,
        fromIdentity: identities.find((t) => t.id === panel.identityId)?.model ?? "",
      }),
    [
      runtimes,
      selection.catalogs,
      catalog,
      effectiveRuntime,
      panel.model,
      panel.identityId,
      identities,
    ]
  );

  const nativeLine = useMemo(
    () =>
      nativeSummary(
        effectiveRuntime,
        nativeDimensions(effectiveRuntime, catalog, modelRow.shown),
        record.tools,
        record.native
      ),
    [effectiveRuntime, catalog, modelRow.shown, record]
  );

  const connectionNote =
    effectiveRuntime && connectedKnown && !connected.includes(effectiveRuntime.id)
      ? signedOutLaunchCopy(effectiveRuntime)
      : null;

  // A runtime switch clears a pick the new runtime positively rejects (`ownPickSurvives`) to `''`,
  // so the row falls to the identity's model, then the runtime default — never re-pointed.
  useEffect(() => {
    if (!panel.open || !panel.model) return;
    if (
      ownPickSurvives(
        runtimes,
        selection.catalogs,
        effectiveRuntime,
        catalog,
        panel.model
      )
    ) {
      return;
    }
    setModel("");
  }, [
    panel.open,
    panel.model,
    runtimes,
    selection.catalogs,
    effectiveRuntime,
    catalog,
    setModel,
  ]);

  return {
    runtimes,
    selectedRuntime,
    runtimeOptions,
    modelRow,
    nativeLine,
    connectionNote,
    // The one exception to minimal copy (INVARIANTS §5): the descriptor's own sentence, pre-launch.
    stopWarning: runtimes.length ? interruptRefusal(effectiveRuntime) : null,
    chooseRuntime: setRuntime,
  };
}
