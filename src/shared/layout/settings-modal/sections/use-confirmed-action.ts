"use client";

import { useState } from "react";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { toast } from "@/shared/ui/toast";

/**
 * A destructive row action behind a `ConfirmDialog`: confirm → request → toast → refresh. A failure
 * toasts and rethrows so the dialog stays up (its own contract). Spread `dialog` onto the dialog.
 */
export function useConfirmedAction({
  run,
  success,
  failure,
  after,
}: {
  run: () => Promise<unknown>;
  /** Toast on success; none when absent. */
  success?: string;
  failure: string;
  /** Runs after success, e.g. a cache invalidation. */
  after?: () => unknown;
}) {
  const [open, setOpen] = useState(false);
  return {
    ask: () => setOpen(true),
    dialog: {
      open,
      onOpenChange: setOpen,
      onConfirm: async () => {
        try {
          await run();
          if (success) toast({ title: success });
          await after?.();
        } catch (err) {
          toast({ title: userFacingMessage(err, failure) });
          throw err;
        }
      },
    },
  };
}
