"use client";

/**
 * What the selected runtime implies for the New Agent dialog: the Runtime row (options, preselect),
 * the Model row (shown, offered, submitted), the native summary, sign-in and stop notes. The
 * dialog's only desktop read — a second reader would drift. Row rules are pure functions below.
 */

import { useEffect, useMemo } from "react";
import { useLaunchSelection } from "../hooks/use-launch-selection";
import {
  catalogReady,
  catalogReason,
  catalogSelection,
  modelLabel,
  modelOptionsFor,
  type ModelCatalog,
  type ModelCatalogs,
} from "../lib/model-catalog";
import {
  modelBelongsTo,
  modelSubmittableForRuntime,
  identityModelMismatch,
  type ModelMismatch,
} from "../lib/model-affinity";
import {
  interruptRefusal,
  normalizeRuntimeId,
  type RuntimeDescriptor,
} from "../lib/runtime-capability";
import { signedOutLaunchCopy } from "../lib/runtime-copy";
import { nativeDimensions, nativeSummary } from "../lib/runtime-native";
import type { AgentLaunchPanel } from "./use-agent-launch";

/** Two words, not a sentence (INVARIANTS §5). */
const NOT_CONNECTED = "not connected";

/** Runtime row: one option per reported runtime, never filtered by connectivity; no hints while
 *  `connectedKnown` is false (unknown ≠ empty). */
function runtimeRowOptions(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  connected: ReadonlyArray<string>,
  connectedKnown: boolean
): Array<{ key: string; label: string; hint?: string }> {
  return runtimes.map((d) => ({
    key: d.id,
    label: d.label,
    hint: connectedKnown && !connected.includes(d.id) ? NOT_CONNECTED : undefined,
  }));
}

/**
 * The preselect: (1) `own` (the operator's pick, else the identity's runtime), ignoring
 * connectivity; (2) the channel's `stored` pick if connected, or kept when `!connectedKnown`
 * (unknown ≠ empty); (3) the first connected; (4) the first reported. `null` only when none reported.
 * Not `descriptorFor`: it back-fills the first descriptor for `''`, swallowing links 2–4.
 */
function pickRuntime(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  own: string,
  stored: string,
  connected: ReadonlyArray<string>,
  connectedKnown: boolean
): RuntimeDescriptor | null {
  const reported = (id: string): RuntimeDescriptor | null => {
    const norm = normalizeRuntimeId(runtimes, id);
    return (norm && runtimes.find((d) => d.id === norm)) || null;
  };
  const ownPick = reported(own);
  if (ownPick) return ownPick;
  const storedPick = reported(stored);
  if (storedPick && (!connectedKnown || connected.includes(storedPick.id))) return storedPick;
  const live = runtimes.find((d) => connected.includes(d.id));
  if (live) return live;
  return runtimes[0] ?? null;
}

/** Shown when a launch names no model and the catalog has no default: the platform picks. */
const PLATFORM_DEFAULT_LABEL = "Platform default";

interface ModelRowInput {
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  catalogs: ModelCatalogs | null | undefined;
  catalog: ModelCatalog | null;
  selected: RuntimeDescriptor | null;
  /** The operator's per-launch pick — `''` until they touch the control. */
  own: string;
  fromIdentity: string;
}

export interface ModelRow {
  /** `''` means "the platform's own pick". */
  shown: string;
  shownLabel: string;
  options: ReadonlyArray<{ key: string; label: string }>;
  /** `false` renders a single-pill fact, not a greyed control. */
  selectable: boolean;
  /** Identity model owned by another runtime; `null` when it is not OR ownership is unknown. */
  mismatch: ModelMismatch | null;
  /** The desktop's own sentence about the roster, or `null`. */
  reason: string | null;
}

/**
 * Model row, in main's order — own pick > identity > the catalog's default. An identity model
 * positively owned by ANOTHER ready catalog is dropped and explained (`mismatch`), never translated.
 * An own pick the runtime's catalog lacks is refused `no-model` by main
 * (`session-launch.js › refuseUnknownModel`).
 */
function modelRowFor(input: ModelRowInput): ModelRow {
  const { catalog, selected, runtimes, catalogs } = input;
  const mismatch = identityModelMismatch(
    runtimes,
    catalogs,
    selected,
    input.fromIdentity
  );
  // Main skips an identity model the READY roster lacks (`launch-default.js › identityModelFor`).
  const usableIdentityModel =
    mismatch || modelBelongsTo(catalog, input.fromIdentity) === false ? "" : input.fromIdentity;
  const usableOwn = modelSubmittableForRuntime(
    runtimes,
    catalogs,
    selected,
    catalog,
    input.own
  )
    ? input.own
    : "";
  const resolved = usableOwn || usableIdentityModel;
  const shown = catalogSelection(catalog, resolved);
  // A pill row whose value matches no option selects nothing, so `''` gets its own pill.
  const options = modelOptionsFor(catalog, shown).map((o) => ({ key: o.value, label: o.label }));
  return {
    shown,
    shownLabel: shown ? modelLabel(catalog, shown) : PLATFORM_DEFAULT_LABEL,
    options: shown ? options : [{ key: "", label: PLATFORM_DEFAULT_LABEL }, ...options],
    selectable: catalogReady(catalog),
    mismatch,
    reason: catalogReason(catalog),
  };
}

/**
 * False only for a pick the selected catalog or another READY catalog positively rejects/owns;
 * genuinely unknown ids survive in the renderer (main may still refuse them `no-model`).
 */
function ownPickSurvives(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  catalogs: ModelCatalogs | null | undefined,
  selected: RuntimeDescriptor | null,
  catalog: ModelCatalog | null,
  own: string
): boolean {
  return (
    !own || modelSubmittableForRuntime(runtimes, catalogs, selected, catalog, own)
  );
}

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
