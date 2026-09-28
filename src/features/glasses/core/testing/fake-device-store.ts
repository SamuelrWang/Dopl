import type { ChannelLink, ChannelLinker } from "../devices/service";
import type { DeviceStore, GlassesDevice, GlassesPairing } from "../devices/types";

/** In-memory {@link DeviceStore} for tests: mirrors `devices/repository.ts` semantics. */
export function createFakeDeviceStore() {
  type Row = GlassesDevice & { token_hash: string | null; hey_even_key_hash: string | null };
  const devices: Row[] = [];
  const pairings: GlassesPairing[] = [];
  let seq = 0;
  const id = () => `00000000-0000-4000-a000-${String(++seq).padStart(12, "0")}`;
  const out = (r: Row): GlassesDevice => {
    const copy: Partial<Row> = { ...r, has_hey_even_key: r.hey_even_key_hash !== null };
    delete copy.token_hash;
    delete copy.hey_even_key_hash;
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
        linked_channel_id: d.linkedChannelId,
        linked_container_id: d.linkedContainerId,
        reply_cursor_seq: null,
        current_target_channel_id: null,
        current_target_agent: null,
        created_at: d.now,
        last_seen: null,
        revoked_at: null,
        has_hey_even_key: false,
        token_hash: null,
        hey_even_key_hash: null,
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
    async findDeviceByHeyEvenKeyHash(hash) {
      const r = devices.find((x) => x.hey_even_key_hash === hash && active(x));
      return r ? out(r) : null;
    },
    async setTokenHash(did, hash) {
      const r = devices.find((x) => x.id === did && active(x));
      if (r) r.token_hash = hash;
    },
    async setHeyEvenKeyHash(userId, did, hash) {
      const r = devices.find((x) => x.user_id === userId && x.id === did && active(x));
      if (r) r.hey_even_key_hash = hash;
      return !!r;
    },
    async updateDevice(userId, did, patch) {
      const r = devices.find((x) => x.user_id === userId && x.id === did && active(x));
      if (!r) return null;
      if (patch.name !== undefined) r.name = patch.name;
      if (patch.linkedChannelId !== undefined) {
        r.linked_channel_id = patch.linkedChannelId;
        r.linked_container_id = patch.linkedContainerId ?? null;
        r.reply_cursor_seq = null;
      }
      return out(r);
    },
    async revokeDevice(userId, did, now) {
      const r = devices.find((x) => x.user_id === userId && x.id === did && active(x));
      if (!r) return false;
      Object.assign(r, { revoked_at: now, token_hash: null, hey_even_key_hash: null });
      return true;
    },
    async touchDevice(did, now) {
      const r = devices.find((x) => x.id === did);
      if (r) r.last_seen = now;
    },
    async setReplyCursor(did, seq) {
      const r = devices.find((x) => x.id === did);
      if (r) r.reply_cursor_seq = seq;
    },
    async setCurrentTarget(did, channelId, agentId) {
      const r = devices.find((x) => x.id === did && active(x));
      if (r) Object.assign(r, { current_target_channel_id: channelId, current_target_agent: agentId });
    },
    async countActiveDevices(userId) {
      return devices.filter((x) => x.user_id === userId && active(x) && x.token_hash !== null).length;
    },
  };
  return { devices: store, deviceRows: devices, pairings };
}

/** A {@link ChannelLinker} over a fixed membership table: `members[channelId]` = user ids. */
export function fakeLinker(channels: Record<string, { name: string; members: string[] }>): ChannelLinker {
  return {
    async linkable(userId, ids) {
      const out = new Map<string, ChannelLink>();
      for (const id of ids) {
        const c = channels[id];
        if (c?.members.includes(userId)) {
          out.set(id, { channelId: id, containerId: "11111111-0000-4000-8000-000000000000", name: c.name });
        }
      }
      return out;
    },
  };
}
