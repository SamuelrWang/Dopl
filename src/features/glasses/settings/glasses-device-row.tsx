"use client";

import { useState } from "react";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { InlineEditableRow } from "@/shared/ui/inline-editable-row";
import { SelectMenu } from "@/shared/ui/select-menu";
import { toast } from "@/shared/ui/toast";
import { PresenceDot } from "@/features/members/components/members-v2/bits";
import {
  revokeDevice,
  rotateHeyEvenKey,
  updateDevice,
  type GlassesDevice,
  type HeyEvenKey,
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

/** `connected-apps-section.tsx`'s text action. */
const ROW_ACTION =
  "shrink-0 text-caption text-text-secondary transition-colors disabled:opacity-50";

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
      toast({ title: "Glasses revoked" });
      await invalidate();
    } catch (err) {
      toast({ title: userFacingMessage(err, "Couldn't revoke") });
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

  const lastSeen = device.online ? "Online" : formatRelativeTime(device.last_seen);
  const info = platformInfo(device.platform);
  const assistant = info?.assistant;

  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border-default bg-bg-elevated px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <PresenceDot dot={device.online ? "active" : "idle"} />
        {renaming ? (
          <InlineEditableRow
            className="flex-1"
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
            className="min-w-0 flex-1 truncate text-left text-body text-text-primary"
          >
            {device.name}
          </button>
        )}
        {assistant && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              device.has_hey_even_key ? setConfirm("rotate") : void rotate().catch(() => {})
            }
            className={`${ROW_ACTION} hover:text-text-primary`}
          >
            {assistant.name}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirm("revoke")}
          className={`${ROW_ACTION} hover:text-danger`}
        >
          Revoke
        </button>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-micro font-mono text-text-muted">
          {info?.label ?? device.platform} · {lastSeen}
        </p>
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
      </div>
      <ConfirmDialog
        open={confirm === "revoke"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Revoke ${device.name}?`}
        confirmLabel="Revoke"
        destructive
        onConfirm={revoke}
      />
      {assistant && (
        <>
          <ConfirmDialog
            open={confirm === "rotate"}
            onOpenChange={(open) => !open && setConfirm(null)}
            title={`Replace the ${assistant.name} key?`}
            confirmLabel="Replace"
            destructive
            onConfirm={rotate}
          />
          <AssistantKeyDialog assistant={assistant} secret={secret} onClose={() => setSecret(null)} />
        </>
      )}
    </li>
  );
}
