import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  PAGE_ACTION_BTN,
  PAGE_ACTION_ICON,
} from "@/shared/ui/page-action-button";

/** /home's page action button, declared in `@/shared/ui/page-action-button` (the landing demo
 *  renders /home's chrome and cannot import `apps/`). Do not re-declare the face here. */
export { PAGE_ACTION_BTN, PAGE_ACTION_ICON };

/** The section-header create button (every /home `SectionPanel`/`IdentityPanel` `action`): the
 *  page's black pill plus a glyph; card controls stay on the small pill. */
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
