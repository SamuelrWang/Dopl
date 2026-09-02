/**
 * WHICH MODEL AN AGENT RUNS ON — the shared vocabulary, and nothing that reads or
 * writes it.
 *
 * ⚠ THIS IS THE ONE PLACE THE ID→LABEL MAP LIVES (Samuel, 2026-08-22). Four
 * surfaces name a model — the channel Settings tab's durable row, the live
 * posture strip on a running agent, the agent cards' effective-model chip, and
 * the panel/window headers — and a second table anywhere is the
 * two-readers-one-fact defect with a MODEL NAME as the thing that drifts. An
 * operator reading "Opus" on a card and "Sonnet" in Settings for one agent has no
 * way to tell which is lying.
 *
 * ⚠ NO HOOK, NO BRIDGE, NO REACT — the rule `permission-modes.ts` follows and the
 * precedent this file is built on (INVARIANTS §1: one file, one reason to
 * change). Anything that reaches `window.dopl` belongs in a hook; anything that
 * renders belongs in a component. The one reason THIS changes is that the model
 * roster changed.
 *
 * ⚠ THE IDS ARE THE SDK'S, AND THIS IS NOT A SECOND AUTHORITY ON THEM. The
 * desktop re-validates every write; this module's job is to keep the web from
 * OFFERING a value main would reject, exactly as `permission-modes.ts` does for
 * the two permission axes. An id this table does not know is rendered as itself
 * (see {@link agentModelLabel}) rather than dropped — a newer main may run a
 * model this build has never heard of, and a blank chip would report that as "no
 * model" (INVARIANTS §11 — UNKNOWN is not EMPTY).
 */

/**
 * ⚠ ABSENCE IS "DEFAULT", AND IT IS A REAL PICK RATHER THAN A MISSING ONE. There
 * is no `"default"` id: the operator choosing Default means the posture record
 * carries NO model and the SDK's own default applies at spawn. Minting a sentinel
 * id for it would put a value on the wire that main has to special-case, and
 * would make "never chosen" and "chose the default" indistinguishable the moment
 * the SDK default moved.
 */
export const AGENT_MODEL_DEFAULT = "" as const;

/**
 * The roster, in the order an operator reads it — most capable first, cheapest
 * last, with Default at the top because it is what an unset channel already does.
 *
 * `short` is the ONE-WORD label for a glance surface (a card chip, a header); the
 * full `label` carries the version an operator needs when they are CHOOSING.
 */
const AGENT_MODELS: ReadonlyArray<{
  id: string;
  label: string;
  short: string;
}> = [
  { id: "claude-fable-5", label: "Fable 5", short: "Fable" },
  { id: "claude-opus-5", label: "Opus 5", short: "Opus" },
  { id: "claude-sonnet-5", label: "Sonnet 5", short: "Sonnet" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", short: "Haiku" },
];

/**
 * The `SelectMenu` options, Default included.
 *
 * ⚠ NO PER-OPTION DESCRIPTION, deliberately, and it is the minimal-copy ruling
 * rather than an oversight (INVARIANTS §5). The permission axes carry a
 * description each because a security review found operators could not tell what
 * a mode PERMITTED — a model name has no blast radius to explain, and ranking
 * them ("fastest", "most capable") would be this tab explaining itself again.
 */
export const AGENT_MODEL_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: AGENT_MODEL_DEFAULT, label: "Default" },
  ...AGENT_MODELS.map(({ id, label }) => ({ value: id, label })),
];

/**
 * THE OPTIONS A LIVE SELECTOR MAY SHOW, given what the agent is ACTUALLY on.
 *
 * ⚠ THE EFFECTIVE MODEL IS FREE-FORM AND THE ROSTER IS NOT (`spa-bridge.ts ›
 * DesktopSessionSummary.model`: "what arrives is whatever the CLI reported — a
 * dated id like `claude-opus-4-5-20251101`, or a `[1m]` long-context variant —
 * NOT necessarily a member of the four ids `sessions.setModel` accepts. Render
 * it; do not match it against that list."). A `SelectMenu` whose `value` matches
 * no option renders BLANK, so an agent running a dated id would show an empty
 * control where its model should be — the surface saying nothing where it has an
 * answer (INVARIANTS §11).
 *
 * ⚠ THE EXTRA OPTION IS THE CURRENT VALUE AND NOTHING ELSE. It is appended, never
 * inserted into the roster, and it disappears the moment the agent moves onto a
 * known id — the four the desktop accepts stay the four an operator can PICK.
 */
