"use client";

import { useState } from "react";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { InlineEditableRow } from "@/shared/ui/inline-editable-row";
import { SelectMenu } from "@/shared/ui/select-menu";
import { toast } from "@/shared/ui/toast";
import { RowAction } from "@/shared/layout/settings-modal/sections/settings-panel";
import { DeviceGlyph } from "@/features/devices/components/device-glyph";
import { deviceMeta, glassesToDevice } from "@/features/devices/merge";
import {
  revokeDevice,
  rotateHeyEvenKey,
  updateDevice,
  type GlassesDevice,
  type HeyEvenKey,
} from "./glasses-api";
import { HeyEvenKeyDialog } from "./hey-even-key-dialog";
import {
  NO_CHANNEL,
  useGlassesChannelOptions,
  useInvalidateGlassesDevices,
} from "./use-glasses";

/** Mirrors `glasses/devices-service.ts › DEVICE_NAME_MAX` (a server module the SPA cannot import). */
const DEVICE_NAME_MAX = 64;

export function GlassesDeviceRow({ device }: { device: GlassesDevice }) {
  const invalidate = useInvalidateGlassesDevices();
  const channelOptions = useGlassesChannelOptions(device.linked_channel);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"revoke" | "rotate" | null>(null);
  const [secret, setSecret] = useState<HeyEvenKey | null>(null);

  async function patch(body: Parameters<typeof updateDevice>[1], failure: string) {
    setBusy(true);
    try {
      await updateDevice(device.id, body);
      await invalidate();
    } catch (err) {
      toast({ title: userFacingMessage(err, failure) });
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    try {
      await revokeDevice(device.id);
      toast({ title: "Glasses removed" });
      await invalidate();
    } catch (err) {
      toast({ title: userFacingMessage(err, "Couldn't remove") });
      throw err;
    }
  }

  async function rotate() {
    try {
      setSecret(await rotateHeyEvenKey(device.id));
      await invalidate();
    } catch (err) {
      toast({ title: userFacingMessage(err, "Couldn't create a key") });
      throw err;
    }
  }

  const meta = deviceMeta(glassesToDevice(device), formatRelativeTime(device.last_seen));

  return (
    <li className="flex min-w-0 items-center gap-3 py-2.5">
      <DeviceGlyph kind="glasses" />
      <div className="min-w-0 flex-1">
        {renaming ? (
          <InlineEditableRow
            value={device.name}
            maxLength={DEVICE_NAME_MAX}
            ariaLabel="Glasses name"
            onCommit={async (name) => {
              await patch({ name }, "Couldn't rename");
              setRenaming(false);
            }}
            onExit={() => setRenaming(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            title="Rename"
            className="block max-w-full truncate text-left text-body font-medium text-text-primary"
          >
            {device.name}
          </button>
        )}
        <p className="mt-0.5 truncate text-caption text-text-muted">{meta}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <SelectMenu
          variant="text"
          value={device.linked_channel?.id ?? NO_CHANNEL}
          options={channelOptions}
          onChange={(next) =>
            void patch(
              { channel_id: next === NO_CHANNEL ? null : next },
              "Couldn't change the channel"
            ).catch(() => {})
          }
          ariaLabel={`Channel for ${device.name}`}
          disabled={busy}
          menuClassName="max-h-[320px] overflow-y-auto"
        />
        <RowAction
          disabled={busy}
          onClick={() =>
            device.has_hey_even_key ? setConfirm("rotate") : void rotate().catch(() => {})
          }
        >
          Hey Even
        </RowAction>
        <RowAction danger disabled={busy} onClick={() => setConfirm("revoke")}>
          Remove
        </RowAction>
      </div>
      <ConfirmDialog
        open={confirm === "revoke"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Remove ${device.name}?`}
        confirmLabel="Remove"
        destructive
        onConfirm={revoke}
      />
      <ConfirmDialog
        open={confirm === "rotate"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Replace the Hey Even key?"
        confirmLabel="Replace"
        destructive
        onConfirm={rotate}
      />
      <HeyEvenKeyDialog secret={secret} onClose={() => setSecret(null)} />
    </li>
  );
}
