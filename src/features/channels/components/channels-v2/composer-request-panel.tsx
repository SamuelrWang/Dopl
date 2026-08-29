"use client";

/**
 * THE COMPOSER'S NEW-THREAD PANEL — split out of `composer.tsx` on 2026-08-22 at
 * the 500-line cap, when the template chevron landed beside the Bot icon.
 *
 * ⚠ THE SEAM IS §1's "one file, one reason to change", not the line count that
 * forced the question. `composer.tsx` is about SENDING — a draft, a mention
 * picker, a bridge spawn. This is one recessed FORM that raises a REQUEST at
 * other members over the write layer, and it moves when the request's shape
 * moves. Two rates of change in one file is how a form ends up re-reviewed every
 * time a glyph is added to the icon row.
 *
 * ⚠ N PILLS = N ADDRESSEES, AND ZERO PILLS IS NOT SENDABLE. "Broadcast" is not a
 * shape this product has (INVARIANTS §5); the empty state says so out loud
 * rather than leaving a Send that quietly reaches nobody. The CONTRACT is
 * `schema.ts › TaskFanOutSchema`, where an empty addressee list is a 400.
 *
 * ⚠ THE BODY'S CONCAVE FACE IS CORRECT AND DELIBERATE, and it is NOT the
 * agent-templates page's ruling (`features/agent-templates/`, where nothing is
 * pressed in). This panel is recessed INTO the composer card on purpose: the
 * body is the kit's concave section face and the pills are the raised `CHIP`
 * that face is written to carry.
 *
 * ⚠ THE TITLE IS RAISED, NOT A SECOND WELL (Samuel, 2026-08-26). It was the
 * concave `FIELD_WELL` — a deeper well inside the first — and is now `CHIP`'s
 * rectangular counterpart, `RAISED_WELL`, carrying a bare `Title:` and the
 * `UNDERLINE_FIELD` idiom. **The label is the whole placeholder**: a hint
 * repeating the word beside it is the explainer the minimal-copy ruling deletes.
 *
 * ⚠ THE DESCRIPTION CAME INSIDE THE PANEL ON 2026-08-26 (Samuel: *"the user
 * will solely need to edit the new thread panel"*). It was the COMPOSER's chat
 * textarea wearing a "Describe the request" placeholder — one field serving two
 * acts, where the box below the panel silently changed meaning while it was
 * open. Both halves of a request are now in the one card that raises it, and
 * `composer.tsx` hides the chat draft outright while this is showing.
 *
 * ⚠ IT IS A TEXTAREA WHERE THE TITLE IS AN INPUT, AND THAT IS THE ONLY
 * DIFFERENCE BETWEEN THEM — same raised card, same label, same underline. It
 * replaces a three-line auto-growing textarea, so a request that needs a
 * paragraph must not lose its line breaks to a one-line field. ⚠ ENTER
 * THEREFORE BREAKS THE LINE AND DOES NOT SUBMIT: `Create` is the only thing
 * that raises the thread, and a body field whose Enter posts is the trap the
 * composer's own Shift+Enter rule exists to avoid.
 *
 * ⚠ `data-composer-panel` IS A STYLING HOOK, NOT STATE. /home repaints this body with the
 * account palette (`pages/home/home.module.css`, the same fence `[data-attribution-pill]` uses);
 * the workspace channels page keeps the neutral fill. Attribute rather than a class name so the
 * override cannot be broken by a utility being swapped here.
 * ⚠ IT IS SHARED WITH `composer-launch-panel.tsx` AND WAS RENAMED FOR IT (2026-08-27, from
 * `data-new-thread-panel`). Both panels are the same object at two contents, so one attribute
 * and one CSS rule — a sibling selector per panel is two statements of one repaint, and the one
 * that gets forgotten is whichever panel the author did not open.
 */

import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { RAISED_WELL } from "@/shared/ui/wells";
import { cn } from "@/shared/lib/utils";
import { AgentTargetPill, IconButton } from "./bits";
import { useAutoGrow } from "./use-auto-grow";

