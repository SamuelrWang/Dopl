import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { ChannelCursorUndecodableError } from "./errors";
import { CURSOR_PREFIX, isCursorToken } from "../lib/cursor-format";

/**
 * **THE OPAQUE CURSOR CODEC** (B6, Samuel's card #4469 option 1, 2026-10-12).
 *
 * `channel_messages.seq` is table-wide and gappy, so the integer a caller is
 * handed as a cursor also tells them roughly how much is posted in rooms they
 * cannot see. This turns that integer into a token the server can compare and a
 * reader cannot read.
 *
 * ⚠ **SIGNING WOULD NOT HAVE WORKED, AND THAT IS THE WHOLE DESIGN NOTE.** An
 * HMAC-signed `4461` is still `4461` to anyone who base64-decodes it: tamper-proof
 * and just as leaky. Confidentiality is the requirement, so this is AEAD
 * (AES-256-GCM from `node:crypto`, no new dependency — `shared/supabase/caller-jwt.ts`
 * is the precedent for keyed crypto here).
 *
 * ```
 * dc1.<base64url(iv ‖ ciphertext ‖ tag)>      12 + 8 + 16 bytes → 48 chars + prefix
 * ```
 *
 * ⚠ **`dc1` IS A FORMAT *AND* A KEY ID**, so a rotation is explicit and a token
 * minted under a retired key fails as *undecodable* rather than as corrupt.
 *
 * ⚠ **THE SCOPE AND THE READER ARE BOUND AS AAD, NOT STORED IN THE TOKEN.** Two
 * properties follow that the integer never had: a cursor is **not portable** to
 * another account, and a channel cursor **cannot be transposed** into an
 * account-wide one. Today an integer is valid everywhere it is accepted. Binding
 * via AAD rather than payload also keeps the token short — the values are already
 * known at both ends.
 *
 * ⚠ **IT IS INERT IN THIS COMMIT.** Nothing calls it. B6-2 wires the decode in at
 * the API edge; B6-3 (emitting tokens) is HELD until a desktop release carrying the
 * fixed wait skill is adopted, because `dopl-channel-wait.sh` reads its persisted
 * cursor through `tr -dc '0-9'` and would silently turn a token into a plausible
 * WRONG integer (`dc1.AbC-_123` → `1123`). Handing a token to that script is the
 * one thing this feature must not do first.
 */

/**
 * ⚠ **`encodeChannelCursor` / `decodeChannelCursor`, NOT `encodeCursor`** (Review
 * 40): `src/features/revisions/server/service.ts:213` already exports an
 * `encodeCursor`, and two same-named cursor codecs in one tree is how an import
 * lands on the wrong one — a revisions cursor and a channel cursor are not even
 * the same shape.
 */

/**
 * ⚠ **THE FORMAT MOVED TO `lib/cursor-format.ts` AND IS RE-EXPORTED HERE** (B6-2):
 * `schema-reads.ts` must recognise a token to accept one, and that file is
 * imported by a browser hook, so it cannot reach this `server-only` module. The
 * seam is the secret — format shared, key and crypto here. Re-exported so no
 * existing importer moved.
 */
export { CURSOR_PREFIX, isCursorToken };

/** `seq` is a Postgres BIGINT; eight bytes is exact and shorter than any text form. */
const SEQ_BYTES = 8;
const IV_BYTES = 12;

/**
 * What a cursor paginates. ⚠ Part of the AAD, so a cursor minted for one scope
 * cannot be replayed against another — the account-wide read and a single channel
 * are different spaces even when the integer inside would be valid in both.
 */
export type CursorScope =
  | { readonly kind: "channel"; readonly channelId: string }
  | { readonly kind: "workspace"; readonly workspaceId: string }
  | { readonly kind: "account" };

/** The scope, as the one string that goes into the AAD. */
export function cursorScopeKey(scope: CursorScope): string {
  switch (scope.kind) {
    case "channel":
      return `channel:${scope.channelId}`;
    case "workspace":
      return `workspace:${scope.workspaceId}`;
    case "account":
      return "account";
  }
}


/**
 * The 32-byte key, or `null` when none is configured.
 *
 * ⚠ **ACCEPTS BASE64 OR HEX** because a deploy secret gets pasted in whichever
 * form the operator's tooling produced, and a key that silently truncates is worse
 * than one that refuses.
 */
