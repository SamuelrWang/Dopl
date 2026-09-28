"use client";

import { apiRequest } from "@/shared/api/api-client";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { RowAction, SettingsRow } from "@/shared/layout/settings-modal/sections/settings-panel";
import { useConfirmedAction } from "@/shared/layout/settings-modal/sections/use-confirmed-action";
import { deviceMeta } from "../merge";
import { DEVICES_PATH, type ConnectedDevice } from "../types";
import { DeviceGlyph } from "./device-glyph";
import { useInvalidateComputers } from "./use-devices";

/**
 * One computer. Remove signs that computer out of Dopl: every credential it minted is revoked, its
 * sign-in is ended server-side, and the app signs itself out on its next heartbeat.
 */
export function ComputerRow({ device }: { device: ConnectedDevice }) {
  const invalidate = useInvalidateComputers();
  const remove = useConfirmedAction({
    run: () =>
      apiRequest<unknown>(`${DEVICES_PATH}/${encodeURIComponent(device.id)}`, { method: "DELETE" }),
    success: "Computer removed",
    failure: "Couldn't remove",
    after: invalidate,
  });

  const meta = [
    deviceMeta(device, formatRelativeTime(device.lastSeen)),
    device.appVersion ? `Dopl ${device.appVersion}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <SettingsRow
      leading={<DeviceGlyph kind="computer" />}
      title={device.name}
      badge={device.current ? "This computer" : undefined}
      meta={meta}
    >
      <RowAction danger onClick={remove.ask}>
        Remove
      </RowAction>
      <ConfirmDialog
        {...remove.dialog}
        title={`Remove ${device.name}?`}
        description={device.current ? "This signs you out of Dopl on this computer." : undefined}
        confirmLabel="Remove"
        destructive
      />
    </SettingsRow>
  );
}