/**
 * The raised card a field sits on — PADDING AND ELEVATION ONLY.
 *
 * ⚠ THE UNDERLINE IS NOT ON THIS ELEMENT, AND THAT IS THE 2026-08-27 CORRECTION. It was
 * `border-b-*` on the card, composed over `RAISED_WELL`'s own all-sides border — which rendered
 * NOTHING VISIBLE in the app: a 1px bottom edge on a `rounded-lg` raised face, sitting on the
 * card's own border colour, is swallowed by the radius and the elevation. **jsdom cannot show
 * that**, so the class-name assertion that "pinned" it passed over a line nobody could see.
 * The line is now its own NODE inside the padded content box ({@link FIELD_LINE}), where no
 * parent radius or overflow can reach it.
 */
export const FIELD_CARD = "flex px-3 py-2.5";

/**
 * THE UNDERLINE, AS A REAL ELEMENT — the row that holds the label and the value, with the line
 * on its own bottom edge.
 *
 * ⚠ IT SPANS LABEL **AND** VALUE, which is the whole point: the line runs the full width of the
 * card's content box, so `Name:` sits on it rather than over nothing.
 * ⚠ GRAY AT REST, INK ON FOCUS, and `focus-within` is what makes that work from here — the focus
 * lands on the `<input>` one level down, so `focus:` would never fire.
 * ⚠ `pb-1` IS THE GAP BETWEEN TEXT AND LINE and belongs to this element, not to the card: the
 * card's `py-2.5` is the breathing room OUTSIDE the line, and folding the two together is what
 * makes a field look vertically off by a pixel in one panel and not the other.
 * ⚠ TAGGED `data-field-line` SO A TEST CAN ASSERT THE NODE EXISTS, not merely that a class string
 * appears somewhere — the failure this replaces was exactly a class that was present and invisible.
 */
export const FIELD_ROW = "flex w-full min-w-0 items-start gap-2";

/** The line itself — composed onto {@link FIELD_ROW} for a TEXT field only. */
export const FIELD_LINE =
  "border-b border-border-strong pb-1 transition-colors focus-within:border-text-primary";

/**
 * The value control inside a {@link PanelField} — `UNDERLINE_FIELD` with the underline taken OFF.
 *
 * ⚠ THE LINE BELONGS TO {@link FIELD_LINE}, one level up, so the two cannot draw two lines.
 * `wells.ts › UNDERLINE_FIELD` is UNCHANGED and still carries its own border for its other callers
 * (`info-card-rows.tsx`, `agent-rename.tsx`), where there is no card under the field.
 */
export const FIELD_INPUT =
  "min-w-0 border-0 bg-transparent p-0 text-body text-text-primary outline-none " +
  "placeholder:text-text-disabled";

/**
 * ONE FIELD ROW, so the two panels cannot draw it two ways.
 *
 * ⚠ A COMPONENT RATHER THAN A CLASS PAIR (2026-08-27). The card/line/label nesting is now
 * STRUCTURE, and structure restated at six call sites is how five of them stay right and one
 * drifts. `as="label"` for a text field (the word becomes the field's hit area); `as="div"` for a
 * row whose control is a button, where a wrapping `<label>` would make the word toggle the menu.
 */
export function PanelField({
  label,
  as = "label",
  center = false,
  line = true,
  children,
}: {
  label: string;
  as?: "label" | "div";
  /** Centre the control against the label — the select rows, whose trigger is one line tall. */
  center?: boolean;
  /**
   * Draw the underline. ⚠ TRUE FOR TEXT ENTRY, FALSE FOR A DROPDOWN (Samuel, 2026-08-27).
   * The line is the app's EDIT affordance — it says "type here" — and a select already states
   * that it is a control by being one. Ruling a line under a menu trigger reads as a text field
   * that will not accept text.
   */
  line?: boolean;
  children: ReactNode;
}) {
  const Card = as;
  return (
    <Card className={cn(RAISED_WELL, FIELD_CARD)}>
      {/* ⚠ `data-field-line` IS SET ONLY WHERE THE LINE IS, so its presence and its ABSENCE are
          both assertable — a dropdown row that grew one would fail as loudly as a text field
          that lost one. The row element itself stays either way; it is the flex container. */}
      <span
        {...(line ? { "data-field-line": "" } : {})}
        className={cn(FIELD_ROW, line && FIELD_LINE, center && "items-center")}
      >
        <span className={FIELD_LABEL}>{label}</span>
        {children}
      </span>
    </Card>
  );
}

