/**
 * The device side of a `local_bridge` device: `/api/device-bridge/{poll,ack}`, device token.
 *
 *   poll: proves the bridge is alive (`devices.last_seen`), reports the speaker's real name once, and
 *         hands over what is still pending. Nothing moves yet, so a bridge that dies mid-cast loses nothing.
 *   ack:  the Cast outcome for one row. ok → the action is `delivered`, never `done`: Cast loaded the
 *         media, but nothing can report that the room heard it (PLAN step 14). Not ok → `failed` and
 *         `action.failed`. Each writes one `dev_events` row, because this is where the outcome is known.
 *
 * Pure over {@link BridgePort}; the real one is `bridge/port.ts`.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import type { GlassesMessage } from "@/features/glasses/core/messages/types";

export interface BridgeDevice {
  id: string;
  projectId: string;
  env: "test" | "live";
  endUserId: string;
  kind: "home_hub";
  lastSeen: string | null;
}

export interface BridgePort {
  /** The live `local_bridge` device behind this token hash, or null. 🔒 Never a G2: that lookup is separate. */
  deviceFromTokenHash(hash: string): Promise<BridgeDevice | null>;
  touch(deviceId: string, now: string): Promise<void>;
  /** What the speaker is really called, from the bridge's own discovery. */
  rename(deviceId: string, a: { name?: string; model?: string }): Promise<void>;
  /** Pending and unexpired, oldest first. */
  pending(deviceId: string, now: string): Promise<GlassesMessage[]>;
  /** pending → delivered. Null when the row is not this device's or was already acked. */
  take(deviceId: string, id: string, now: string): Promise<GlassesMessage | null>;
  /** Moves the action and writes its log row and webhook. */
  settle(device: BridgeDevice, row: GlassesMessage, a: { ok: boolean; error: string | null; at: string }): Promise<void>;
}

/** Above this age the next poll writes `last_seen` again. The online window is 60s; a poll comes every few. */
export const TOUCH_EVERY_MS = 20_000;

/** Decoration only: a name the schema refuses must never stop a bridge getting its messages. */
const PollSchema = z.object({ name: z.string().trim().min(1).max(64).optional(), model: z.string().trim().min(1).max(64).optional() });
const AckSchema = z.object({ id: z.uuid(), ok: z.boolean(), error: z.string().max(500).optional() });

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

function bearer(request: Request): string | null {
  const m = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

async function bodyOf(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** The one line a queued row speaks. */
export const bridgeMessageText = (row: GlassesMessage): string => ("body" in row.payload ? row.payload.body : "");

export function createBridgeHandlers(port: BridgePort, clock: () => number = Date.now) {
  const guarded = (label: string, fn: (request: Request, device: BridgeDevice) => Promise<Response>) => async (request: Request): Promise<Response> => {
    try {
      const token = bearer(request);
      const device = token ? await port.deviceFromTokenHash(hashOf(token)) : null;
      return device ? await fn(request, device) : reply({ error: "unauthorized" }, 401);
    } catch (err) {
      console.error(`[device-bridge] ${label} failed`, err);
      return reply({ error: `${label} failed` }, 500);
    }
  };

  return {
    poll: guarded("poll", async (request, device) => {
      const parsed = PollSchema.safeParse(await bodyOf(request));
      const identity = parsed.success ? parsed.data : {};
      const t = clock();
      const now = new Date(t).toISOString();
      const stale = device.lastSeen === null || t - Date.parse(device.lastSeen) >= TOUCH_EVERY_MS;
      await Promise.all([
        stale ? port.touch(device.id, now) : null,
        identity.name || identity.model ? port.rename(device.id, identity) : null,
      ]);
      const rows = await port.pending(device.id, now);
      return reply({ messages: rows.map((r) => ({ id: r.id, text: bridgeMessageText(r) })) });
    }),
    ack: guarded("ack", async (request, device) => {
      const parsed = AckSchema.safeParse(await bodyOf(request));
      if (!parsed.success) return reply({ error: "invalid body" }, 400);
      const at = new Date(clock()).toISOString();
      const row = await port.take(device.id, parsed.data.id, at);
      if (!row) return reply({ error: "not found" }, 404);
      await port.settle(device, row, { ok: parsed.data.ok, error: parsed.data.error ?? null, at });
      return reply({ ok: true });
    }),
  };
}
