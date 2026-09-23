import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  PAGE_ACTION_BTN,
  PAGE_ACTION_ICON,
} from "@/shared/ui/page-action-button";

/**
 * /home's PAGE ACTION BUTTON — **re-exported from
 * `@/shared/ui/page-action-button`, which is where the black 36px pill is
 * declared since 2026-09-17.**
 *
 * ⚠ **THE MOVE IS ABOUT A SECOND TREE, NOT ABOUT THIS PAGE.** The landing page's
 * hero demo renders /home's own chrome
 * (`src/features/marketing/components/banner-demo/`) and the Next tree cannot
 * import `apps/` at all. apps → root `src/` is the direction that works, so the
 * ONE declaration moved there and this module stays the path every /home reader
 * already imports. **The class list is byte-identical to what it was.**
 *
 * ⚠ **DO NOT RE-DECLARE THE FACE HERE.** A second spelling of the page action is
 * exactly the defect the original extraction (2026-09-09) was written to fix.
 */
export { PAGE_ACTION_BTN, PAGE_ACTION_ICON };

/**
 * /home's SECTION-HEADER CREATE BUTTON — the `action` slot of every
 * `SectionPanel`/`IdentityPanel` on this page.
 *
 * ⚠ IT WAS DECLARED TWICE, BYTE-IDENTICALLY (2026-08-28) — once in
 * `knowledge-panels.tsx` and once in `identity-panels.tsx`, each with the same
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
