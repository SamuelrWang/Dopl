/**
 * STAGING COPY of `apps/desktop-ui/src/pages/home/panel-buttons.tsx › CreateButton`. Verbatim.
 */
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  PAGE_ACTION_BTN,
  PAGE_ACTION_ICON,
} from "@/shared/ui/page-action-button";

export { PAGE_ACTION_BTN, PAGE_ACTION_ICON };

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
