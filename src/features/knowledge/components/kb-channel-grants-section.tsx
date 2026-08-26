"use client";

import { useState } from "react";
import { Hash, MessageSquare } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Switch } from "@/shared/ui/switch";
import { pendingRow } from "@/shared/ui/pending";
import { toast } from "@/shared/ui/toast";
import { useChannelMembers } from "@/features/channels/hooks/use-channel-members";
import {
  useChannelGrantSettings,
  useSetChannelGrant,
} from "../client/hooks-channel-grants";
import type {
  ChannelGrantChannelRef,
  ChannelGrantLevelInput,
  ChannelResourceGrant,
} from "../types";

/**
 * Settings → Channels: which CHANNELS this knowledge base is shared into, one
 * row per channel, three states per row.
 *
 * The three states are `None` (no grant row at all — the default and the
 * absence), `Agent only` (the channel's agents may read it; no human in the
 * channel sees it) and `Visible` (everyone in the channel sees it, GUESTS
 * INCLUDED). They are the same three the grant table stores as two levels plus
 * absence, so this control is the table's shape and not a translation of it.
 *
 * 🔒 ✅ `Agent only` REACHES A `visibility='private'` BASE AGAIN, SO THE
 * SENTENCE ABOVE IS TRUE OF EVERY BASE (F-336 resolved 2026-08-27, Samuel's
 * ruling). ⚠ IT WAS FALSE FOR A DAY AND THIS PARAGRAPH IS KEPT AS THE RECORD:
 * `knowledge/server/service-shared.ts › canSeeBase` answered false for every
 * non-public base under a container-locked credential, and `getBaseById`
 * applies it BEFORE the audience ceiling, so the grant row was never consulted
 * and the agent 404'd whatever this control said. The fix was NOT to widen the
 * lock — it was to stop reading a WORKSPACE fence as a VISIBILITY one: the gate
 * now asks `shared/auth/credential-audience.ts › isSharedCredential`, so a
 * container SESSION (one human's, narrowed) reads what that human reads and a
 * credential shared between humans still reads no private row at all.
 * ⚠ `Agent only` is still bounded by layer A: it grants into THIS channel, and
 * an agent elsewhere in the container reaches nothing new.
 *
 * ⚠ THE CHANNEL LIST COMES OFF THE SERVER, already fenced to the caller's
 * visible channels (`GET …/channel-grants`). It is never assembled from a
 * client-side workspace channel list — the names of rooms the caller cannot
 * read would then be on the wire, filtered only by the renderer.
 *
 * ⚠ `canManage` ALSO COMES OFF THE SERVER — the same predicate the PUT applies
 * (creator or workspace admin+, `service-channel-grants.ts ›
 * canManageChannelGrants`), so this cannot render an editor for somebody the
 * write will refuse. Everyone else gets the read-only summary.
 */
export function KbChannelGrantsSection({
  baseId,
  workspaceId,
}: {
  baseId: string;
  workspaceId: string;
}) {
  const { data, loading, error } = useChannelGrantSettings(baseId, workspaceId);
  const setGrant = useSetChannelGrant(baseId, workspaceId);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);

  async function write(
    channelId: string,
    level: ChannelGrantLevelInput,
    guestWrite: boolean
  ) {
    setPendingChannelId(channelId);
    try {
      await setGrant.mutateAsync({ channelId, level, guestWrite });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't update sharing";
      toast({ title: "Couldn't update sharing", description: msg });
    } finally {
      setPendingChannelId(null);
    }
  }

  if (loading) {
    return <p className="text-small text-text-secondary">Loading channels…</p>;
  }
  if (error) return <p className="text-small text-danger">{error}</p>;
  if (!data) return null;

  const granted = data.channels.filter((c) => data.grants[c.id]);

  if (!data.canManage) {
    return (
      <p className="text-caption text-text-secondary leading-relaxed">
        {granted.length === 0
          ? "Not shared into any channel."
          : `Shared into ${granted.length} channel${granted.length === 1 ? "" : "s"}. Only the owner or a workspace admin can change this.`}
      </p>
    );
  }

  if (data.channels.length === 0) {
    return (
      <p className="text-small text-text-secondary">
        No channels available.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {data.channels.map((channel) => (
        <GrantRow
          key={channel.id}
          channel={channel}
          grant={data.grants[channel.id] ?? null}
          workspaceId={workspaceId}
          pending={pendingChannelId === channel.id}
          disabled={pendingChannelId !== null}
          onChange={write}
        />
      ))}
    </div>
  );
}

