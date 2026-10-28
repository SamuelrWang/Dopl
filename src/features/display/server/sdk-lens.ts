import "server-only";
import { Dopl, DoplError, type DeliverResponse, type DisplayBlock as SdkBlock } from "@dopl/sdk";
import { sdkDeliveryFor } from "@/features/device-sdk/server/sdk-delivery-flag";
import type { DisplayBlock, Positioned } from "../core/types";

/**
 * **THE LENS COPY OVER `@dopl/sdk`** (Plan "Dopl SDK Split" §7.1, W1.2). For a Dopl user whose
 * `sdk_delivery` flag is on, the display seam reaches their glasses the way any developer would: the
 * app backend calls `/api/v1` with the Dopl App project's secret key (`DOPL_APP_SDK_KEY`, SERVER ONLY;
 * the desktop and the browser never hold it), `external_user_id` = the Dopl user id. Every call shows
 * in the developer portal's log, and is timed here (`[display] {"evt":"sdk_lens",…}`).
 *
 * FAILURE CLASSES (the caller acts on {@link SdkLensError.fallback}):
 *   - fallback: the SDK path is UNAVAILABLE (no key, flag lookup failed, network, HTTP 5xx, key
 *     refused). Nothing reached the device, so the caller takes the prosumer lens path, which a
 *     migrated G2 still reads through its legacy token (`device-handlers.ts › mergedQueue`).
 *   - refusal: the SDK ANSWERED no (device offline, content refused, rate limited) or our timeout hit
 *     (the call may have landed). The caller reports `skipped:sdk <code>`; never a second copy.
 */

/** A context / connections / show call that takes longer is abandoned (the ask has its own hold). */
export const SDK_CALL_TIMEOUT_MS = 10_000;

export interface LensDevices {
  paired: boolean;
  online: boolean;
}

export type SdkAskOutcome =
  | { status: "answered"; index: number; label: string; deviceId: string | null; ms: number }
  | { status: "dismissed"; deviceId: string | null; ms: number }
  | { status: "timeout" | "aborted"; ms: number }
  | { status: "refused"; code: string; ms: number };

export class SdkLensError extends Error {
  constructor(
    readonly code: string,
    /** True: the SDK path is unavailable and nothing was delivered; take the prosumer path. */
    readonly fallback: boolean,
  ) {
    super(`sdk lens: ${code}`);
    this.name = "SdkLensError";
  }
}

/** One user's lens over the SDK. */
export interface SdkUserLens {
  state(): Promise<LensDevices>;
  screen(a: { blocks: Positioned<DisplayBlock>[]; idempotencyKey: string }): Promise<DeliverResponse>;
  /** Starts the ask; the promise holds until the wearer answers, dismisses, or `timeoutMs` passes. Never rejects. */
  ask(a: { question: string; options: string[]; timeoutMs: number; idempotencyKey: string; signal?: AbortSignal }): Promise<SdkAskOutcome>;
}

export interface SdkLens {
  /** The user's SDK lens when their flag is on; null when off. Throws {@link SdkLensError} (fallback). */
  forUser(userId: string): Promise<SdkUserLens | null>;
}

const log = (fields: Record<string, unknown>) => console.info("[display] " + JSON.stringify({ evt: "sdk_lens", ...fields }));

/** Which class an SDK failure falls in. `timedOut`: OUR timeout fired, so the call may have landed. */
export function classify(err: unknown, timedOut = false): SdkLensError {
  if (timedOut) return new SdkLensError("timeout", false);
  if (!(err instanceof DoplError)) return new SdkLensError("error", true);
  if (err.code === "network_error") return new SdkLensError("network_error", true);
  if (err.status !== null && err.status >= 500) return new SdkLensError(String(err.code), true);
  if (err.type === "authentication_error" || err.type === "permission_error") return new SdkLensError(String(err.code), true);
  return new SdkLensError(String(err.code), false);
}

/** Positions (`x`/`y`/`w`/`h`) are the app's absolute layout; the contract's blocks are a stack. */
export function toSdkBlocks(blocks: Positioned<DisplayBlock>[]): SdkBlock[] {
  return blocks.map((b) => {
    const rest: Record<string, unknown> = { ...b };
    for (const k of ["x", "y", "w", "h"]) delete rest[k];
    return rest as SdkBlock;
  });
}

