import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import {
  OPEN_SCALE_ICON,
  OpenScaleButton,
} from "@/shared/ui/open-scale-button";

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
 * ⚠ THE FACE IS NOT LOCAL. Both copies carried a hand-written `h-6 …` recipe;
 * Samuel's ruling put every /home button of this scale on the KB card Open
 * button's face, which is `shared/ui/open-scale-button.tsx`. Nothing about the
 * pill is restated here — this component adds the glyph and the label, and
 * nothing else.
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
    <OpenScaleButton
      className="disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
    >
      <Plus size={OPEN_SCALE_ICON} aria-hidden="true" />
      {children}
    </OpenScaleButton>
  );
}
