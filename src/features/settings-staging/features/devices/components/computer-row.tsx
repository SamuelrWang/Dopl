// STAGING COPY of src/features/devices/components/computer-row.tsx (tree of 2026-10-22). Only import paths differ from the source (data hooks and
// desktop libs → src/features/settings-staging/stubs). See src/features/settings-staging/PORTING.md.
"use client";

import { apiRequest } from "@/features/settings-staging/stubs/api";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { toast } from "@/shared/ui/toast";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { RowAction, SettingsRow } from "@/shared/layout/settings-modal/sections/settings-panel";
import { useConfirmedAction } from "@/shared/layout/settings-modal/sections/use-confirmed-action";
import { deviceMeta } from "@/features/devices/merge";
import { DEVICES_PATH, type ConnectedDevice } from "@/features/devices/types";
import { DeviceGlyph } from "@/features/devices/components/device-glyph";
import { DeviceNameTitle } from "@/features/devices/components/device-name-title";
import { useInvalidateComputers } from "@/features/settings-staging/stubs/use-devices";

/** `schema.ts › RenameComputerSchema`: up to 64 chars; "" clears the rename. */
const COMPUTER_NAME_MAX = 64;

const devicePath = (id: string) => `${DEVICES_PATH}/${encodeURIComponent(id)}`;

/**
 * One computer. Its name renames in place (clearing restores the name the computer reported).
 * Remove signs that computer out of Dopl: every credential it minted is revoked, its sign-in is
 * ended server-side, and the app signs itself out on its next heartbeat.
 */
export function ComputerRow({ device }: { device: ConnectedDevice }) {
  const invalidate = useInvalidateComputers();
  const remove = useConfirmedAction({
    run: () => apiRequest<unknown>(devicePath(device.id), { method: "DELETE" }),
    success: "Computer removed",
    failure: "Couldn't remove",
    after: invalidate,
  });

  async function rename(name: string) {
    try {
      await apiRequest<unknown>(devicePath(device.id), {
        method: "PATCH",
        body: { name: name || null },
      });
      await invalidate();
    } catch (err) {
      toast({ title: userFacingMessage(err, "Couldn't rename") });
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
    <SettingsRow
      leading={<DeviceGlyph kind="computer" />}
      title={
        // A legacy computer is a bare device token with no row to rename.
        device.legacy ? (
          device.name
        ) : (
          <DeviceNameTitle
            name={device.name}
            ariaLabel="Computer name"
            maxLength={COMPUTER_NAME_MAX}
            detectedName={device.detectedName ?? device.name}
            onRename={rename}
          />
        )
      }
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
