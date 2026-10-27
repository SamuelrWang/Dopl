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
  /**
   * Device SDK Connect (A4): pairings claimed through a Connect session hand the glasses a token for
   * an SDK-owned `devices` row. Absent = prosumer-only (every prosumer test and caller before A4).
   */
  connect?: ConnectPairingPort;
}

/**
 * The Device SDK side of a G2 pairing claimed through a Connect session (no Dopl user).
 * Implemented over `glasses_pairings.sdk_device_id` + `device_credentials`
 * (`device-sdk/server/connect/pairing-port.ts`). Credentials cross it as HASHES only.
 */
export interface ConnectPairingPort {
  /** pending → claimed, pointing at the SDK device; only if still pending and unexpired. */
  claimPairing(pairingId: string, sdkDeviceId: string, now: string): Promise<boolean>;
  /** The SDK device a Connect claim of this pairing created, or null (a prosumer pairing). */
  sdkDeviceFor(pairingId: string): Promise<string | null>;
  /** Store the device token's hash as the device's live `device_token` credential. */
  setTokenHash(sdkDeviceId: string, hash: string, now: string): Promise<void>;
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
  // A Connect claim leaves `device_id` null and names an SDK device instead. A prosumer pairing
  // never reaches this lookup with a device behind it, so its answer is unchanged.
  if (!p.device_id && !p.token_issued_at && deps.connect) {
    const sdkDeviceId = await deps.connect.sdkDeviceFor(p.id);
    if (sdkDeviceId && (await deps.devices.markTokenIssued(p.id, iso(now)))) {
      const token = mintDeviceToken();
      await deps.connect.setTokenHash(sdkDeviceId, hashCredential(token), iso(now));
      return { status: "claimed", device_id: sdkDeviceId, device_token: token };
    }
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

/**
 * Claim a glasses pairing code THROUGH A DEVICE SDK CONNECT SESSION (A4): the end user has no Dopl
 * account (D1), so no `glasses_device_links` row is made. `createDevice` makes the SDK-owned
 * `devices` row; the pairing is then claimed pointing at it, and the glasses' next status poll
 * collects a token for it (`pairingStatus`, the `connect` branch). Same code normalisation, same
 * expiry and same race rule as {@link claimPairing}: a lost race discards the device.
 */
export async function claimPairingForConnect(
  deps: PairingDeps & { connect: ConnectPairingPort },
  input: {
    code: string;
    createDevice: (now: string) => Promise<string>;
    discardDevice: (deviceId: string, now: string) => Promise<void>;
  },
): Promise<{ device_id: string }> {
  const code = normalizePairingCode(input.code);
  if (!code) throw new HttpError(400, "INVALID_CODE", `Pairing codes are ${PAIRING_CODE_LENGTH} letters and digits.`);
  const now = nowOf(deps);
  const pairing = await deps.devices.findPendingPairingByCode(code, iso(now));
  if (!pairing) throw new HttpError(404, "CODE_NOT_FOUND", "No pending pairing with that code; it may have expired.");
  const deviceId = await input.createDevice(iso(now));
  if (!(await deps.connect.claimPairing(pairing.id, deviceId, iso(now)))) {
    await input.discardDevice(deviceId, iso(now));
    throw new HttpError(409, "CODE_ALREADY_CLAIMED", "That code was just claimed or expired.");
  }
  return { device_id: deviceId };
}
