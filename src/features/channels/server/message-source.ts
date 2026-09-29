import "server-only";
import type { NextRequest } from "next/server";
import { DESKTOP_UI_RUNTIME } from "@/shared/auth/runtime-header";
import { computerName, requestComputer } from "@/features/devices/server/devices-service";
import { devicesDeps, requestInstallId } from "@/features/devices/server/runtime";
import type { ChannelContext } from "./service-shared";
import { UNREGISTERED_COMPUTER, WEB_SOURCE, type MessageSourceStamp } from "./message-source-stamp";

/**
 * **WHICH DEVICE A MEMBER POSTED FROM** — reserved `metadata.source`
 * (docs/specs/device-aware-messages.md). ONE place decides it:
 *   - glasses doors (push-to-talk, Hey Even) → `message-source-stamp.ts › glassesMessageSource`;
 *   - an HTTP post → {@link requestMessageSource} (a registered computer off `X-Dopl-Device`,
 *     the desktop UI without one, else the web).
 * It rides `ChannelContext.messageSource` and `service-writes.ts › postMessage` stamps it on a
 * MEMBER post only; the metadata fold strips any caller copy, so it cannot be posed.
 */

/**
 * The source of an HTTP member post. ⚠ Never throws: a lookup failure is a post from an
 * unknown computer, not a refused post. `runtime` is the NARROWED `X-Dopl-Runtime`.
 */
export async function requestMessageSource(
  request: NextRequest,
  userId: string,
  runtime: string | undefined
): Promise<MessageSourceStamp> {
  const installId = requestInstallId(request);
  if (installId) {
    try {
      const row = await requestComputer(devicesDeps, userId, installId);
      if (row) return { kind: "computer", device_id: row.id, label: computerName(row), platform: row.platform };
    } catch (err) {
      console.error("[channels] message source lookup failed", err);
    }
  }
  return installId || runtime === DESKTOP_UI_RUNTIME ? UNREGISTERED_COMPUTER : WEB_SOURCE;
}

/**
 * `ctx` with the member's device attached — the one call every HTTP member-post door makes. An
 * agent credential, or a post claiming an agent author, carries no source and costs no read.
 */
export async function withMessageSource<C extends ChannelContext>(
  ctx: C,
  request: NextRequest,
  claimsAgent = false
): Promise<C> {
  if (ctx.source === "agent" || claimsAgent) return ctx;
  return { ...ctx, messageSource: await requestMessageSource(request, ctx.userId, ctx.runtime) };
}
