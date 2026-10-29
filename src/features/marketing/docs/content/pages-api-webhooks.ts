import { json } from "./shared";
import type { EndpointSpec } from "./pages-api";

/**
 * API reference prose for the C8 webhook routes (`/v1/webhook_endpoints*`, `/v1/webhook_deliveries/*`).
 * Structure (method, path, params) is generated from openapi.yaml like every other page; this file
 * only adds titles, prose and examples. Spread into `pages-api.ts › ENDPOINTS`.
 */

const err400 = (message: string) => ({
  label: "400",
  code: json({
    error: { type: "invalid_request_error", code: "invalid_request", message, retryable: false, doc_url: "https://www.usedopl.com/docs/errors/invalid-request" },
  }),
});

const EP_ID = "7a1c3e5f-2b4d-4f60-8e9a-1c2b3d4e5f60";
const DL_ID = "0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b";
const SECRET = "whsec_EXAMPLEexampleEXAMPLEexampleEXAMPLE0000000="; // gitleaks:allow (documented fake)
const ENDPOINT = {
  id: EP_ID,
  url: "https://example.com/dopl/webhooks",
  description: "Production",
  enabled_events: null,
  status: "enabled",
  livemode: false,
  previous_secret_expires_at: null,
  created_at: "2026-10-28T09:00:00.000Z",
  updated_at: "2026-10-28T09:00:00.000Z",
};
const DELIVERY = {
  id: DL_ID,
  endpoint_id: EP_ID,
  message_id: `msg_${DL_ID}`,
  event_id: "evt_5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e",
  event_type: "action.completed",
  status: "delivered",
  attempt_count: 1,
  next_attempt_at: null,
  last_status_code: 200,
  last_error: null,
  delivered_at: "2026-10-28T09:05:01.000Z",
  created_at: "2026-10-28T09:05:00.000Z",
};

const ID_EP = { id: "The webhook endpoint." };
const ID_DL = { id: "The webhook delivery." };
const LIST = {
  cursor: "Opaque. The `next_cursor` of the previous page, passed back unchanged.",
  limit: "1 to 100. Default 50.",
};
const EVENTS = "Event names to send, such as `action.completed`. Omit or `null` for every event, including new ones.";
const KEY = "Any secret key of the project and environment.";

export const WEBHOOK_ENDPOINTS: EndpointSpec[] = [
  {
    op: "createWebhookEndpoint",
    slug: "webhook-endpoints-create",
    title: "Create a webhook endpoint",
    description: "Register an https URL to receive signed events",
    examplePath: "/webhook_endpoints",
    notes: [
      `The answer holds \`secret\`. Store it now: it is shown again only when you rotate it. Each event is a POST signed with the Standard Webhooks scheme. Check it with \`dopl.webhooks.unwrap(rawBody, headers, { secret })\`. ${KEY}`,
      "Answer with any 2xx within 15 seconds. Otherwise Dopl tries again after 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours and 10 hours. After 8 tries the delivery is `failed` until you replay it. Dedupe on the `webhook-id` header.",
    ],
    describe: {
      url: "An https URL on a public host.",
      description: "A label for you, up to 500 characters.",
      enabled_events: EVENTS,
    },
    requestBody: '{"url":"https://example.com/dopl/webhooks","description":"Production"}',
    response: json({ ...ENDPOINT, secret: SECRET }),
    error: err400("url: url must use https"),
  },
  {
    op: "listWebhookEndpoints",
    slug: "webhook-endpoints",
    title: "List webhook endpoints",
    description: "The project's endpoints, newest first",
    examplePath: "/webhook_endpoints?limit=20",
    notes: [`Never shows a secret. ${KEY}`],
    describe: LIST,
    response: json({ data: [ENDPOINT], next_cursor: null, has_more: false }),
  },
  {
    op: "getWebhookEndpoint",
    slug: "webhook-endpoint",
    title: "Get a webhook endpoint",
    description: "One endpoint, never its secret",
    examplePath: `/webhook_endpoints/${EP_ID}`,
    describe: ID_EP,
    response: json(ENDPOINT),
  },
  {
    op: "updateWebhookEndpoint",
    slug: "webhook-endpoint-update",
    title: "Update a webhook endpoint",
    description: "Change the URL or events, or turn the endpoint off and on",
    examplePath: `/webhook_endpoints/${EP_ID}`,
    describe: {
      ...ID_EP,
      url: "A new https URL, checked like on create.",
      description: "A new label.",
      enabled_events: EVENTS,
      disabled: "`true` stops sending, and waiting deliveries fail. `false` turns it back on.",
    },
    requestBody: '{"disabled":true}',
    response: json({ ...ENDPOINT, status: "disabled" }),
  },
  {
    op: "deleteWebhookEndpoint",
    slug: "webhook-endpoint-delete",
    title: "Delete a webhook endpoint",
    description: "Remove an endpoint and its delivery log",
    examplePath: `/webhook_endpoints/${EP_ID}`,
    describe: ID_EP,
    response: json({ id: EP_ID, deleted: true }),
  },
  {
    op: "rotateWebhookSecret",
    slug: "webhook-endpoint-rotate-secret",
    title: "Rotate a signing secret",
    description: "Get a new secret, keep the old one for a while",
    examplePath: `/webhook_endpoints/${EP_ID}/rotate_secret`,
    notes: ["While both secrets are live, each POST carries two signatures. A check with either secret passes."],
    describe: {
      ...ID_EP,
      overlap_seconds: "How long the old secret still signs next to the new one. Default 86400 (one day), 0 drops it now, at most 604800.",
    },
    requestBody: '{"overlap_seconds":3600}',
    response: json({ ...ENDPOINT, secret: SECRET, previous_secret_expires_at: "2026-10-28T10:00:00.000Z" }),
  },
  {
    op: "listWebhookDeliveries",
    slug: "webhook-deliveries",
    title: "List deliveries",
    description: "An endpoint's deliveries, newest first",
    examplePath: `/webhook_endpoints/${EP_ID}/deliveries`,
    describe: { ...ID_EP, ...LIST },
    response: json({ data: [DELIVERY], next_cursor: null, has_more: false }),
  },
  {
    op: "getWebhookDelivery",
    slug: "webhook-delivery",
    title: "Get a delivery",
    description: "One delivery with every try",
    examplePath: `/webhook_deliveries/${DL_ID}`,
    notes: ["`attempts` lists each HTTP try, newest first, with the status code or error and the first 1 KiB of your answer."],
    describe: ID_DL,
    response: json({
      ...DELIVERY,
      attempts: [{ attempt: 1, attempted_at: "2026-10-28T09:05:01.000Z", status_code: 200, error: null, duration_ms: 84, response_body: "ok" }],
    }),
  },
  {
    op: "replayWebhookDelivery",
    slug: "webhook-delivery-replay",
    title: "Replay a delivery",
    description: "Send a delivery again now",
    examplePath: `/webhook_deliveries/${DL_ID}/replay`,
    notes: ["It gets 8 new tries and keeps the same `webhook-id`. Turn a disabled endpoint back on first."],
    describe: ID_DL,
    response: json({ ...DELIVERY, status: "pending", attempt_count: 0, next_attempt_at: "2026-10-28T11:00:00.000Z", delivered_at: null }),
    error: err400("The delivery's endpoint is disabled. Enable it before replaying."),
  },
];
