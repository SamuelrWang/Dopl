import { createHmac, randomBytes } from "node:crypto";

/**
 * Standard Webhooks signing (https://www.standardwebhooks.com/), the scheme `@dopl/sdk`'s
 * `webhooks.unwrap` verifies:
 *
 *   webhook-id:        msg_<delivery uuid>   stable across retries and replays (dedupe key)
 *   webhook-timestamp: unix seconds of THIS attempt
 *   webhook-signature: v1,<base64 HMAC-SHA256(key, `${id}.${timestamp}.${body}`)>
 *
 * The key is the base64 part of the `whsec_…` secret, decoded. During a secret rotation overlap the
 * header carries one `v1,` signature per live secret, space-separated (new first); a verifier
 * accepts any one of them.
 */

export const WEBHOOK_SECRET_PREFIX = "whsec_";
/** Secret entropy in bytes (Standard Webhooks: 24–64). */
export const WEBHOOK_SECRET_BYTES = 32;

/** A fresh endpoint secret: `whsec_` + base64 of 32 random bytes. Shown once (create / rotate). */
export function generateWebhookSecret(): string {
  return WEBHOOK_SECRET_PREFIX + randomBytes(WEBHOOK_SECRET_BYTES).toString("base64");
}

function secretKey(secret: string): Buffer {
  if (!secret.startsWith(WEBHOOK_SECRET_PREFIX)) throw new Error("webhook secret must start with whsec_");
  const key = Buffer.from(secret.slice(WEBHOOK_SECRET_PREFIX.length), "base64");
  if (key.length < 24) throw new Error("webhook secret is too short");
  return key;
}

/** `v1,<base64 sig>` for one secret. */
export function signatureFor(secret: string, id: string, timestamp: number, body: string): string {
  const mac = createHmac("sha256", secretKey(secret)).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${mac}`;
}

export type WebhookHeaders = Record<"webhook-id" | "webhook-timestamp" | "webhook-signature", string>;

/**
 * The three Standard Webhooks headers for one attempt. `secrets` = the live secrets, current first;
 * empty is a bug (an endpoint always has a current secret) and throws.
 */
export function signWebhook(input: {
  id: string;
  timestamp: number;
  body: string;
  secrets: readonly string[];
}): WebhookHeaders {
  if (input.secrets.length === 0) throw new Error("signWebhook: no secret");
  if (!Number.isInteger(input.timestamp)) throw new Error("signWebhook: timestamp must be integer seconds");
  const signature = input.secrets.map((s) => signatureFor(s, input.id, input.timestamp, input.body)).join(" ");
  return {
    "webhook-id": input.id,
    "webhook-timestamp": String(input.timestamp),
    "webhook-signature": signature,
  };
}

/** `webhook-id` for a delivery row. */
export const webhookMessageId = (deliveryId: string): string => `msg_${deliveryId}`;
