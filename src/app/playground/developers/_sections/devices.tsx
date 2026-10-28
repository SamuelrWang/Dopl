"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { CapabilityDescriptor } from "@dopl/device-contracts";
import { cn } from "@/shared/lib/utils";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import { PILL_ICON, pillButton } from "@/shared/ui/pill-button";
import { IDENTITY_NAME_TEXT, QUIET_HEADING_TEXT } from "@/shared/ui/section-heading";
import { StatusPill } from "@/shared/ui/status-pill";
import type { EnvFixtures } from "../_data/fixtures";
import { AVAILABILITY_LABEL, DEVICE_TYPES, type DeviceType } from "../_data/device-types";
import type { TypeState } from "../_data/device-type-status";
import { usePortal } from "../_components/portal-context";
import { PORTAL_BASE } from "../_components/portal-shell";
import { PageHeader, glyphKind, ov } from "../_components/ui";

export const typeHref = (id: string) => `${PORTAL_BASE}/devices/${id}`;

/** The project's status for a type: is the agent product compatible with it. */
export function TypeStatusPill({ state }: { state: TypeState }) {
  if (state.status === "connected")
    return (
      <StatusPill tone={state.live ? "done" : "live"} dot>
        {state.live ? "Live" : "Connected"}
      </StatusPill>
    );
  if (state.status === "added") return <StatusPill dot>Added</StatusPill>;
  return <StatusPill>Not connected</StatusPill>;
}

/** Unique live end users on this type's adapter. */
export function usersOn(fx: EnvFixtures, type: DeviceType): number {
  return new Set(fx.connections.filter((c) => c.status === "active" && c.device.adapter_id === type.adapter_id).map((c) => c.external_user_id)).size;
}

export function DevicesSection({ descriptors }: { descriptors: Record<string, CapabilityDescriptor[]> }) {
  const groups = [
    { label: "Available", types: DEVICE_TYPES.filter((t) => t.availability !== "coming_soon") },
    { label: "Coming soon", types: DEVICE_TYPES.filter((t) => t.availability === "coming_soon") },
  ];
  return (
    <>
      <PageHeader title="Devices" />
      {groups.map((g) => (
        <section key={g.label} className="flex flex-col gap-2.5" aria-label={g.label}>
          <h2 className={QUIET_HEADING_TEXT}>{g.label}</h2>
          <div className="grid grid-cols-3 gap-3.5">
            {g.types.map((t) => (
              <TypeCard key={t.id} type={t} descriptors={descriptors[t.id] ?? null} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function TypeCard({ type, descriptors }: { type: DeviceType; descriptors: CapabilityDescriptor[] | null }) {
  const router = useRouter();
  const { env, fx, typeState, addDeviceType } = usePortal();
  const soon = type.availability === "coming_soon";
  const state = typeState(type.id, descriptors);
  const users = env === "live" && !soon ? usersOn(fx, type) : 0;
  return (
    <div className={cn("white-card flex min-w-0 flex-col gap-3 p-3.5", soon && "opacity-60")}>
      <div className="flex items-center gap-2.5">
        <span className={ov.mark} data-shape="tile" aria-hidden="true">
          <DeviceKindIcon kind={glyphKind(type.kind)} size={13} strokeWidth={1.8} />
        </span>
        <span className={cn(IDENTITY_NAME_TEXT, "min-w-0 flex-1 truncate")}>{type.name}</span>
        <StatusPill tone={type.availability === "beta" ? "attention" : "neutral"}>{AVAILABILITY_LABEL[type.availability]}</StatusPill>
      </div>
      <span className={ov.rowMeta}>
        {soon ? "—" : [descriptors && `${descriptors.length} capabilities`, users > 0 && `${users} users connected`].filter(Boolean).join(" · ")}
      </span>
      <div className="flex items-center justify-between gap-2">
        {soon ? <span /> : <TypeStatusPill state={state} />}
        {soon ? (
          <button type="button" disabled className={cn(pillButton("outline", "sm"), "disabled:opacity-60")}>
            Add
          </button>
        ) : state.status === "not_connected" ? (
          <button
            type="button"
            className={pillButton("ink", "sm")}
            onClick={() => {
              addDeviceType(type.id, descriptors);
              router.push(typeHref(type.id));
            }}
          >
            <Plus size={PILL_ICON.sm} aria-hidden="true" />
            Add
          </button>
        ) : (
          <Link href={typeHref(type.id)} className={pillButton("outline", "sm")}>
            Open
          </Link>
        )}
      </div>
    </div>
  );
}
