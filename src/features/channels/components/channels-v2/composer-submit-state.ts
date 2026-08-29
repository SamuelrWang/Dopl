/**
 * WHAT THE COMPOSER'S ONE SUBMIT CONTROL DOES RIGHT NOW — the whole of it, in one pure function.
 *
 * ⚠ SPLIT OUT OF `composer.tsx` ON 2026-08-28, AT THE 500-LINE CAP, and the seam is §1's
 * reason-to-change rather than the count that forced the question. That file is the composer's
 * TREE — what is mounted, where the picker hangs, which write a submit fires. This is the
 * three-act DERIVATION over it, and the acts are what moved three times in four days: Create
 * joined Send (2026-08-26), Launch joined both (2026-08-27), and the arrow moved out of the input
 * row into the toolbar (2026-08-28). Nothing about the tree changed on any of those days.
 *
 * ⚠ ONE CONDITION, NOT FIVE SPELLINGS OF IT. `panelOpen` is read by the submit's FACE (a word, not
 * an arrow), by the chat textarea's mount, by the @-picker's popover and by the `@` glyph that
 * writes into that textarea — and until 2026-08-28 three of those four re-derived it inline, which
 * is how the picker came to outlive the field it belongs to (see {@link ComposerSubmitState}).
 * Deriving it once, here, is what stops the next surface disagreeing with the other four.
 *
 * ⚠ IT IS PURE AND IT TAKES NO PANEL OBJECT. The two panels are `use-agent-launch.ts` and
 * `use-thread-request.ts`, each with its own state, its own reset and its own `ready` rule; this
 * reads the four booleans and four strings that decide the BUTTON, so it can be driven from a
 * table and cannot reach back into either hook.
 */

/** The three acts, in the order the composer resolves them. ⚠ The LAUNCH arm outranks the
 *  REQUEST arm because the two panels are mutually exclusive and the Bot icon closes the other;
 *  the order is a belt on that, never the rule itself. */
export type ComposerAct = "launch" | "request" | "chat";

export interface ComposerSubmitState {
  act: ComposerAct;
  /** ⚠ Either panel showing. The submit wears a WORD, the chat textarea is UNMOUNTED, and the
   *  @-picker — popover and glyph alike — is gone with the field it edits. */
  panelOpen: boolean;
  /** The button's visible text. ⚠ VISIBLE TEXT, NOT A TOOLTIP ON AN ARROW: shipping the verb as
   *  a `title` made all three acts look identical. */
  label: string;
  canSend: boolean;
  /** ⚠ A DISABLED SEND SAYS WHY (INVARIANTS §8, rule 4) — a disabled control with no reason is
   *  indistinguishable from a broken one. */
  hint: string;
  /** Is there anything to DISCARD. ⚠ An always-present control that does nothing is the inert
   *  chrome §5 forbids; with a panel open the "composer area" IS the panel. */
  hasContent: boolean;
}

const filled = (a: string, b: string): boolean =>
  a.trim().length > 0 || b.trim().length > 0;

/**
 * Why Send is disabled, said out loud.
 *
 * ⚠ THE ENABLED BRANCH IS THE BUTTON'S OWN LABEL, three ways over — a tooltip that says something
 * other than the control it sits on is a second name for one action.
 * ⚠ EACH REFUSAL NAMES THE FIELDS OF THE SURFACE THE OPERATOR IS LOOKING AT, and no others: a
 * hint mentioning a textarea that is not on screen sends them hunting for it.
 */
function sendHint(act: ComposerAct, label: string, canSend: boolean, pending: boolean): string {
  if (canSend) return label;
  if (pending) return "Sending…";
  if (act === "launch") return "An agent needs a name";
  if (act === "chat") return "Write a message first";
  return "A request needs a title, a description and at least one agent";
}

/**
 * ⚠ THE THREE ARMS READ DIFFERENT FIELDS, AND THAT IS THE POINT (2026-08-26 / 08-27). A REQUEST is
 * title + description + at least one addressee, none of which is the chat draft — which is not
 * even mounted while its panel is open. A LAUNCH is a name. A chat message is the draft and
 * nothing else. One `canSend` computed here is read twice by the caller: the button's `disabled`
 * and the submit's own guard.
 */
export function composerSubmitState(a: {
  pending: boolean;
  /** The trimmed chat draft. */
  body: string;
  launch: { open: boolean; ready: boolean; name: string; description: string };
  request: { open: boolean; ready: boolean; title: string; description: string };
}): ComposerSubmitState {
  const act: ComposerAct = a.launch.open ? "launch" : a.request.open ? "request" : "chat";
  const ready =
    act === "launch" ? a.launch.ready : act === "request" ? a.request.ready : a.body.length > 0;
  const canSend = !a.pending && ready;
  const label = act === "launch" ? "Launch" : act === "request" ? "Create" : "Send";
  return {
    act,
    panelOpen: act !== "chat",
    label,
    canSend,
    hint: sendHint(act, label, canSend, a.pending),
    hasContent:
      act === "launch"
        ? filled(a.launch.name, a.launch.description)
        : act === "request"
          ? filled(a.request.title, a.request.description)
          : a.body.length > 0,
  };
}