export const PANEL_BODY =
  "flex min-h-0 flex-col gap-2 overflow-y-auto max-h-[264px]";

/**
 * The label word. ⚠ AUTO-WIDTH — no column (Samuel, 2026-08-27, from the rendered app).
 *
 * It was `w-[84px]`, sized to the longest label either panel uses, on the idea that a fixed column
 * lines every value up. In practice it put a wide dead gap after every SHORT label —
 * `Name:` ......... `Agent #fc1j22ed` — and it could not deliver the alignment it cost, because
 * the two panels carry different label sets (Title/Description against
 * Name/Description/Template/Model), so a column that lines one of them up is arbitrary in the
 * other. **The value now starts right after the word**, one `gap-2` along, and the two panels read
 * the same way because the RULE is the same rather than because a number happens to match.
 */
export const FIELD_LABEL = "shrink-0 pt-px text-body text-text-secondary";

/** The /home repaint hook, as props. ⚠ ONE DECLARATION for both panels — see the header. */
export const PANEL_HOOK = { "data-composer-panel": "" } as const;

export function AgentRequestPanel({
  targets,
  removed,
  title,
  description,
  onTitleChange,
  onDescriptionChange,
  onRemove,
  onDismiss,
}: {
  targets: Array<{ id: string; label: string }>;
  removed: ReadonlySet<string>;
  title: string;
  description: string;
  onTitleChange: (next: string) => void;
  onDescriptionChange: (next: string) => void;
  onRemove: (id: string) => void;
  onDismiss: () => void;
}) {
  const addressed = targets.filter((target) => !removed.has(target.id));
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(descriptionRef, description);

  return (
    <div
      {...PANEL_HOOK}
      className={cn(
        SECTION_BOX_INSET,
        "flex min-h-0 flex-col gap-2 rounded-[10px] p-2.5",
      )}
    >
      <div className="flex items-center gap-2">
        {/* ⚠ NOT `text-label` (Samuel, 2026-08-24). That ramp step is the
            app's UPPERCASE section label and carries `uppercase tracking-wide
            font-semibold` as part of its contract; this header reads as
            sentence case at normal weight, which is `text-caption` — the step
            written for exactly that. Dropping the three classes while keeping
            `text-label` would have left a lie in the class list. */}
        <span className="text-caption text-text-secondary">New thread</span>
        <span className="flex-1" />
        <IconButton
          icon={X}
          label="Close new thread"
          size={13}
          className="h-5 w-5"
          onClick={onDismiss}
        />
      </div>

      <div className={PANEL_BODY}>
        {addressed.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {addressed.map((target) => (
              <AgentTargetPill
                key={target.id}
                label={target.label}
                onRemove={() => onRemove(target.id)}
              />
            ))}
          </div>
        ) : (
          // Fail-closed, said out loud: with nobody addressed there is no
          // thread. "Everyone" is not a shape this product has (INVARIANTS §5).
          <p className="py-1 text-caption text-text-muted">
            No agent addressed — this thread reaches nobody.
          </p>
        )}

        {/* ⚠ `<label>`s, so each word is its own field's hit area. The
          `aria-label` still wins the accessible name — "Thread title" /
          "Thread description" are what `composer.test.tsx` addresses these
          controls by, and they say WHICH title and description to a reader who
          cannot see the panel they sit in. */}
        <PanelField label="Title:">
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            spellCheck={false}
            aria-label="Thread title"
            className={cn(FIELD_INPUT, "flex-1")}
          />
        </PanelField>

        <PanelField label="Description:">
          {/* ⚠ ONE LINE AT REST, GROWING TO THREE (Samuel, 2026-08-27). It was `rows={3}` — a
            three-line box holding one line of text, which made the panel tall before anything
            was typed. `use-auto-grow.ts` is the composer's own mechanism, extracted. */}
          <textarea
            ref={descriptionRef}
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={1}
            spellCheck={false}
            aria-label="Thread description"
            className={cn(FIELD_INPUT, "flex-1 resize-none")}
          />
        </PanelField>
      </div>
    </div>
  );
}
