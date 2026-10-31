import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { PILL_ICON, pillButton } from "@/shared/ui/pill-button";

/** The portal's create button: the kit's `CreateButton` face without its lift. */
export function CreateButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cn(pillButton("ink", "lg", { raise: false }), "disabled:opacity-60")} onClick={onClick}>
      <Plus size={PILL_ICON.lg} aria-hidden="true" />
      {children}
    </button>
  );
}
