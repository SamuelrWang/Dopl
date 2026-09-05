import { useState } from "react";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { cn } from "@/shared/lib/utils";
import { useTurnCap } from "./use-turn-cap";

/**
 * THE PER-MACHINE SESSION TURN CAP, as one row in the desktop Account pane
 * (2026-09-05).
 *
 * ⚠ **IT IS HERE BECAUSE IT IS A PROPERTY OF THIS MAC, NOT OF A WORKSPACE.**
 * The SPA's channel Settings tab is channel-scoped and nothing on it is
 * per-machine; this modal is the desktop binding, so a control that configures
 * the machine belongs in it. It arrives through a SLOT for the same reason
 * `AccountActions` does — the shared core is rendered by the web too, and the
 * web has no machine to cap.
 *
 * ⚠ **NO BRIDGE ⇒ NO ROW** (INVARIANTS §5, no dead rows). A main without the
 * ops, or a plain browser, renders nothing at all rather than a disabled input
 * the operator cannot act on.
 *
 * ⚠ **THE THREE STATES ARE SPELLED OUT, because two of them are invisible.**
 * Empty is UNSET and means the issuer-keyed defaults still apply; `0` is
 * UNLIMITED; a positive number is the cap. An operator cannot infer "empty
 * means one number if I launched it and a smaller one if an agent did" from an
 * empty box, so the row says it in words under the input — with the numbers
 * MAIN reported, never any this file carries — and restates the stored posture
 * in a live line. The label carries **applies to new sessions**, because the
 * runtime re-reads this only at launch.
 */
export function TurnCapRow() {
  const { bridge, cap, operatorDefault, agentDefault, busy, update } =
    useTurnCap();
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  // ⚠ THE STORE SEEDS THE BOX, THE BOX NEVER SEEDS THE STORE. `cap` changes on
  // the first read and after every write (main's own value), and the draft
  // follows it — so a refused write visibly snaps back instead of leaving the
  // operator's rejected number sitting in the field looking saved.
  // ⚠ ADJUSTED DURING RENDER, NOT IN AN EFFECT (2026-09-05). An effect paints the previous
  // value for one frame first — and on a REFUSED write that frame shows the operator's
  // rejected number still looking accepted, which is the one thing this seeding exists to
  // prevent. The sentinel is what makes the comparison honest: `null` is a real value here
  // (unset), so "have I seeded yet" cannot be spelled with it.
  const [seededFrom, setSeededFrom] = useState<number | null | "never">("never");
  if (seededFrom !== cap) {
    setSeededFrom(cap);
    setDraft(cap === null ? "" : String(cap));
    setInvalid(false);
  }

  if (!bridge) return null;

  const commit = () => {
    const raw = draft.trim();
    if (raw === "") {
      setInvalid(false);
      if (cap !== null) void update(null);
      return;
    }
    // ⚠ DIGITS ONLY, and the check is on the STRING. `Number("12abc")` is NaN
    // but `parseInt` would answer 12, and a cap the operator did not type is
    // exactly the silent wrong number this control must never store.
    if (!/^\d+$/.test(raw)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const next = Number(raw);
    if (next !== cap) void update(next);
  };

  return (
    <section className="w-full overflow-hidden rounded-[14px] border border-border-strong">
      <div className="flex items-center bg-card-surface-subtle px-4 py-1.5">
        <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
          This machine
        </span>
      </div>
      <div className={cn(SECTION_BOX_INSET, "space-y-3 p-4")}>
        <div className="space-y-1.5">
          <label
            htmlFor="turn-cap"
            className="block text-small font-medium text-text-primary"
          >
            Turn cap — applies to new sessions
          </label>
          <input
            id="turn-cap"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
            placeholder="Default"
            aria-describedby="turn-cap-help"
            aria-invalid={invalid || undefined}
            className="h-8 w-32 rounded-md border border-border-strong bg-bg-inset px-2.5 text-small text-text-primary disabled:opacity-40"
          />
        </div>

        {/* The stored posture in words. ⚠ Read off `cap`, never off `draft` —
            this line describes what the machine WILL DO, not what is typed.
            ⚠ **THE TWO DEFAULTS COME FROM MAIN, NOT FROM A LITERAL HERE.** This
            bundle cannot require `main/session-state.js`, which owns them, and
            `test/turn-cap-issuer.test.mjs` pins each to one statement there;
            spelling those numbers here would be a second statement in a file no
            guard watches, stale the day they move. A build that does not send
            them gets the shorter sentence — naming no number beats naming a
            wrong one. */}
        <p className="text-caption text-text-secondary">
          {cap === null
            ? operatorDefault !== null && agentDefault !== null
              ? `Unset. Sessions you launch stop after ${operatorDefault} turns; agent-issued sessions stop after ${agentDefault}.`
              : "Unset. The built-in per-session defaults apply."
            : cap === 0
              ? "Unlimited. Sessions on this machine have no turn cap."
              : `Every new session on this machine stops after ${cap} turn${cap === 1 ? "" : "s"}.`}
        </p>

        <p id="turn-cap-help" className="text-caption text-text-muted">
          Leave empty for the default. Enter 0 for unlimited, or a number to cap
          every session on this machine. Running sessions keep the cap they
          started with.
        </p>

        {invalid && (
          <p role="alert" className="text-caption text-danger">
            Enter a whole number, or leave it empty for the default.
          </p>
        )}
      </div>
    </section>
  );
}
