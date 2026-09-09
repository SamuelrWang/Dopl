import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * /home's PAGE ACTION BUTTON — the black 36px pill (`docs/DESIGN-SYSTEM.md`:
 * `h-9` + `auth-btn-3d`), as ONE string.
 *
 * ⚠ IT IS THE "New channel" BUTTON'S OWN CLASS LIST, extracted rather than
 * copied (`index.tsx` renders this constant, so the two cannot drift). It was
 * spelled out verbatim at three call sites in this tree before 2026-09-09; a
 * class string repeated by hand is a restyle that lands on whichever file the
 * next reader opened.
 *
 * ⚠ `text-text-on-cta`, NOT `text-white`. Same pixels (`--text-on-cta` is
 * `#ffffff`), but the design system's rule is that ink comes from a token
 * utility — a literal colour utility here is what a page-level restyle cannot
 * follow.
 *
 * ⚠ FACE AND SCALE ONLY. Behavioural states and inline spacing stay with the
 * caller through `cn` — the same division `open-scale-button.tsx` holds.
 */
export const PAGE_ACTION_BTN =
  "auth-btn-3d flex h-9 cursor-pointer items-center rounded-full px-[15px] text-small font-semibold text-text-on-cta";

/** Glyph size inside {@link PAGE_ACTION_BTN}. ONE number: two icons at two
 *  sizes in the same pill is the drift in miniature. */
export const PAGE_ACTION_ICON = 13;

/**
 * /home's SECTION-HEADER CREATE BUTTON — the `action` slot of every
 * `SectionPanel`/`TemplatePanel` on this page.
 *
 * ⚠ IT WAS DECLARED TWICE, BYTE-IDENTICALLY (2026-08-28) — once in
 * `knowledge-panels.tsx` and once in `agent-panels.tsx`, each with the same
 * docblock calling itself "the two section buttons". Four call sites across two
 * tabs of ONE pane is one component; two copies is a promise that the next
 * restyle lands on whichever file the reader opened.
 *
 * ⚠ **IT IS THE PAGE'S BLACK BUTTON SINCE 2026-09-09 (Samuel: the Knowledge and
 * Agents "+ New" buttons go "from their white to be the same black button as
 * the New thread button … the heights of the button should be the black button
 * height").** It wore `open-scale-button.tsx`'s small white pill — the KB card's
 * Open face, 30px — under the 2026-08-28 ruling that put every small /home
 * button on that face. **That ruling is superseded FOR THESE FOUR BUTTONS ONLY**:
 * the card's Open, and "Share into this channel" beside it on the card, are
 * still the small pill and must stay there (`agent-share.tsx`,
 * `panel-buttons.test.tsx`). What moved is the SECTION HEADER's create, which is
 * a page action and now says so.
 *
 * ⚠ THE FACE IS NOT LOCAL. Nothing about the pill is restated here — this
 * component adds the glyph, the gap and the disabled ink, and nothing else.
 */
export function CreateButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(PAGE_ACTION_BTN, "gap-1.5 disabled:opacity-60")}
      disabled={disabled}
      onClick={onClick}
    >
      <Plus size={PAGE_ACTION_ICON} aria-hidden="true" />
      {children}
    </button>
  );
}