/** Time one SDK call, log it, and map any failure to {@link SdkLensError}. */
async function timed<T>(op: string, fn: (signal: AbortSignal) => Promise<T>, extra: (r: T) => Record<string, unknown> = () => ({})): Promise<T> {
  const started = Date.now();
  const timeout = AbortSignal.timeout(SDK_CALL_TIMEOUT_MS);
  try {
    const r = await fn(timeout);
    log({ op, ms: Date.now() - started, outcome: "ok", ...extra(r) });
    return r;
  } catch (err) {
    const e = classify(err, timeout.aborted);
    log({ op, ms: Date.now() - started, outcome: e.code, fallback: e.fallback });
    throw e;
  }
}

/** An SDK lens for one user, over a ready client. Exported for the round-trip suite. */
export function sdkUserLens(dopl: Dopl, userId: string): SdkUserLens {
  return {
    async state() {
      try {
        const ctx = await timed("context", (signal) => dopl.users.context(userId, { signal }));
        if (ctx.available.some((d) => d.kind === "glasses")) return { paired: true, online: true };
        const list = await timed("connections", (signal) => dopl.connections.list(userId, { signal }));
        return { paired: list.data.some((c) => c.status === "active" && c.device.kind === "glasses"), online: false };
      } catch (err) {
        // No end user yet under the Dopl App project = nothing paired through the SDK.
        if (err instanceof SdkLensError && err.code === "not_found") return { paired: false, online: false };
        throw err;
      }
    },

    screen({ blocks, idempotencyKey }) {
      return timed(
        "show",
        (signal) => dopl.show(userId, { blocks: toSdkBlocks(blocks), target: "glasses", idempotencyKey, signal }),
        (r) => ({ delivery_id: r.delivery_id, status: r.status }),
      );
    },

    async ask({ question, options, timeoutMs, idempotencyKey, signal }) {
      const started = Date.now();
      const ms = () => Date.now() - started;
      let out: SdkAskOutcome;
      try {
        const r = await dopl.ask(userId, { question, options, target: "glasses", timeoutMs, idempotencyKey, signal, pollIntervalMs: 2_000 });
        const deviceId = r.delivery.routed_to?.device_id ?? null;
        const a = (r.status === "answered" ? r.answer : null) ?? {};
        if (r.status !== "answered") out = { status: "timeout", ms: ms() };
        else if (a.dismissed === true) out = { status: "dismissed", deviceId, ms: ms() };
        else if (typeof a.index === "number" && typeof a.label === "string") out = { status: "answered", index: a.index, label: a.label, deviceId, ms: ms() };
        else out = { status: "refused", code: "unexpected_answer", ms: ms() };
      } catch (err) {
        out = signal?.aborted ? { status: "aborted", ms: ms() } : { status: "refused", code: classify(err).code, ms: ms() };
      }
      log({ op: "ask", ms: out.ms, outcome: out.status === "refused" ? out.code : out.status });
      return out;
    },
  };
}

let warnedNoKey = false;

/** Production: the `sdk_delivery` flag (W1.1) and the Dopl App client from the server env. */
export function createSdkLens(env: { key?: string; baseUrl?: string } = {}): SdkLens {
  let client: Dopl | null = null;
  return {
    async forUser(userId) {
      let on: boolean;
      try {
        on = (await sdkDeliveryFor(userId)).on;
      } catch (err) {
        console.error("[display] sdk_delivery lookup failed; prosumer lens path", err);
        throw new SdkLensError("flag_lookup_failed", true);
      }
      if (!on) return null;
      const key = env.key ?? process.env.DOPL_APP_SDK_KEY;
      if (!key) {
        if (!warnedNoKey) console.error("[display] sdk_delivery is on but DOPL_APP_SDK_KEY is not set; prosumer lens path");
        warnedNoKey = true;
        throw new SdkLensError("no_key", true);
      }
      client ??= new Dopl({ apiKey: key, ...((env.baseUrl ?? process.env.DOPL_APP_SDK_BASE_URL) && { baseUrl: env.baseUrl ?? process.env.DOPL_APP_SDK_BASE_URL }) });
      return sdkUserLens(client, userId);
    },
  };
}
