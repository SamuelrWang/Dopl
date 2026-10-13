import "server-only";

import { isCursorToken } from "../lib/cursor-format";
import { ChannelCursorUndecodableError } from "./errors";
import { decodeChannelCursor, type CursorScope } from "./cursor-codec";
import { logCursorForm, type CursorTelemetry } from "./cursor-telemetry";

/**
 * **THE ONE PLACE A CURSOR BECOMES A NUMBER** (B6-2, 2026-10-12).
 *
 * Every accepting surface takes both forms — a legacy integer and an opaque
 * `dc1.` token — and converts here, at the edge, before anything downstream runs.
 * Past this call the cursor is the same `number` it has always been, so **no
 * service, repository or SQL path changes at all**: `gt("seq", since)` is
 * untouched, and the keyset paging, the holds and the watermarks keep their one
 * comparison.
 *
 * ⚠ **THE EDGE IS WHERE THE SCOPE AND THE READER ARE KNOWN, WHICH IS WHY IT IS
 * THE EDGE.** A token is bound to both as AAD, so it can only be decrypted by
 * code that knows which channel (or workspace, or the account) it was minted for
 * and who for. A repository has neither to hand — pushing the decode inward would
 * mean passing them along just to decrypt, and a codec reachable from a data layer
 * is a codec that will eventually be called with the wrong scope.
 *
 * ⚠ **A STRING THAT IS NOT A TOKEN IS REFUSED, NOT PARSED.** `schema-reads.ts`
 * already guarantees a string here starts with the prefix, so this branch is
 * unreachable through a route — and it is written as a refusal rather than a
 * `Number(value)` fallback precisely because the next caller may not come through
 * zod. A silent `Number("12abc") → NaN` reaching `gt("seq", NaN)` is the shape of
 * bug this whole lane exists to avoid.
 *
 * ⚠ **`telemetry` IS REQUIRED, NOT OPTIONAL** (B6-4). It names the surface, which
 * is the one thing this function cannot work out for itself — two surfaces share
 * the account scope and two more share the channel scope. Making it required
 * means a NEW accept site cannot silently drop out of the measurement: it is a
 * compile error, not a quietly missing row. That is deliberately a stronger
 * guarantee than a text scan for call sites, which is the other way this could
 * have been enforced.
 */
export function acceptChannelCursor(
  value: string | number,
  scope: CursorScope,
  userId: string,
  telemetry: CursorTelemetry,
): number;
export function acceptChannelCursor(
  value: string | number | undefined,
  scope: CursorScope,
  userId: string,
  telemetry: CursorTelemetry,
): number | undefined;
export function acceptChannelCursor(
  value: string | number | undefined,
  scope: CursorScope,
  userId: string,
  telemetry: CursorTelemetry,
): number | undefined {
  // ⚠ **COUNTED FIRST, AND UNCONDITIONALLY** (B6-4). Before the refusal below,
  // so a cursor this server cannot read is counted as `other` rather than
  // vanishing into a throw — the refusal rate is a signal, not noise. And before
  // the early return, so `absent` is counted too: without the denominator,
  // "integers are down 40%" could just as easily mean traffic is.
  logCursorForm(value, telemetry);
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (!isCursorToken(value)) throw new ChannelCursorUndecodableError();
  return decodeChannelCursor(value, scope, userId);
}
