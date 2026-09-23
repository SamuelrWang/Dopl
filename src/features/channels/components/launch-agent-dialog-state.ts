"use client";

/**
 * WHAT THE SELECTED RUNTIME MEANS FOR THE NEW-AGENT POPUP — the roster, the preselect, the model
 * row, the native summary, the connection sentence, and the two writes back into the panel that
 * keep the screen and the wire one value (2026-09-21, U7).
 *
 * ⚠ **ITS OWN FILE PAST THE §1 CAP, AND THE SEAM IS A REASON TO CHANGE.**
 * `launch-agent-dialog.tsx` is the FORM — six rows, the identity fields, the launch lane — and it
 * changes when Samuel rules about a row. This changes when RUNTIME SELECTION implies something
 * new. Those clocks came apart the moment a runtime switch had to re-derive a model roster, a
 * remembered pick, a native summary and a refusal sentence rather than just a label.
 * ⚠ It joins the two files that already split off this dialog on the same principle:
 * `launch-agent-dialog-runtime.ts` (what the Runtime ROW offers and where it opens) and
 * `launch-agent-dialog-model.ts` (what the Model ROW shows, offers and submits). Neither rule is
 * restated here — a rule written twice drifts in one of the copies.
 *
 * ⚠ **IT IS THE ONLY PLACE THIS DIALOG REACHES THE DESKTOP.** One `useLaunchSelection` mount, one
 * record, one runtime. A second reader of the same record in the form would be the
 * two-readers-one-fact defect with the LAUNCH RUNTIME as the thing that drifts.
 */

import { useEffect, useMemo } from "react";
import { useLaunchSelection } from "../hooks/use-launch-selection";
import { interruptRefusal, type RuntimeDescriptor } from "../lib/runtime-capability";
import { signedOutLaunchCopy } from "../lib/runtime-copy";
import { nativeDimensions, nativeSummary } from "../lib/runtime-native";
import { modelRowFor, ownPickSurvives, type ModelRow } from "./launch-agent-dialog-model";
import { pickRuntime, runtimeRowOptions } from "./launch-agent-dialog-runtime";
import type { AgentLaunchPanel } from "./use-agent-launch";

/** Only what this hook reads off an identity row. ⚠ A SHAPE, not `AgentIdentity` by name —
 *  `use-agent-launch.ts › AgentIdentityPrefill` states the rule and the reason. */
export interface IdentityModelRow {
  id: string;
  model?: string | null;
  /** The identity's runtime; absent/null/`''` = no preference. */
  runtime?: string | null;
}

export interface LaunchDialogRuntime {
  /** Every reported runtime. ⚠ NEVER FILTERED BY CONNECTIVITY — Samuel's 2026-09-08 correction. */
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  /** What this spawn runs on — always sent; `''` only where nothing was reported. */
  selectedRuntime: string;
  runtimeOptions: Array<{ key: string; label: string; hint?: string }>;
  modelRow: ModelRow;
  /** "on-request approvals · workspace-write sandbox", or `''`. ⚠ A REPORT, NEVER A CONTROL. */
  nativeLine: string;
  /** The selected runtime's OWN sign-in sentence, or `null`. ⚠ Never Claude's, on any runtime. */
  connectionNote: string | null;
  /** Why this runtime cannot stop a running turn, or `null`. */
  stopWarning: string | null;
  /** The Runtime row's writer: an OPERATOR pick, which outranks the identity's runtime. */
  chooseRuntime: (runtimeId: string) => void;
}

