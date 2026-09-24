"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";
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
import { SettingsSection } from "./settings-section";
import type {
  ChannelGrantChannelRef,
  ChannelGrantLevelInput,
  ChannelResourceGrant,
} from "../types";

/**
 * Settings → Channels: which CHANNELS this knowledge base is shared into, one
 * row per channel, three states per row.
 *
 * The three states are `None` (no grant row), `Agent only` (the channel's
 * agents read it, no human does) and `Visible` (everyone in the channel,
 * guests included) — the table's own shape, not a translation of it.
 *
 * F-336 (resolved 2026-08-27, Samuel's ruling): `Agent only` reaches a
 * `visibility='private'` base again, so that is true of every base.
 * `knowledge/server/service-shared.ts › canSeeBase` had answered false for every
 * non-public base under a container-locked credential and runs before the
 * audience ceiling; it now asks `shared/auth/credential-audience.ts ›
 * isSharedCredential`, so a container session reads what its human reads.
 * `Agent only` is still bounded by layer A: it grants into this channel only.
 *
 * The channel list comes off the server, already fenced to the caller's visible
 * channels, or the names of unreadable rooms would be on the wire with only the
 * renderer filtering them. `canManage` likewise — the same predicate the PUT
 * applies (`service-channel-grants.ts › canManageChannelGrants`) — so this
 * cannot render an editor for somebody the write will refuse.
 *
 * Ruling 2026-09-17: in a standard workspace it renders nothing, heading
 * included, on the server's `channelScopeAllowed`. It owns its own
 * `SettingsSection` for that; with the frame in the parent the refusal left an
 * empty Channels heading.
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
      toast({ title: "Couldn't update sharing", description: userFacingMessage(err) });
    } finally {
      setPendingChannelId(null);
    }
  }

  if (loading) {
    return (
      <SettingsSection title="Channels">
        <p className="text-small text-text-secondary">Loading channels…</p>
      </SettingsSection>
    );
  }
  if (error) {
    return (
      <SettingsSection title="Channels">
        <p className="text-small text-danger">{error}</p>
      </SettingsSection>
    );
  }
  if (!data) return null;
  // The whole section, not just its rows — see the docblock.
  // ⚠ `?? false` because the field is NEW on a 24h-cached payload: a warm entry
  // written before it existed has no such key (INVARIANTS §8).
  if (!(data.channelScopeAllowed ?? false)) return null;

  const granted = data.channels.filter((c) => data.grants[c.id]);

  if (!data.canManage) {
    return (
      <SettingsSection title="Channels">
        <p className="text-caption text-text-secondary leading-relaxed">
          {granted.length === 0
            ? "Not shared into any channel."
            : `Shared into ${granted.length} channel${granted.length === 1 ? "" : "s"}. Only the owner or a workspace admin can change this.`}
        </p>
      </SettingsSection>
    );
  }

  if (data.channels.length === 0) {
    return (
      <SettingsSection title="Channels">
        <p className="text-small text-text-secondary">No channels available.</p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Channels">
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
    </SettingsSection>
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

  // Roster read only at `visible`: a null channel id disables the query, so a
  // modal listing N channels issues one request per shared channel, not per row.
  const { members } = useChannelMembers(
    level === "visible" ? channel.id : null,
    workspaceId
  );
  // Fail-safe: an unloaded roster (`[]`) and a null `workspaceRole` both read
  // as "no guest" and hide the toggle. Never the other way round — a revealed
  // toggle over an unknown roster offers a pen to somebody who may not be there.
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
            // Dropping to `none`/`agent_only` sends `guestWrite: false`; the
            // server forces it too, but the wire states the end state asked for.
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
 * Not that component reused: its segments are None/Read/Edit, and widening it
 * would put "Agent only" inside the team access control, where it means
 * nothing. Same tokens, same kit-free recipe.
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
