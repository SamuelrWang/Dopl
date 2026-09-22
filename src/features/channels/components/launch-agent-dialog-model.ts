/**
 * THE NEW-AGENT POPUP'S MODEL ROW — what it shows, what it offers, what it SUBMITS, and the one
 * sentence it says when a template's model belongs to another runtime (2026-09-21, U7).
 *
 * ⚠ ITS OWN FILE past the §1 cap, on the seam `launch-agent-dialog-runtime.ts` already set: that
 * one answers what the RUNTIME row offers and which pill it opens on, this one answers what the
 * MODEL row does once a runtime is selected. The dialog keeps the JSX, the identity fields and
 * the launch lane.
 *
 * ⚠ NO REACT, NO HOOK, NO BRIDGE — `lib/runtime-capability.ts`'s rule. Everything answers off the
 * catalog and the descriptor table the desktop already handed over.
 *
 * ── ⚠ **WHAT CHANGED, AND WHY THE OLD CHAIN COULD NOT SURVIVE A SECOND RUNTIME** ─────────────
 *
 * The row used to read `agentModelSelection(panel.model || template.model || channel.model)` —
 * one chain over ONE frozen Claude table, mirroring main's precedence link for link. With a
 * second runtime every link in it became wrong in a different way:
 *
 *   · the CHANNEL's model is now stored PER RUNTIME, so "the channel's model" is only meaningful
 *     once a runtime is named ({@link ModelRowInput.remembered});
 *   · the TEMPLATE's model belongs to whichever runtime offers it, and a template authored on
 *     Claude must not silently re-point a Codex launch — {@link modelRowFor} surfaces that as a
 *     MISMATCH rather than translating the id, which is the plan's U7 rule verbatim;
 *   · the BACK-FILL was Sonnet, which is a Claude id and may never be shown on a Codex surface.
 *     The runtime's own catalog default replaces it, and an absent one shows the platform default.
 *
 * ⚠ **DISPLAY IS NOT SUBMISSION, AND THAT DISTINCTION IS OLDER THAN THIS FILE.** The row DISPLAYS
 * the resolved id while `panel.model` stays `''` until the operator touches the control, so an
 * untouched dialog puts no model on the wire at all and main's precedence chain stays the one
 * authority. {@link ModelRow.submit} is the only value that may travel.
 */

import {
  catalogReady,
  catalogReason,
  catalogSelection,
  modelOptionsFor,
  type ModelCatalog,
  type ModelCatalogs,
} from "../lib/model-catalog";
import {
  modelSubmittableForRuntime,
  templateModelMismatch,
  type ModelMismatch,
} from "../lib/model-affinity";
import type { RuntimeDescriptor } from "../lib/runtime-capability";

export interface ModelRowInput {
  /** Every reported runtime, for deciding which one a template's model belongs to. */
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  catalogs: ModelCatalogs | null | undefined;
  /** The catalog of the SELECTED runtime, or `null` when there is none. */
  catalog: ModelCatalog | null;
  /** The runtime this spawn will run on, or `null` where nothing was reported. */
  selected: RuntimeDescriptor | null;
  /** The operator's own per-launch pick — `''` until they touch the control. */
  own: string;
  /** The selected template's model, or `''`. */
  fromTemplate: string;
  /** What the CHANNEL remembers **for the selected runtime**, or `''`. */
  remembered: string;
}

export interface ModelRow {
  /** What the control displays. ⚠ `''` means "the platform's own pick" and renders as a fact. */
  shown: string;
  options: ReadonlyArray<{ key: string; label: string }>;
  /** May the operator pick? ⚠ `false` RENDERS A FACT, NOT A GREYED CONTROL (design §3.2). */
  selectable: boolean;
  /** The id this launch may put on the wire, or `''` for none. */
  submit: string;
  /** The template's model belongs to another runtime. ⚠ `null` when it does not, or when this
   *  build cannot say — "I cannot tell" must never read as "it belongs to somebody else". */
  mismatch: ModelMismatch | null;
  /** The desktop's own sentence about the roster, or `null`. */
  reason: string | null;
}

/**
 * THE WHOLE ROW, IN ONE FUNCTION.
 *
 * ⚠ **THE CHAIN IS MAIN'S, LINK FOR LINK, WITH THE TEMPLATE LINK GATED** — own pick > template >
 * the selected runtime's remembered pick > the catalog's declared default. The gate is the only
 * addition and it is the one the plan asks for: a template model this build can positively see
 * belongs to another runtime is DROPPED FROM THE CHAIN and explained, rather than shown as this
 * launch's model and then silently coerced by main.
 *
 * ⚠ **THE OPERATOR'S OWN PICK IS GATED TOO, AND IT IS A DIFFERENT GATE.**
 * `modelSubmittableForRuntime` consults the selected catalog first, then positive ownership facts
 * from the other ready catalogs. Thus a Claude pick cannot cross into Codex merely because the
 * Codex catalog is loading/unavailable, while a genuinely unknown id still travels under the
 * tree's standing *"unknown model falls back, never refuses"* rule (`session-launch-op.js`, F-5).
 */
export function modelRowFor(input: ModelRowInput): ModelRow {
  const { catalog, selected, runtimes, catalogs } = input;
  const mismatch = templateModelMismatch(
    runtimes,
    catalogs,
    selected,
    input.fromTemplate
  );
  const usableTemplateModel = mismatch ? "" : input.fromTemplate;
  const usableOwn = modelSubmittableForRuntime(
    runtimes,
    catalogs,
    selected,
    catalog,
    input.own
  )
    ? input.own
    : "";
  const resolved = usableOwn || usableTemplateModel || input.remembered;
  const shown = catalogSelection(catalog, resolved);
  return {
    shown,
    // ⚠ `agentModelOptionsFor`'s RULE, MOVED TO THE CATALOG: the currently EFFECTIVE id is
    // appended when the roster does not carry it, because a `SelectMenu` whose value matches no
    // option renders BLANK — the surface saying nothing where it has an answer (INVARIANTS §11).
    options: modelOptionsFor(catalog, shown).map((o) => ({ key: o.value, label: o.label })),
    selectable: catalogReady(catalog),
    submit: usableOwn,
    mismatch,
    reason: catalogReason(catalog),
  };
}

/**
 * IS THE OPERATOR'S OWN PICK STILL MEANINGFUL ON THIS RUNTIME?
 *
 * ⚠ **IT IS WHAT CLEARS A STALE PER-LAUNCH PICK ON A RUNTIME SWITCH.** The plan: *"on runtime
 * change, show that runtime's REMEMBERED model or its reported platform default."* A pick the
 * operator made while Claude was selected is not a pick they made for Codex, and carrying it
 * across would put a Claude id in front of them under a Codex heading — the exact substitution
 * the whole unit exists to remove.
 * ⚠ **IT ONLY CLEARS WHAT IT CAN SEE IS FOREIGN.** A selected roster this build has not read
 * can still reject a pick when another READY roster positively owns it. With no positive owner,
 * the pick survives: unknown remains distinct from empty.
 */
export function ownPickSurvives(
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
