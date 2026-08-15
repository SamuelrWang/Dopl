"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { Popover } from "@/shared/ui/popover-menu";

export interface PickMenuItem {
  id: string;
  name: string;
  /** Items are grouped under click-to-expand section rows. */
  group: string;
}

interface Props {
  items: PickMenuItem[];
  onPick: (id: string) => void;
  /** Already-selected ids — hidden from the menu. */
  excludeIds?: string[];
  trigger: ReactNode;
  triggerClassName?: string;
}

/** Click-driven picker: trigger opens a menu of groups, group expands its
 *  items, item picks. ⚠ No hover-expansion — every level opens on click. */
export function PickMenu({
  items,
  onPick,
  excludeIds = [],
  trigger,
  triggerClassName,
}: Props) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const excluded = new Set(excludeIds);
  const visible = items.filter((i) => !excluded.has(i.id));
  const groups = [...new Set(visible.map((i) => i.group))];

  const close = () => {
    setAnchor(null);
    setOpenGroup(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor((prev) => (prev ? null : { x: rect.left, y: rect.bottom + 4 }));
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={close}
        className="max-h-64 w-56 overflow-y-auto"
      >
        {groups.length === 0 && (
          <p className="px-2 py-1.5 text-small text-text-muted">
            Nothing available to add
          </p>
        )}
        {groups.map((group) => {
          const open = group === openGroup;
          const groupItems = visible.filter((i) => i.group === group);
          return (
            <div key={group}>
              <button
                type="button"
                onClick={() => setOpenGroup(open ? null : group)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-small font-semibold transition-colors",
                  open
                    ? "text-text-primary"
                    : "text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary"
                )}
              >
                <ChevronRight
                  size={11}
                  className={cn(
                    "shrink-0 text-text-muted transition-transform",
                    open && "rotate-90"
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{group}</span>
                <span className="text-micro font-normal text-text-muted">
                  {groupItems.length}
                </span>
              </button>
              {open &&
                groupItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onPick(item.id);
                      close();
                    }}
                    className="flex w-full items-center rounded-lg py-1.5 pr-2 pl-6 text-left text-body text-text-secondary transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
                  >
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  </button>
                ))}
            </div>
          );
        })}
      </Popover>
    </>
  );
}
