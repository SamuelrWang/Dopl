/**
 * VENDORED COPY of dopl-sdk `packages/sdk/src/webhooks/index.ts` at dopl-sdk 4f3f555, used ONLY by
 * tests: the sender's output must verify with the SDK's own `unwrap`. Changes vs the source: the
 * three imports are replaced with local stand-ins (types loosened, same error class name).
 * `sdk-verifier-sync.test.ts` fails when the source moves and this copy was not refreshed.
 */
type Action = Record<string, unknown>;
type Connection = Record<string, unknown>;
type WebhookEventName = string;
export class WebhookVerificationError extends Error {}
const readEnv = (name: string): string | undefined => process.env[name];
// ---- source below (imports removed) ----
/**
 * Webhook verification on the Standard Webhooks scheme (https://www.standardwebhooks.com/):
 * headers `webhook-id`, `webhook-timestamp` and `webhook-signature`; the signature is
 * `v1,<base64 HMAC-SHA256>` over `${id}.${timestamp}.${rawBody}`, keyed with the base64 part of a
 * `whsec_...` secret. Uses Web Crypto only, so it runs on Node, edge runtimes, Deno and Bun.
 *
 * Always verify the RAW request body, exactly as received. Parsing and re-serialising JSON changes
 * the bytes and breaks the signature.
 */


/** Default tolerance between the webhook timestamp and now, in seconds. */
export const DEFAULT_WEBHOOK_TOLERANCE_S = 300;

export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;

export interface VerifyOptions {
  /** The endpoint's signing secret (`whsec_...`). Defaults to the `DOPL_WEBHOOK_SECRET` environment variable. */
  secret?: string;
  /** Allowed clock skew in seconds, both directions. Default 300. */
  tolerance?: number;
  /** Override "now" (Unix seconds). For tests. */
  now?: number;
}

/**
 * A verified webhook event, narrowed by `type`. New event types can appear at any time: handle the
 * ones you know and ignore the rest (a `default` branch), never throw on an unknown `type`.
 */
export type DoplEvent =
  | WebhookEvent<"action.completed" | "action.failed", Action>
  | WebhookEvent<"connection.created" | "connection.revoked" | "connection.needs_reauth", Connection>
  | WebhookEvent<Exclude<WebhookEventName, `action.${string}` | `connection.${string}`>, Record<string, unknown>>;

export interface WebhookEvent<Type extends string, Data> {
  /** The event name, for example `action.completed`. Tolerate names you do not know. */
  type: Type;
  /** ISO 8601 time the event happened, when the server sends it. */
  timestamp?: string;
  data: Data;
  /** The `webhook-id` header: unique per event, stable across redeliveries. Use it to deduplicate. */
  webhookId: string;
}

const encoder = new TextEncoder();

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? undefined;
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  const value = key === undefined ? undefined : record[key];
  return Array.isArray(value) ? value[0] : value;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function secretBytes(secret: string | undefined): Uint8Array {
  const value = secret ?? readEnv("DOPL_WEBHOOK_SECRET");
  if (!value) throw new WebhookVerificationError("Missing webhook secret. Pass { secret } or set DOPL_WEBHOOK_SECRET.");
  const b64 = value.startsWith("whsec_") ? value.slice("whsec_".length) : value;
  try {
    return base64ToBytes(b64);
  } catch {
    throw new WebhookVerificationError("The webhook secret is not valid base64.");
  }
}

async function hmac(key: Uint8Array, content: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, content as BufferSource));
}

/** Constant-time comparison for equal-length inputs. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/** `${id}.${timestamp}.` followed by the payload's exact bytes: a binary body is signed as received. */
function signedContent(id: string, timestamp: string, payload: string | Uint8Array): Uint8Array {
  const prefix = encoder.encode(`${id}.${timestamp}.`);
  const body = typeof payload === "string" ? encoder.encode(payload) : payload;
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix, 0);
  out.set(body, prefix.length);
  return out;
}

const toText = (payload: string | Uint8Array): string =>
  typeof payload === "string" ? payload : new TextDecoder().decode(payload);

/**
 * Check the signature and timestamp of a webhook. Throws {@link WebhookVerificationError} when
 * anything is off; resolves with nothing when the payload is authentic.
 */
export async function verify(
  payload: string | Uint8Array,
  headers: WebhookHeaders,
  options: VerifyOptions = {},
): Promise<void> {
  const id = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signatures = header(headers, "webhook-signature");
  if (!id || !timestamp || !signatures) {
    throw new WebhookVerificationError("Missing webhook-id, webhook-timestamp or webhook-signature header.");
  }

  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) throw new WebhookVerificationError("Invalid webhook-timestamp header.");
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.tolerance ?? DEFAULT_WEBHOOK_TOLERANCE_S;
  if (now - ts > tolerance) throw new WebhookVerificationError("Webhook timestamp is too old.");
  if (ts - now > tolerance) throw new WebhookVerificationError("Webhook timestamp is in the future.");

  const expected = await hmac(secretBytes(options.secret), signedContent(id, timestamp, payload));
  for (const candidate of signatures.split(" ")) {
    const [version, sig] = candidate.split(",", 2);
    if (version !== "v1" || !sig) continue;
    let given: Uint8Array;
    try {
      given = base64ToBytes(sig);
    } catch {
      continue;
    }
    if (timingSafeEqual(given, expected)) return;
  }
  throw new WebhookVerificationError("No matching webhook signature.");
}

/**
 * Verify a webhook, then parse it into a typed {@link DoplEvent}. Unknown event types and extra
 * fields pass through untouched.
 */
export async function unwrap(
  payload: string | Uint8Array,
  headers: WebhookHeaders,
  options: VerifyOptions = {},
): Promise<DoplEvent> {
  await verify(payload, headers, options);
  let body: unknown;
  try {
    body = JSON.parse(toText(payload));
  } catch {
    throw new WebhookVerificationError("Webhook payload is not valid JSON.");
  }
  if (typeof body !== "object" || body === null || typeof (body as { type?: unknown }).type !== "string") {
    throw new WebhookVerificationError("Webhook payload has no event type.");
  }
  return { ...(body as Record<string, unknown>), webhookId: header(headers, "webhook-id") as string } as DoplEvent;
}

export interface SignInput {
  payload: string | Uint8Array;
  secret: string;
  /** Defaults to a random id. */
  id?: string;
  /** Unix seconds. Defaults to now. */
  timestamp?: number;
}

/** Produce the three Standard Webhooks headers for a payload. Use it to test your webhook handler. */
export async function sign(
  input: SignInput,
): Promise<Record<"webhook-id" | "webhook-timestamp" | "webhook-signature", string>> {
  const id = input.id ?? `msg_${crypto.randomUUID()}`;
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  const sig = await hmac(secretBytes(input.secret), signedContent(id, timestamp, input.payload));
  return { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${bytesToBase64(sig)}` };
}

/** `dopl.webhooks`: the same functions, bound to the client. */
export class Webhooks {
  verify = verify;
  unwrap = unwrap;
  sign = sign;
}
