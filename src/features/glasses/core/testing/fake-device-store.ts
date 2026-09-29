import type { ChannelLink, ChannelLinker } from "../devices/service";
import type { DeviceChannelActivity, DeviceStore, GlassesDevice, GlassesPairing } from "../devices/types";

/** In-memory {@link DeviceStore} for tests: mirrors `devices/repository.ts` semantics. */
export function createFakeDeviceStore() {
  type Row = GlassesDevice & { token_hash: string | null; assistant_key_hash: string | null };
  const devices: Row[] = [];
  const pairings: GlassesPairing[] = [];
  /** `glasses_device_channel_activity`, keyed `${device_id}|${channel_id}`. */
  const activity = new Map<string, DeviceChannelActivity & { device_id: string }>();
  let seq = 0;
  const id = () => `00000000-0000-4000-a000-${String(++seq).padStart(12, "0")}`;
  const out = (r: Row): GlassesDevice => {
    const copy: Partial<Row> = { ...r, has_assistant_key: r.assistant_key_hash !== null };
    delete copy.token_hash;
    delete copy.assistant_key_hash;
    return copy as GlassesDevice;
  };
  const active = (r: Row) => r.revoked_at === null;

  const store: DeviceStore = {
    async insertPairing({ code, pollSecretHash, expiresAt }) {
      if (pairings.some((p) => p.code === code && p.status === "pending")) return false;
      const p: GlassesPairing = {
        id: id(),
        code,
        poll_secret_hash: pollSecretHash,
        status: "pending",
        device_id: null,
        token_issued_at: null,
        expires_at: expiresAt,
      };
      pairings.push(p);
      return { ...p };
    },
    async getPairing(pid) {
      const p = pairings.find((x) => x.id === pid);
      return p ? { ...p } : null;
    },
    async findPendingPairingByCode(code, now) {
      const p = pairings.find((x) => x.code === code && x.status === "pending" && x.expires_at > now);
      return p ? { ...p } : null;
    },
    async claimPairing(pid, deviceId, now) {
      const p = pairings.find((x) => x.id === pid && x.status === "pending" && x.expires_at > now);
      if (!p) return false;
      Object.assign(p, { status: "claimed", device_id: deviceId });
      return true;
    },
    async markTokenIssued(pid, now) {
      const p = pairings.find((x) => x.id === pid && x.status === "claimed" && x.token_issued_at === null);
      if (!p) return false;
      p.token_issued_at = now;
      return true;
    },
    async expirePairingCode(code, now) {
      for (const p of pairings) if (p.code === code && p.status === "pending" && p.expires_at <= now) p.status = "expired";
    },
    async deleteStalePairings(cutoff) {
      for (let i = pairings.length - 1; i >= 0; i--) if (pairings[i].expires_at < cutoff) pairings.splice(i, 1);
    },
    async insertDevice(d) {
      const r: Row = {
        id: id(),
        user_id: d.userId,
        name: d.name,
        platform: d.platform,
        current_target_channel_id: null,
        current_target_agent: null,
        created_at: d.now,
        last_seen: null,
        revoked_at: null,
        has_assistant_key: false,
        token_hash: null,
        assistant_key_hash: null,
      };
      devices.push(r);
      return out(r);
    },
    async listDevices(userId) {
      return devices.filter((x) => x.user_id === userId && active(x) && x.token_hash !== null).map(out);
    },
    async findDeviceByTokenHash(hash) {
      const r = devices.find((x) => x.token_hash === hash && active(x));
      return r ? out(r) : null;
    },
    async findDeviceByAssistantKeyHash(hash) {
      const r = devices.find((x) => x.assistant_key_hash === hash && active(x));
      return r ? out(r) : null;
    },
    async setTokenHash(did, hash) {
      const r = devices.find((x) => x.id === did && active(x));
      if (r) r.token_hash = hash;
    },
    async setAssistantKeyHash(userId, did, hash) {
      const r = devices.find((x) => x.user_id === userId && x.id === did && active(x));
      if (r) r.assistant_key_hash = hash;
      return !!r;
    },
    async updateDevice(userId, did, patch) {
      const r = devices.find((x) => x.user_id === userId && x.id === did && active(x));
      if (!r) return null;
      if (patch.name !== undefined) r.name = patch.name;
      return out(r);
    },
    async revokeDevice(userId, did, now) {
      const r = devices.find((x) => x.user_id === userId && x.id === did && active(x));
      if (!r) return false;
      Object.assign(r, { revoked_at: now, token_hash: null, assistant_key_hash: null });
      return true;
    },
    async touchDevice(did, now) {
      const r = devices.find((x) => x.id === did);
      if (r) r.last_seen = now;
    },
    async listChannelActivity(did) {
      return [...activity.values()].filter((a) => a.device_id === did).map((a) => ({ channel_id: a.channel_id, last_posted_at: a.last_posted_at, reply_cursor_seq: a.reply_cursor_seq, cursor_at: a.cursor_at }));
    },
    async recordChannelPost(did, channelId, now, cursor) {
      const key = `${did}|${channelId}`;
      const row = activity.get(key);
      if (cursor) {
        activity.set(key, { device_id: did, channel_id: channelId, last_posted_at: now, reply_cursor_seq: cursor.seq, cursor_at: cursor.at });
      } else if (row) {
        row.last_posted_at = now;
      }
    },
    async setChannelCursors(did, cursors) {
      for (const c of cursors) {
        const key = `${did}|${c.channelId}`;
        const row = activity.get(key);
        activity.set(key, { device_id: did, channel_id: c.channelId, last_posted_at: row?.last_posted_at ?? null, reply_cursor_seq: c.seq, cursor_at: c.at });
      }
    },
    async setCurrentTarget(did, channelId, agentId) {
      const r = devices.find((x) => x.id === did && active(x));
      if (r) Object.assign(r, { current_target_channel_id: channelId, current_target_agent: agentId });
    },
    async countActiveDevices(userId) {
      return devices.filter((x) => x.user_id === userId && active(x) && x.token_hash !== null).length;
    },
  };
  return { devices: store, deviceRows: devices, pairings, activity };
}

/**
 * A {@link ChannelLinker} over a fixed membership table: `members[channelId]` =
 * user ids; `last` (ISO) ranks the most-recent fallback.
 */
export function fakeLinker(channels: Record<string, { name: string; members: string[]; last?: string }>): ChannelLinker {
  const link = (id: string, name: string): ChannelLink => ({ channelId: id, containerId: "11111111-0000-4000-8000-000000000000", name });
  return {
    async mostRecent(userId) {
      const [best] = Object.entries(channels)
        .filter(([, c]) => c.members.includes(userId))
        .sort(([, a], [, b]) => (b.last ?? "").localeCompare(a.last ?? ""));
      return best ? link(best[0], best[1].name) : null;
    },
    async linkable(userId, ids) {
      const out = new Map<string, ChannelLink>();
      for (const id of ids) {
        const c = channels[id];
        if (c?.members.includes(userId)) {
          out.set(id, link(id, c.name));
        }
      }
      return out;
    },
  };
}
