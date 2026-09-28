"use client";

import { useState } from "react";
import { apiRequest } from "@/shared/api/api-client";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { toast } from "@/shared/ui/toast";
import { RowAction } from "@/shared/layout/settings-modal/sections/settings-panel";
import { deviceMeta } from "../merge";
import { DEVICES_PATH, type ConnectedDevice } from "../types";
import { DeviceGlyph } from "./device-glyph";
import { useInvalidateComputers } from "./use-devices";

/**
 * One computer. Remove signs that computer out of Dopl: every credential it minted is revoked,
 * its agents' container sessions included, and the app signs itself out on its next heartbeat.
 */
export function ComputerRow({ device }: { device: ConnectedDevice }) {
  const invalidate = useInvalidateComputers();
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    try {
      await apiRequest<unknown>(`${DEVICES_PATH}/${encodeURIComponent(device.id)}`, {
        method: "DELETE",
      });
      toast({ title: "Computer removed" });
      await invalidate();
    } catch (err) {
      toast({ title: userFacingMessage(err, "Couldn't remove") });
      throw err;
    }
  }

  const meta = [
    deviceMeta(device, formatRelativeTime(device.lastSeen)),
    device.appVersion ? `Dopl ${device.appVersion}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex min-w-0 items-center gap-3 py-2.5">
      <DeviceGlyph kind="computer" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body font-medium text-text-primary">{device.name}</span>
          {device.current && (
            <span className="shrink-0 rounded-full border border-border-strong px-2 py-px text-micro font-medium text-text-secondary">
              This computer
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-caption text-text-muted">{meta}</p>
      </div>
      <RowAction danger onClick={() => setConfirming(true)}>
        Remove
      </RowAction>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove ${device.name}?`}
        description={device.current ? "This signs you out of Dopl on this computer." : undefined}
        confirmLabel="Remove"
        destructive
        onConfirm={remove}
      />
    </li>
  );
}
