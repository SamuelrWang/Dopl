"use client";

import { useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import type { NotifyScope } from "../types";

/** The three per-channel notification choices, shown in the bell popover. */
const NOTIFY_OPTIONS: Array<{
  scope: NotifyScope;
  label: string;
  description: string;
}> = [
  {
    scope: "all",
    label: "All activity",
    description: "Requests to you prompt; other activity notifies quietly.",
  },
  {
    scope: "addressed",
    label: "Addressed to me only",
    description: "Notify only when a request names you.",
  },
  {
    scope: "none",
    label: "Muted",
    description: "No notifications from this channel.",
  },
];

/**
 * The channel header's notification control: a bell that opens the three
 * per-member scopes. Extracted from `channel-pane` so the header's own file
 * stays under the §2 cap while the multiplayer surfaces land beside it; the
 * markup and copy are unchanged.
 */
export function NotifyScopeButton({
  notifyScope,
  onSetNotifyScope,
}: {
  notifyScope: NotifyScope;
  onSetNotifyScope: (scope: NotifyScope) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notification settings"
        title="Notification settings"
        className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
      >
        {notifyScope === "none" ? <BellOff size={16} /> : <Bell size={16} />}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="min-w-[248px]"
      >
        {NOTIFY_OPTIONS.map((option) => (
          <MenuItem
            key={option.scope}
            showCheck
            active={notifyScope === option.scope}
            description={option.description}
            onSelect={() => {
              setOpen(false);
              if (option.scope !== notifyScope) onSetNotifyScope(option.scope);
            }}
          >
            {option.label}
          </MenuItem>
        ))}
      </Popover>
    </div>
  );
}