/**
 * One channel's row: the three-state control, plus the guest-write toggle when
 * — and only when — there is a guest to hand a pen to.
 */
function GrantRow({
  channel,
  grant,
  workspaceId,
  pending,
  disabled,
  onChange,
}: {
  channel: ChannelGrantChannelRef;
  grant: ChannelResourceGrant | null;
  workspaceId: string;
  pending: boolean;
  disabled: boolean;
  onChange: (
    channelId: string,
    level: ChannelGrantLevelInput,
    guestWrite: boolean
  ) => void;
}) {
  const level: ChannelGrantLevelInput = grant?.level ?? "none";
  const guestWrite = grant?.guestWrite ?? false;

  // ⚠ THE ROSTER IS READ ONLY AT `visible`, and that bounds the fan: a null
  // channel id disables the query, so a settings modal listing N channels
  // issues one roster request per SHARED channel, not per row.
  const { members } = useChannelMembers(
    level === "visible" ? channel.id : null,
    workspaceId
  );
  // ⚠ FAIL-SAFE, and the two ways it can be absent are the reason. A roster
  // that has not loaded is `[]`, and `workspaceRole` is null on payloads that
  // predate the field (`ChannelMember.workspaceRole`) — both read as "no
  // guest", which HIDES the toggle. Never the other way round: a revealed
  // toggle over an unknown roster would offer to hand a pen to somebody who
  // may not be there.
  const hasGuest = members.some((m) => m.workspaceRole === "guest");
  const Icon = channel.isDirect ? MessageSquare : Hash;

  return (
    <div
      {...pendingRow(
        pending,
        "flex flex-col gap-2 rounded-lg border border-border-default bg-surface-raised-1 px-3 py-2"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-body font-medium text-text-primary">
          <Icon size={13} className="shrink-0 text-text-muted" />
          <span className="truncate">{channel.name}</span>
        </span>
        <GrantLevelControl
          value={level}
          disabled={disabled}
          onChange={(next) =>
            // ⚠ Dropping to `none`/`agent_only` sends `guestWrite: false`. The
            // server forces it too; sending it keeps the wire honest about the
            // end state being asked for.
            onChange(channel.id, next, next === "visible" ? guestWrite : false)
          }
        />
      </div>

      {level === "visible" && hasGuest ? (
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-2">
          <span className="text-caption text-text-secondary">
            Let guests edit
          </span>
          <Switch
            checked={guestWrite}
            disabled={disabled}
            aria-label={`Let guests edit in ${channel.name}`}
            onChange={(next) => onChange(channel.id, "visible", next)}
          />
        </div>
      ) : null}
    </div>
  );
}

const LEVELS: Array<{ key: ChannelGrantLevelInput; label: string }> = [
  { key: "none", label: "None" },
  { key: "agent_only", label: "Agent only" },
  { key: "visible", label: "Visible" },
];

/**
 * Three-state segmented radio, the shape of `members/components/team-bits.tsx ›
 * AccessLevelControl`.
 *
 * ⚠ NOT that component reused: its value type is `AccessLevel | null` and its
 * three segments are None/Read/Edit. Widening it to carry a second, unrelated
 * three-value vocabulary would put "Agent only" inside the TEAM access control,
 * where it means nothing. Same tokens and the same kit-free recipe; no new
 * class.
 */
function GrantLevelControl({
  value,
  onChange,
  disabled,
}: {
  value: ChannelGrantLevelInput;
  onChange: (next: ChannelGrantLevelInput) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex shrink-0 items-center overflow-hidden rounded-md border border-border-default"
    >
      {LEVELS.map((seg) => {
        const active = value === seg.key;
        return (
          <button
            key={seg.key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(seg.key)}
            className={cn(
              "px-2.5 py-1 text-label uppercase tracking-wider transition-colors",
              active
                ? "bg-surface-selected text-text-primary"
                : "text-text-muted hover:bg-surface-raised-2 hover:text-text-primary",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            )}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