export function useLaunchDialogRuntime(
  panel: AgentLaunchPanel,
  channelId: string,
  identities: ReadonlyArray<IdentityModelRow>
): LaunchDialogRuntime {
  /**
   * ⚠ **THE VERSIONED, RUNTIME-KEYED RECORD, NOT THE LEGACY PAIR.** This dialog has to answer
   * "what does THIS runtime remember" for whichever pill is selected right now, and the legacy
   * `{tools, messages, model}` reply describes only the runtime the CHANNEL picked.
   * `hooks/use-launch-selection.ts` carries the whole argument.
   */
  const selection = useLaunchSelection({ kind: "channel", channelId });
  const { setRuntime, setModel } = panel;
  const { runtimes, connected, connectedKnown, recordFor, catalogFor } = selection;

  const runtimeOptions = useMemo(
    () => runtimeRowOptions(runtimes, connected, connectedKnown),
    [runtimes, connected, connectedKnown]
  );

  // Ruling 5: launcher's explicit pick → the identity's runtime → the channel's. Only the Runtime
  // row writes `panel.runtime` and `reset()` clears it, so non-empty means the operator picked.
  const identityRuntime =
    identities.find((t) => t.id === panel.identityId)?.runtime ?? "";
  const ownPick = panel.runtime || identityRuntime;
  const effectiveRuntime = useMemo(
    () => pickRuntime(runtimes, ownPick, selection.runtime, connected, connectedKnown),
    [runtimes, ownPick, selection.runtime, connected, connectedKnown]
  );
  const selectedRuntime = effectiveRuntime?.id ?? "";
  const scopeId = selectedRuntime || selection.defaultRuntime;

  // ⚠ NEVER ANOTHER RUNTIME'S LIST: a runtime with no catalog shows the platform default.
  const catalog = useMemo(() => catalogFor(scopeId), [catalogFor, scopeId]);
  const record = useMemo(() => recordFor(scopeId), [recordFor, scopeId]);

  /**
   * WHAT THE MODEL ROW SHOWS, OFFERS AND SUBMITS — the rule is
   * `launch-agent-dialog-model.ts › modelRowFor`, where the chain and its two gates are argued.
   *
   * ⚠ **DISPLAY ONLY, unchanged since 2026-09-06**: `panel.model` stays `''` until the operator
   * touches the control, so an untouched dialog puts no model on the wire and main's precedence
   * chain stays the one authority. A row that stamped its resolved id into the panel would turn
   * the identity's model (or the runtime default) into a per-spawn pick that stops following it.
   */
  const modelRow = useMemo(
    () =>
      modelRowFor({
        runtimes,
        catalogs: selection.catalogs,
        catalog,
        selected: effectiveRuntime,
        own: panel.model,
        fromIdentity: identities.find((t) => t.id === panel.identityId)?.model ?? "",
        // ⚠ NO `remembered` CHANNEL MODEL SINCE 2026-09-23 (Samuel: "We don't need a pin model in
        // the settings") — the row falls from the identity's model straight to the runtime's
        // default, which is what main's launch does.
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

  /**
   * WHAT THIS RUNTIME WILL ACTUALLY DO, IN ITS OWN WORDS.
   *
   * ⚠ **A REPORT, NEVER A CONTROL** (Decision #1, and INVARIANTS' rule that a control which
   * writes nowhere must be ABSENT). A launch carries no per-spawn native override — those ride
   * the CHANNEL's stored record (`channel-prefs.js › launchStartModes`) — so a picker here would
   * write nowhere. The operator gets the effective combination instead, before they start, in the
   * platform's own option labels.
   */
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

  /**
   * ⚠ **THE RUNTIME'S OWN SIGN-IN SENTENCE, NOT CLAUDE'S** (U10's `runtime-copy.ts`, consumed
   * rather than forked). A signed-out Codex used to be told to fix a Claude credential the
   * session does not use; the copy is built from `descriptor.label`, so a fourth runtime gets a
   * correct sentence by registering rather than by somebody adding an arm.
   * ⚠ IT IS A NOTE BESIDE A PILL THAT STAYS SELECTABLE — an unconnected runtime is a setup step,
   * not a missing capability, and `acquire`'s spawn-time refusal is what actually routes.
   */
  const connectionNote =
    effectiveRuntime && connectedKnown && !connected.includes(effectiveRuntime.id)
      ? signedOutLaunchCopy(effectiveRuntime)
      : null;

  /**
   * ⚠ **A PER-LAUNCH MODEL PICK DOES NOT SURVIVE A RUNTIME SWITCH IT DOES NOT BELONG TO**
   * (U7: *"on runtime change, show that runtime's REMEMBERED model or its reported platform
   * default"*). The operator picked Fable while Claude was selected; that is not a pick they made
   * for Codex, and carrying it would put a Claude id in front of them under a Codex heading and
   * then submit it.
   * ⚠ **IT CLEARS ONLY WHAT THIS BUILD CAN SEE IS FOREIGN.** The selected roster may be unread,
   * but another READY roster can still positively identify the pick's owner. Genuinely unknown
   * ids survive because the tree's standing rule is that an unknown model FALLS BACK rather than
   * being refused (F-5), and a desktop that cannot read a catalog must stay launchable.
   * ⚠ IT CLEARS TO `''` RATHER THAN RE-POINTING. `''` is "no per-spawn pick", so the row falls to
   * the identity's model and then to the new runtime's own default (there is no remembered channel
   * model since 2026-09-23), made by doing nothing rather than by choosing for the operator.
   */
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
    // ⚠ ONE SENTENCE, AND THE ONE EXCEPTION TO THE MINIMAL-COPY RULING (INVARIANTS §5). It is the
    // descriptor's own words, and it is a NOTE rather than an ALERT: nothing has failed, and the
    // operator is told what this runtime cannot do BEFORE they start it.
    stopWarning: runtimes.length ? interruptRefusal(effectiveRuntime) : null,
    chooseRuntime: setRuntime,
  };
}
