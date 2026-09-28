import { timingSafeEqual } from "node:crypto";
import { HttpError } from "@/shared/lib/http-error";
import { generatePairingCode, hashCredential, mintDeviceToken, mintPollSecret } from "./credentials";
import { PAIRING_CODE_LENGTH, normalizePairingCode } from "./pairing-code";
import { DEFAULT_PLATFORM } from "../../platforms/registry";
import { iso, nowOf, type Clock } from "../clock";
import { isUuid } from "../validation";
import { toDeviceDto, type DeviceDto } from "./service";
import type { DeviceStore } from "./types";

/**
 * Pairing: the glasses show a code, a signed-in user claims it, the glasses
 * poll and receive their device token ONCE.
 *
 * 🔒 No plaintext token is ever stored. The claim creates the device row with
 * no credential; the first status poll after the claim wins an atomic
 * `token_issued_at` stamp, mints the token, stores only its hash and returns
 * it. Every later poll answers a bare `{status:'claimed'}`, the device's cue to
 * pair again since it evidently lost the token. Never a second copy.
 */

export const PAIRING_TTL_MS = 10 * 60 * 1000;
const PAIRING_RETENTION_MS = 24 * 60 * 60 * 1000;
const CODE_ATTEMPTS = 5;

export interface PairingDeps extends Clock {
  devices: DeviceStore;
  code?: () => string;
}

export async function startPairing(deps: PairingDeps) {
  const now = nowOf(deps);
  await deps.devices.deleteStalePairings(iso(now - PAIRING_RETENTION_MS));
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
    // Held by a pending pairing; if that one has expired, free the code for the next draw.
    await deps.devices.expirePairingCode(code, iso(now));
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
  | { status: "claimed"; device_id: string; device_token: string }
  /** Already collected (or the device is gone): the caller should pair again. */
  | { status: "claimed" };

export async function pairingStatus(
  deps: PairingDeps,
  pairId: string,
  pollSecret: string,
): Promise<PairingStatusResult> {
  const unknown = new HttpError(404, "PAIRING_NOT_FOUND", "Unknown pairing.");
  if (!isUuid(pairId) || !pollSecret) throw unknown;
  const p = await deps.devices.getPairing(pairId);
  if (!p || !sameSecret(pollSecret, p.poll_secret_hash)) throw unknown;
  const now = nowOf(deps);
  if (p.status === "expired" || (p.status === "pending" && Date.parse(p.expires_at) <= now)) {
    return { status: "expired" };
  }
  if (p.status === "pending") return { status: "pending", expires_at: p.expires_at };
  if (p.device_id && !p.token_issued_at && (await deps.devices.markTokenIssued(p.id, iso(now)))) {
    const token = mintDeviceToken();
    await deps.devices.setTokenHash(p.device_id, hashCredential(token));
    return { status: "claimed", device_id: p.device_id, device_token: token };
  }
  return { status: "claimed" };
}

export interface ClaimInput {
  code: string;
  name?: string;
  /** Accepted from older clients and IGNORED: a device has no linked channel. */
  channel_id?: unknown;
}

export async function claimPairing(deps: PairingDeps, userId: string, input: ClaimInput): Promise<DeviceDto> {
  const code = normalizePairingCode(input.code);
  if (!code) throw new HttpError(400, "INVALID_CODE", `Pairing codes are ${PAIRING_CODE_LENGTH} letters and digits.`);
  const now = nowOf(deps);
  const pairing = await deps.devices.findPendingPairingByCode(code, iso(now));
  if (!pairing) throw new HttpError(404, "CODE_NOT_FOUND", "No pending pairing with that code; it may have expired.");
  const device = await deps.devices.insertDevice({
    userId,
    name: input.name?.trim() || DEFAULT_PLATFORM.label,
    platform: DEFAULT_PLATFORM.id,
    now: iso(now),
  });
  if (!(await deps.devices.claimPairing(pairing.id, device.id, iso(now)))) {
    // Lost a race with another claim, or it expired in between: leave no orphan device.
    await deps.devices.revokeDevice(userId, device.id, iso(now));
    throw new HttpError(409, "CODE_ALREADY_CLAIMED", "That code was just claimed or expired.");
  }
  return toDeviceDto(device, now);
}
