"use client";

/**
 * **THE DEVICE PILL — which device a person's message came from** (Samuel, 2026-09-28: *"below the
 * message with a black pill, what device the message was sent from"*). `agent-bits.tsx ›
 * AgentPill`'s black face, by import, with the kind's glyph from the Devices panel
 * (`devices/components/device-glyph.tsx › DeviceKindIcon`).
 *
 * ⚠ **THE LIVE NAME OUTRANKS THE SNAPSHOT.** `metadata.source.label` is the name at write time; when
 * `device_id` resolves among the viewer's own devices the current name is shown, so a rename in
 * Settings re-faces history. Anyone else's device — or a removed one — keeps its snapshot.
 */

import { useDeviceName } from "@/features/devices/components/use-devices";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import type { MessageSource } from "../lib/message-device";
import { AgentPill } from "./agent-bits";

export function DevicePill({ source }: { source: MessageSource }) {
  const liveName = useDeviceName(source.kind, source.deviceId);
  return (
    <AgentPill className="inline-flex max-w-[16rem] items-center gap-1">
      <DeviceKindIcon kind={source.kind} size={11} strokeWidth={2} className="shrink-0" />
      <span className="truncate">{liveName ?? source.label}</span>
    </AgentPill>
  );
}
