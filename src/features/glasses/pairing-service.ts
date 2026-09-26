import { timingSafeEqual } from "node:crypto";
import { HttpError } from "@/shared/lib/http-error";
import {
  generatePairingCode,
  hashCredential,
  mintDeviceToken,
  mintPollSecret,
  normalizePairingCode,
} from "./credentials";
import { toDeviceDto, type ChannelLinker, type DeviceDto } from "./devices-service";
import type { DeviceStore } from "./devices-types";
import { isUuid } from "./text";

/**
 * Pairing: the glasses show a code, a signed-in user claims it, the glasses
 * poll and receive their device token ONCE.
 *
 * 🔒 No plaintext token is ever stored. The claim creates the device row with
 * no credential; the first status poll after the claim wins an atomic
 * `token_issued_at` stamp, mints the token, stores only its hash and returns
 * it. Every later poll answers `claimed` without a token. A lost response
 * means re-pairing, never a second copy.
 */

export const PAIRING_TTL_MS = 10 * 60 * 1000;
const CODE_ATTEMPTS = 5;
export const DEFAULT_DEVICE_NAME = "Even G2";
export const DEFAULT_PLATFORM = "even_g2";

export interface PairingDeps {
  devices: DeviceStore;
  linker: ChannelLinker;
  now?: () => number;
  code?: () => string;
}

const iso = (ms: number) => new Date(ms).toISOString();

export async function startPairing(deps: PairingDeps) {
  const now = (deps.now ?? Date.now)();
  await deps.devices.expirePairings(iso(now));
  const pollSecret = mintPollSecret();
  const expiresAt = iso(now + PAIRING_TTL_MS);
  for (let i = 0; i < CODE_ATTEMPTS; i++) {
    const code = (deps.code ?? generatePairingCode)();
    const row = await deps.devices.insertPairing({
      code,
      pollSecretHash: hashCredential(pollSecret),
      expiresAt,
      now: iso(now),
    });
    if (row) return { pair_id: row.id, code: row.code, poll_secret: pollSecret, expires_at: row.expires_at };
  }
  throw new HttpError(503, "PAIRING_UNAVAILABLE", "Could not allocate a pairing code; try again.");
}

function sameSecret(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashCredential(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type PairingStatusResult =
  | { status: "pending"; expires_at: string }
  | { status: "expired" }
  | { status: "claimed"; device_id: string; device_token?: string };

export async function pairingStatus(
  deps: PairingDeps,
  pairId: string,
  pollSecret: string,
): Promise<PairingStatusResult> {
  const unknown = new HttpError(404, "PAIRING_NOT_FOUND", "Unknown pairing.");
  if (!isUuid(pairId) || !pollSecret) throw unknown;
  const p = await deps.devices.getPairing(pairId);
  if (!p || !sameSecret(pollSecret, p.poll_secret_hash)) throw unknown;
  const now = (deps.now ?? Date.now)();
  if (p.status === "expired" || (p.status === "pending" && Date.parse(p.expires_at) <= now)) {
    return { status: "expired" };
  }
  if (p.status === "pending") return { status: "pending", expires_at: p.expires_at };
  if (!p.device_id) return { status: "expired" };
  if (!p.token_issued_at && (await deps.devices.markTokenIssued(p.id, iso(now)))) {
    const token = mintDeviceToken();
    await deps.devices.setTokenHash(p.device_id, hashCredential(token));
    return { status: "claimed", device_id: p.device_id, device_token: token };
  }
  return { status: "claimed", device_id: p.device_id };
}

export interface ClaimInput {
  code: string;
  name?: string;
  channel_id?: string | null;
}

export async function claimPairing(deps: PairingDeps, userId: string, input: ClaimInput): Promise<DeviceDto> {
  const code = normalizePairingCode(input.code);
  if (!code) throw new HttpError(400, "INVALID_CODE", "Pairing codes are 6 letters and digits.");
  const now = (deps.now ?? Date.now)();
  const pairing = await deps.devices.findPendingPairingByCode(code, iso(now));
  if (!pairing) throw new HttpError(404, "CODE_NOT_FOUND", "No pending pairing with that code; it may have expired.");
  const link = input.channel_id ? await deps.linker.resolveLink(userId, input.channel_id) : null;
  const device = await deps.devices.insertDevice({
    userId,
    name: input.name?.trim() || DEFAULT_DEVICE_NAME,
    platform: DEFAULT_PLATFORM,
    linkedChannelId: link?.channelId ?? null,
    linkedContainerId: link?.containerId ?? null,
    now: iso(now),
  });
  if (!(await deps.devices.claimPairing(pairing.id, device.id, iso(now)))) {
    // Lost a race with another claim, or it expired in between: leave no orphan device.
    await deps.devices.revokeDevice(userId, device.id, iso(now));
    throw new HttpError(409, "CODE_ALREADY_CLAIMED", "That code was just claimed or expired.");
  }
  return toDeviceDto(device, link ? new Map([[link.channelId, link.name]]) : new Map(), now);
}