export function agentModelOptionsFor(
  effective: string | null | undefined
): ReadonlyArray<{ value: string; label: string }> {
  const trimmed = typeof effective === "string" ? effective.trim() : "";
  if (!trimmed || AGENT_MODEL_OPTIONS.some((o) => o.value === trimmed)) {
    return AGENT_MODEL_OPTIONS;
  }
  return [...AGENT_MODEL_OPTIONS, { value: trimmed, label: agentModelLabel(trimmed) }];
}

/**
 * THE FULL LABEL for a stored id, for a surface where the operator is choosing.
 * An unset model reads "Default"; an id this build does not know reads AS ITSELF.
 */
export function agentModelLabel(id: string | null | undefined): string {
  const trimmed = typeof id === "string" ? id.trim() : "";
  if (!trimmed) return "Default";
  return AGENT_MODELS.find((m) => m.id === trimmed)?.label ?? trimmed;
}

/**
 * THE ONE-WORD label for a glance surface (an agent card, a header).
 *
 * ⚠ `null` MEANS "DO NOT RENDER A CHIP", and that is a different answer from
 * {@link agentModelLabel}'s "Default". A card states what an agent IS RUNNING; an
 * older main reports no model at all, and a chip reading "Default" there would
 * claim this build knows something it does not. The Settings row is the opposite
 * case — the operator is picking, and "Default" is one of the picks.
 *
 * ⚠ AN UNKNOWN ID STILL RENDERS, as itself. A newer main may run a model this
 * build predates, and the honest chip is the raw id rather than silence.
 */
export function agentModelShortLabel(id: string | null | undefined): string | null {
  const trimmed = typeof id === "string" ? id.trim() : "";
  if (!trimmed) return null;
  return AGENT_MODELS.find((m) => m.id === trimmed)?.short ?? trimmed;
}

/**
 * Coerce a bridge reply's model into a storable id, or `null` for "unset".
 *
 * ⚠ IT DOES NOT REJECT AN UNKNOWN ID. Unlike `normalizePermissionPreset`, which
 * refuses a value the two axes cannot name, the model roster is the SDK's and
 * moves without this tree shipping — so a main running a newer model must not
 * have its answer erased into "Default" by a web build that predates it. What is
 * rejected is a non-string and an empty one, both of which mean unset.
 */
export function normalizeAgentModel(raw: unknown): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || null;
}

/**
 * **THE ALIASES A DESKTOP ACCEPTS BESIDE THE FULL IDS** — `main/session-model.js
 * › MODEL_CHOICES` / `› ID_TO_ALIAS`, restated because the two trees cannot
 * import each other.
 *
 * ⚠ **`"default"` IS DELIBERATELY ABSENT.** It is not a model, it is the ABSENCE
 * of one ({@link AGENT_MODEL_DEFAULT}), and mapping it to an id would be minting
 * the sentinel that constant exists to refuse.
 */
const AGENT_MODEL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  fable: "claude-fable-5",
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5-20251001",
});

/**
 * **THE CANONICAL ID A REQUESTED MODEL RESOLVES TO, OR `null`** (2026-09-02, A9
 * — guardrail G8).
 *
 * ⚠ **G8 IS CLOSED BY TELLING THE CALLER, NOT BY REFUSING THEM**, and the choice
 * has a reason this file already states twice. The guardrail records that *"an
 * unrecognised `model` id is NOT refused — it silently FALLS BACK and nothing
 * tells you"*: `main/session-model.js › normalizeModelId` fails closed to the
 * CLI's own default. The gap is the SILENCE. A server-side 400 would close it by
 * refusing values the machine runs happily — {@link normalizeAgentModel}'s own
 * rule is that *"a main running a newer model must not have its answer erased by
 * a web build that predates it"*, and the desktop additionally accepts the
 * aliases above and `[1m]` long-context variants. That is a narrowing nobody
 * ruled. So the server ECHOES what it recognised and says nothing about what it
 * did not, and the result line reports the difference.
 *
 * ⚠ **`null` MEANS "NOT RECOGNISED HERE", NOT "REFUSED" AND NOT "NO MODEL".**
 * The requested value is carried to the machine unchanged either way. A caller
 * that asked for nothing also gets `null`, and the two are told apart by whether
 * a model was requested at all.
 */
export function resolveAgentModelId(raw: string | null | undefined): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return null;
  if (AGENT_MODELS.some((m) => m.id === trimmed)) return trimmed;
  return AGENT_MODEL_ALIASES[trimmed.toLowerCase()] ?? null;
}