function cursorKey(): Buffer | null {
  const raw = process.env.DOPL_CURSOR_KEY;
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

/**
 * **CAN THIS DEPLOY MINT TOKENS?** (ASK 12, ruled 2026-10-12.)
 *
 * ⚠ **PRODUCTION WITH NO KEY REFUSES; DEV AND CI FALL BACK TO INTEGERS.** The
 * fallback is exactly as narrow as it has to be for a developer with no secret to
 * run the app, and no narrower: a fail-open that reached production would be the
 * leak with extra steps. `require-cron-secret.ts` is the same shape of rule.
 */
export function cursorTokensAvailable(): boolean {
  if (cursorKey() !== null) return true;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DOPL_CURSOR_KEY is not configured. Channel cursors cannot be minted in " +
        "production without it — set the key or roll back; do NOT fall back to " +
        "publishing raw `seq` cursors.",
    );
  }
  return false;
}

/**
 * **A SEQ, AS A TOKEN.** Throws when no key is configured — callers ask
 * {@link cursorTokensAvailable} first and emit the integer when it answers false
 * (dev only).
 *
 * ⚠ **A FRESH IV EVERY TIME, SO THE SAME SEQ ENCODES DIFFERENTLY.** Not a
 * nicety: a deterministic token would let a reader match two cursors for equality
 * and recover the ordering — and ordering is most of what the integer leaked.
 */
export function encodeChannelCursor(
  seq: number,
  scope: CursorScope,
  userId: string,
): string {
  const key = cursorKey();
  if (key === null) {
    throw new Error("DOPL_CURSOR_KEY is not configured; cannot encode a cursor");
  }
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw new Error(`a cursor must be a non-negative safe integer, got ${seq}`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad(scope, userId), "utf8"));
  const plain = Buffer.alloc(SEQ_BYTES);
  plain.writeBigUInt64BE(BigInt(seq));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const token = Buffer.concat([iv, ct, cipher.getAuthTag()]);
  return CURSOR_PREFIX + token.toString("base64url");
}

/**
 * **A TOKEN, BACK TO ITS SEQ — OR A REFUSAL** (ASK 11, ruled 2026-10-12: refuse,
 * never reset).
 *
 * ⚠ **AN UNDECODABLE CURSOR MUST NOT BECOME ZERO.** Resetting would re-deliver
 * history as new, which is the one failure a notification path can never have: an
 * agent would re-answer messages it had already answered. Refusing leaves the
 * caller to re-establish from an unscoped read, which is what the result text
 * already tells them to do when a cursor cannot be used (`channel-ops-read.ts`'s
 * `cursor=none` sentence).
 *
 * Every failure is the same answer — wrong key, wrong scope, wrong reader,
 * truncated, tampered, or not a token at all — because distinguishing them for the
 * caller would narrow the token for an attacker.
 */
export function decodeChannelCursor(
  token: string,
  scope: CursorScope,
  userId: string,
): number {
  const key = cursorKey();
  if (key === null) throw new ChannelCursorUndecodableError();
  if (!isCursorToken(token)) throw new ChannelCursorUndecodableError();
  // ⚠ **NO try/catch HERE, AND THE REASON IS MEASURED** (Review 40):
  // `Buffer.from("!!!!", "base64url")` does NOT throw — it returns a zero-length
  // buffer, silently dropping anything it cannot decode. The length check below is
  // what actually rejects junk, so a catch around this line was dead code pretending
  // to be a guard.
  const raw = Buffer.from(token.slice(CURSOR_PREFIX.length), "base64url");
  if (raw.length !== IV_BYTES + SEQ_BYTES + 16) {
    throw new ChannelCursorUndecodableError();
  }
  const iv = raw.subarray(0, IV_BYTES);
  const ct = raw.subarray(IV_BYTES, IV_BYTES + SEQ_BYTES);
  const tag = raw.subarray(IV_BYTES + SEQ_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(aad(scope, userId), "utf8"));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    const seq = Number(plain.readBigUInt64BE());
    // A key that decrypts to a number we cannot represent is a key mismatch that
    // happened to authenticate, which cannot occur — but the cursor is a number
    // every caller does arithmetic-free comparisons on, so it is checked anyway.
    if (!Number.isSafeInteger(seq) || seq < 0) {
      throw new ChannelCursorUndecodableError();
    }
    return seq;
  } catch {
    // ⚠ `final()` throws on a bad tag, which is the tamper and wrong-key path.
    throw new ChannelCursorUndecodableError();
  }
}

/** The bound context: format, scope, reader. Any mismatch fails authentication. */
function aad(scope: CursorScope, userId: string): string {
  return `${CURSOR_PREFIX}|${cursorScopeKey(scope)}|${userId}`;
}
