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

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useLaunchSelection,
  type LaunchSelectionState,
} from "../hooks/use-launch-selection";
import { defaultRuntimeFallbackCatalog } from "../lib/agent-models";
import { interruptRefusal, type RuntimeDescriptor } from "../lib/runtime-capability";
import { signedOutLaunchCopy } from "../lib/runtime-copy";
import { nativeDimensions, nativeSummary } from "../lib/runtime-native";
import type { ModelCatalog } from "../lib/model-catalog";
import { modelRowFor, ownPickSurvives, type ModelRow } from "./launch-agent-dialog-model";
import {
  EMPTY_CONNECTED,
  EMPTY_RUNTIMES,
  pickRuntime,
  runtimeRowOptions,
} from "./launch-agent-dialog-runtime";
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
  connected: ReadonlyArray<string>;
  connectedKnown: boolean;
  /** What this spawn will run on, or `null` where the desktop reported nothing. */
  effectiveRuntime: RuntimeDescriptor | null;
  /** `''` only where nothing was reported — the no-row, no-key lane. */
  selectedRuntime: string;
  runtimeOptions: Array<{ key: string; label: string; hint?: string }>;
  modelRow: ModelRow;
  /** The selected runtime's catalog, or `null`. */
  catalog: ModelCatalog | null;
  /** "on-request approvals · workspace-write sandbox", or `''`. ⚠ A REPORT, NEVER A CONTROL. */
  nativeLine: string;
  /** The selected runtime's OWN sign-in sentence, or `null`. ⚠ Never Claude's, on any runtime. */
  connectionNote: string | null;
  /** Why this runtime cannot stop a running turn, or `null`. */
  stopWarning: string | null;
  /** The whole record, for a caller that needs more than the above. */
  selection: LaunchSelectionState;
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
  // ⚠ DESTRUCTURED so the sync effect below can DEPEND on it: `panel` is a fresh object every
  // render, while `setRuntime` is `useAgentLaunch`'s own setState function and is stable.
  const { setRuntime, setModel } = panel;
  const { recordFor, catalogFor } = selection;

  // ⚠ EMPTY UNTIL THE PROBE ANSWERS, and empty forever off-desktop — which renders NO runtime row
  // and no warning, the correct direction while the answer is out (INVARIANTS §11).
  const runtimes = selection.runtimeSupported ? selection.runtimes : EMPTY_RUNTIMES;
  // ⚠ THE ROSTER IS NEVER FILTERED BY THIS (Samuel's correction). It labels and it orders the
  // preselect; it removes nothing.
  const connected = selection.runtimeSupported ? selection.connected : EMPTY_CONNECTED;
  const connectedKnown = selection.runtimeSupported && selection.connectedKnown;

  const runtimeOptions = useMemo(
    () => runtimeRowOptions(runtimes, connected, connectedKnown),
    [runtimes, connected, connectedKnown]
  );

  /**
   * WHAT THIS SPAWN WILL RUN ON — one descriptor that is the SELECTION, the refusal sentence and
   * the payload at once. ⚠ ONE OBJECT ON PURPOSE: a row selecting one runtime while the warning
   * read another's refusals is what `runtime-capability.ts › descriptorFor` exists to prevent.
   * {@link pickRuntime} is the whole four-link chain and its argument.
   */
  // Ruling 5: launcher's explicit pick → the identity's runtime → the channel's. `panel.runtime`
  // is also written back by the effect below, so only a Runtime-row click counts as a pick; the
  // flag resets with the dialog (derived during render, never in an effect).
  const [explicit, setExplicit] = useState({ open: panel.open, picked: false });
  if (explicit.open !== panel.open) setExplicit({ open: panel.open, picked: false });
  const chooseRuntime = useCallback(
    (runtimeId: string) => {
      setExplicit({ open: true, picked: true });
      setRuntime(runtimeId);
    },
    [setRuntime]
  );
  const identityRuntime =
    identities.find((t) => t.id === panel.identityId)?.runtime ?? "";
  const ownPick = explicit.picked ? panel.runtime : identityRuntime;
  const effectiveRuntime = useMemo(
    () => pickRuntime(runtimes, ownPick, selection.runtime, connected, connectedKnown),
    [runtimes, ownPick, selection.runtime, connected, connectedKnown]
  );
  const selectedRuntime = effectiveRuntime?.id ?? "";
  const scopeId = selectedRuntime || selection.defaultRuntime;

  /**
   * ⚠ **THE ONE SUBSTITUTION, AND IT IS THE PRE-RUNTIME LANE.** A plain browser and every desktop
   * older than the adapter port report NO runtime at all, so there is no id to key a catalog by
   * and `useRuntimeCatalogs` can answer nothing — yet that product was the DEFAULT runtime's and
   * its Model row has always listed the frozen table. Rendering raw ids there would be a
   * regression dressed as honesty (INVARIANTS §11 — unknown is not empty).
   * ⚠ **IT IS GATED ON `runtimes.length === 0`, WHICH IS THE WHOLE FENCE.** The moment this
   * desktop reports a roster, a runtime with no catalog gets `null` and shows the platform
   * default — never another runtime's list. That asymmetry is the plan's hardest invariant, and
   * `use-runtime-catalogs.ts` makes the same two-part argument about its own fallback.
   */
  const catalog = useMemo(
    () => catalogFor(scopeId) ?? (runtimes.length ? null : defaultRuntimeFallbackCatalog("")),
    [catalogFor, scopeId, runtimes.length]
  );
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
   * THE SELECTION IS WRITTEN BACK INTO THE PANEL, so the pill on screen and the argument on the
   * wire are ONE value (`use-agent-launch-run.ts › launchWithIdentity` sends `panel.runtime`).
   *
   * ⚠ NOT THE MODEL ROW'S FORBIDDEN MOVE, AND THE DIFFERENCE IS THE RULING: `''` in the model row
   * means "follow the chain", so stamping it would freeze a per-spawn copy. The runtime row no
   * longer has that meaning — Samuel removed the fall-through on 2026-09-08.
   * ⚠ IT RUNS ONLY WHILE OPEN, and `reset()` clears the field on close, so a dialog reopened after
   * the channel's pick moved re-derives.
   */
  useEffect(() => {
    if (!panel.open || !selectedRuntime || panel.runtime === selectedRuntime) return;
    setRuntime(selectedRuntime);
  }, [panel.open, panel.runtime, selectedRuntime, setRuntime]);

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
    connected,
    connectedKnown,
    effectiveRuntime,
    selectedRuntime,
    runtimeOptions,
    modelRow,
    catalog,
    nativeLine,
    connectionNote,
    // ⚠ ONE SENTENCE, AND THE ONE EXCEPTION TO THE MINIMAL-COPY RULING (INVARIANTS §5). It is the
    // descriptor's own words, and it is a NOTE rather than an ALERT: nothing has failed, and the
    // operator is told what this runtime cannot do BEFORE they start it.
    stopWarning: runtimes.length ? interruptRefusal(effectiveRuntime) : null,
    selection,
    chooseRuntime,
  };
}
