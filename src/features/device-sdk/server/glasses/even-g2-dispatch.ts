/**
 * The `even_g2` adapter's DELIVERY (A8): a validated capability call → a row on the SDK device's own
 * lens queue (`dev_device_messages`, the `GlassesStore` contract keyed by the SDK device id), which the
 * plugin reads through the same device routes, inbox and answer code as a prosumer G2.
 *
 * Rendering is the prosumer's: `display/core/degrade.ts › toLensPrimitives` (v2 blocks → the G2
 * primitives) and the platform compiler (`platforms/even-g2 › compileScreen`), the notify / ask card
 * budgets of `glasses/core/validation.ts › GLASSES_LIMITS` (which the adapter's descriptors are derived
 * from). 🔒 D3: CONTENT IS NEVER REWRITTEN. Only degradation level 0 is compiled (the ladder's later
 * levels drop rows and notes), and content that does not fit is refused as `invalid_request`, never
 * shortened here — truncation is the delivery layer's job (`delivery/enforce.ts`). The one transform
 * is the platform's glyph fold (`sanitizeText`: curly quotes → straight, emoji dropped), which is the
 * descriptor's declared `charset` ("ascii+box"), not an edit of the words.
 *
 * Pure over its deps (store, clock, platform, id source), so suites drive it with the in-memory store.
 */
import { randomUUID } from "node:crypto";

import { toLensPrimitives } from "@/features/display/core/degrade";
import type { DisplayBlock, Positioned } from "@/features/display/core/types";
import { DEFAULT_PLATFORM } from "@/features/glasses/platforms/registry";
import type { GlassesPlatform } from "@/features/glasses/platforms/types";
import type { GlassesStore, NewGlassesMessage } from "@/features/glasses/core/messages/types";
import { GLASSES_LIMITS as L, utf8Bytes } from "@/features/glasses/core/validation";

import { failed, type Dispatcher } from "../../adapters/shared";
import type { ActionResult, Device } from "../../types";

/** Lens lifetimes. A notice is brief (the prosumer `glasses_notify` default); asks and screens wait. */
export const SDK_NOTIFY_TTL_S = 60;
export const SDK_SCREEN_TTL_S = 600;
export const SDK_ASK_TTL_S = 600;

export interface EvenG2DispatchDeps {
  /** The SDK lens queue; the first argument of every call is the SDK DEVICE id. */
  store: GlassesStore;
  now?: () => number;
  platform?: GlassesPlatform;
  /** Screen ids (`card_id`); random by default. */
  newId?: () => string;
}

class Refusal extends Error {}
const refuse = (message: string): never => {
  throw new Refusal(message);
};

/** The platform's glyph fold, then a non-empty + byte check against the card budget. Never cut. */
function field(platform: GlassesPlatform, label: string, value: unknown, maxBytes: number, required = true): string {
  if (value === undefined || value === null) {
    if (required) refuse(`${label} is required`);
    return "";
  }
  if (typeof value !== "string") return refuse(`${label} must be a string`);
  const text = platform.sanitizeText(value);
  if (required && !text) refuse(`${label} is empty after folding to the lens charset`);
  const bytes = utf8Bytes(text);
  if (bytes > maxBytes) refuse(`${label} is ${bytes} bytes; this device shows at most ${maxBytes}`);
  return text;
}

const optionLabel = (o: unknown): unknown => (o && typeof o === "object" ? (o as { label?: unknown }).label : o);

export function createEvenG2Dispatcher(deps: EvenG2DispatchDeps): Dispatcher {
  const platform = deps.platform ?? DEFAULT_PLATFORM;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => `sdk-${randomUUID()}`);

  const enqueue = async (device: Device, row: Omit<NewGlassesMessage, "now" | "expires_at">, ttlS: number): Promise<ActionResult> => {
    const t = now();
    const msg = await deps.store.insert(device.id, {
      ...row,
      now: new Date(t).toISOString(),
      expires_at: new Date(t + ttlS * 1000).toISOString(),
    });
    // Queued until the glasses' inbox picks it up (→ delivered); an ask settles on the wearer's answer.
    return { status: "queued", result: { lens_message_id: msg.id }, error: null };
  };

  const screen = async (device: Device, blocks: unknown): Promise<ActionResult> => {
    if (!Array.isArray(blocks) || blocks.length === 0) return refuse("blocks must be a non-empty array");
    if ((blocks as Array<{ type?: unknown }>).some((b) => b?.type === "image")) refuse("even_g2 cannot show image blocks");
    const typed = blocks as Positioned<DisplayBlock>[];
    const primitives = toLensPrimitives(typed, { mode: "screen", level: 0, itemBytes: platform.screenLimits.list_item_bytes });
    const id = newId();
    const res = platform.compileScreen({ blocks: primitives.blocks, layout: "stack" }, id);
    if (!res.ok) {
      const e = res.errors[0];
      return refuse(`blocks do not fit the G2 lens: ${e ? `${e.block ? `${e.block}: ` : ""}${e.message}` : "layout failed"}`);
    }
    return enqueue(device, { kind: "screen", card_id: id, payload: res.payload, spec: { blocks: typed, layout: "stack" } }, SDK_SCREEN_TTL_S);
  };

  return async (device, capability, args) => {
    try {
      switch (capability) {
        case "presence.read":
          return { status: "done", result: { online: device.online, last_seen_at: device.last_seen_at }, error: null };
        case "present.notify": {
          const body = field(platform, "body", args.body === "" ? undefined : args.body, L.body, args.blocks === undefined);
          if (!body) return await screen(device, args.blocks);
          const title = field(platform, "title", args.title, L.title, false);
          return await enqueue(device, { kind: "notify", card_id: null, payload: { title, body } }, SDK_NOTIFY_TTL_S);
        }
        case "present.display":
          return await screen(device, args.blocks);
        case "ask.choice": {
          const question = field(platform, "question", args.question, L.question);
          const raw = Array.isArray(args.options) ? args.options : refuse("options must be an array");
          if (raw.length < L.options.min || raw.length > L.options.max) {
            refuse(`options has ${raw.length} entries; this device shows ${L.options.min}-${L.options.max}`);
          }
          const options = raw.map((o, i) => field(platform, `options[${i}].label`, optionLabel(o), L.option));
          return await enqueue(device, { kind: "ask", card_id: null, payload: { question, options } }, SDK_ASK_TTL_S);
        }
        default:
          // input.* are events the device sends (C8), not calls; nothing else is in the G2 descriptor.
          return failed("capability_unsupported", `even_g2 cannot run ${capability} as an action`, device.kind);
      }
    } catch (err) {
      if (err instanceof Refusal) return failed("invalid_request", `even_g2: ${err.message}`, device.kind);
      throw err;
    }
  };
}
