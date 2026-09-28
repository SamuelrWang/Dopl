"use client";

import { useState } from "react";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { InlineEditableRow } from "@/shared/ui/inline-editable-row";
import { SelectMenu } from "@/shared/ui/select-menu";
import { toast } from "@/shared/ui/toast";
import { RowAction, SettingsRow } from "@/shared/layout/settings-modal/sections/settings-panel";
import { useConfirmedAction } from "@/shared/layout/settings-modal/sections/use-confirmed-action";
import { DeviceGlyph } from "@/features/devices/components/device-glyph";
import { deviceMeta, glassesToDevice } from "@/features/devices/merge";
import {
  revokeDevice,
  rotateAssistantKey,
  updateDevice,
  type GlassesDevice,
  type AssistantKey,
} from "./glasses-api";
import { platformInfo } from "../platforms/info";
import { AssistantKeyDialog } from "./assistant-key-dialog";
import {
  NO_CHANNEL,
  useGlassesChannelOptions,
  useInvalidateGlassesDevices,
} from "./use-glasses";

/** Mirrors `core/devices/service.ts › DEVICE_NAME_MAX` (a server module the SPA cannot import). */
const DEVICE_NAME_MAX = 64;

export function GlassesDeviceRow({ device }: { device: GlassesDevice }) {
  const invalidate = useInvalidateGlassesDevices();
  const channelOptions = useGlassesChannelOptions(device.linked_channel);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<AssistantKey | null>(null);
  const remove = useConfirmedAction({
    run: () => revokeDevice(device.id),
    success: "Glasses removed",
    failure: "Couldn't remove",
    after: invalidate,
  });
  const rotate = useConfirmedAction({
    run: async () => setSecret(await rotateAssistantKey(device.id)),
    failure: "Couldn't create a key",
    after: invalidate,
  });

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

  const assistant = platformInfo(device.platform)?.assistant;

  return (
    <SettingsRow
      leading={<DeviceGlyph kind="glasses" />}
      title={
        renaming ? (
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
            className="block max-w-full truncate text-left"
          >
            {device.name}
          </button>
        )
      }
      meta={deviceMeta(glassesToDevice(device), formatRelativeTime(device.last_seen))}
    >
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
      {assistant && (
        <RowAction
          disabled={busy}
          onClick={() =>
            device.has_hey_even_key ? rotate.ask() : void rotate.dialog.onConfirm().catch(() => {})
          }
        >
          {assistant.name}
        </RowAction>
      )}
      <RowAction danger disabled={busy} onClick={remove.ask}>
        Remove
      </RowAction>
      <ConfirmDialog
        {...remove.dialog}
        title={`Remove ${device.name}?`}
        confirmLabel="Remove"
        destructive
      />
      {assistant && (
        <>
          <ConfirmDialog
            {...rotate.dialog}
            title={`Replace the ${assistant.name} key?`}
            confirmLabel="Replace"
            destructive
          />
          <AssistantKeyDialog assistant={assistant} secret={secret} onClose={() => setSecret(null)} />
        </>
      )}
    </SettingsRow>
  );
}
