/**
 * D4: `show`, `ask` and `notify` are SDK methods, not routes. Each is one `deliver` call with the
 * matching intent; `ask` then polls `actions.get` on the delivery until it is answered, fails, or
 * the timeout passes.
 */
import type {
  Action,
  ChoiceOption,
  DeliverContent,
  DeliverResponse,
  DeliverTarget,
  DisplayBlock,
  Urgency,
} from "@dopl/contracts/device-sdk";

import type { DeliverParams, Dopl } from "./client.js";
import { DOC_BASE, DoplError } from "./errors.js";

interface DeliverCommon {
  urgency?: Urgency;
  /** `auto` (default when omitted), a device kind, or a device id. */
  target?: DeliverTarget;
  profile?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface ShowOptions extends DeliverCommon {
  text?: string;
  blocks?: DisplayBlock[];
}

export interface NotifyOptions extends DeliverCommon {
  text: string;
}

export interface AskOptions extends DeliverCommon {
  question: string;
  /** Choices; plain strings become `{ label }`. Omit for a free text or confirm answer. */
  options?: Array<ChoiceOption | string>;
  /** How long to wait for the answer. Default 200000 ms, the `ask.*` hold. */
  timeoutMs?: number;
  /** Delay between polls of `actions.get`. Default 1000 ms. */
  pollIntervalMs?: number;
}

export type AskResult =
  | { status: "answered"; answer: Record<string, unknown> | null; action: Action; delivery: DeliverResponse }
  | { status: "timeout"; action: Action | null; delivery: DeliverResponse };

export const ASK_DEFAULT_TIMEOUT_MS = 200_000;
export const ASK_DEFAULT_POLL_MS = 1_000;

function deliverParams(intent: DeliverParams["intent"], content: DeliverContent, o: DeliverCommon): DeliverParams {
  const params: DeliverParams = { intent, content, urgency: o.urgency ?? "normal" };
  if (o.target !== undefined) params.target = o.target;
  if (o.profile !== undefined) params.profile = o.profile;
  return params;
}

const reqOpts = (o: DeliverCommon) => ({ idempotencyKey: o.idempotencyKey, signal: o.signal });

export function show(dopl: Dopl, externalUserId: string, o: ShowOptions): Promise<DeliverResponse> {
  if (o.text === undefined && o.blocks === undefined) {
    throw new DoplError({
      type: "invalid_request_error",
      code: "invalid_request",
      message: "show needs text or blocks.",
      retryable: false,
      doc_url: `${DOC_BASE}invalid-request`,
    });
  }
  const content: DeliverContent = {};
  if (o.text !== undefined) content.text = o.text;
  if (o.blocks !== undefined) content.blocks = o.blocks;
  return dopl.users.deliver(externalUserId, deliverParams("display", content, o), reqOpts(o));
}

export function notify(dopl: Dopl, externalUserId: string, o: NotifyOptions): Promise<DeliverResponse> {
  return dopl.users.deliver(externalUserId, deliverParams("notify", { text: o.text }, o), reqOpts(o));
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export async function ask(dopl: Dopl, externalUserId: string, o: AskOptions): Promise<AskResult> {
  const content: DeliverContent = { text: o.question };
  if (o.options !== undefined) content.options = o.options.map((x) => (typeof x === "string" ? { label: x } : x));
  const delivery = await dopl.users.deliver(externalUserId, deliverParams("ask", content, o), reqOpts(o));

  const timeoutMs = o.timeoutMs ?? ASK_DEFAULT_TIMEOUT_MS;
  const pollMs = o.pollIntervalMs ?? ASK_DEFAULT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  let last: Action | null = null;

  for (;;) {
    last = await dopl.actions.get(delivery.delivery_id, { signal: o.signal });
    if (last.status === "done") return { status: "answered", answer: last.result, action: last, delivery };
    if (last.status === "failed") {
      if (last.error) throw DoplError.fromBody(last.error, null, null);
      throw new DoplError({
        type: "device_error",
        code: "vendor_error",
        message: "The ask failed without an error body.",
        retryable: false,
        doc_url: `${DOC_BASE}vendor-error`,
      });
    }
    const left = deadline - Date.now();
    if (left <= 0) return { status: "timeout", action: last, delivery };
    await sleep(Math.min(pollMs, left), o.signal);
  }
}
