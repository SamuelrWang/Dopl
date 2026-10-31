/**
 * THE PLAYGROUND'S OPERATIONS (P3, Plans/Dopl SDK Split › §6). Pure: shared by the page (form)
 * and the server route (dispatch), so the two can never disagree on a path or a parameter.
 *
 * One entry per openapi operation, keyed by its `operationId`; `playground-ops.test.ts` reads the
 * spec and fails when an operation is added there without a row here (or a row names a path the
 * spec does not have). Each spec operation is either a row or listed in `NOT_IN_PLAYGROUND` with
 * the reason.
 */
import type { HttpMethod } from "./playground-types";

export interface PlaygroundOp {
  id: string;
  label: string;
  method: HttpMethod;
  /** The openapi path, `{name}` placeholders included. */
  path: string;
  /** Placeholders in `path`, in order, with a starting value for the form. */
  pathParams: Array<{ name: string; example: string }>;
  /** Query params the form offers (all optional). */
  query: string[];
  /** A starting JSON body, or null for a bodiless call. */
  body: Record<string, unknown> | null;
  /** The body takes an `idempotency_key`; the server fills a fresh one when the form leaves it out. */
  idempotent: boolean;
  /** One line under the picker. */
  hint: string;
}

const USER = { name: "external_user_id", example: "usr_playground" };

export const PLAYGROUND_OPS: readonly PlaygroundOp[] = [
  {
    id: "createConnectSession",
    label: "Create a Connect session",
    method: "POST",
    path: "/connect_sessions",
    pathParams: [],
    query: [],
    body: { external_user_id: "usr_playground", requested_scopes: ["present.*", "ask.*"] },
    idempotent: false,
    hint: "Open the returned url to connect a simulated device to this test user.",
  },
  {
    id: "exchangePublicToken",
    label: "Exchange a public token",
    method: "POST",
    path: "/connections/exchange",
    pathParams: [],
    query: [],
    body: { public_token: "" },
    idempotent: false,
    hint: "Paste the public_token the Connect page redirected with.",
  },
  {
    id: "listConnections",
    label: "List connections",
    method: "GET",
    path: "/users/{external_user_id}/connections",
    pathParams: [USER],
    query: [],
    body: null,
    idempotent: false,
    hint: "Every connection this test user has.",
  },
  {
    id: "revokeConnection",
    label: "Revoke a connection",
    method: "DELETE",
    path: "/connections/{id}",
    pathParams: [{ name: "id", example: "" }],
    query: [],
    body: null,
    idempotent: false,
    hint: "The device stops receiving calls at once.",
  },
  {
    id: "getContext",
    label: "Get context",
    method: "GET",
    path: "/users/{external_user_id}/context",
    pathParams: [USER],
    query: [],
    body: null,
    idempotent: false,
    hint: "Which device is active, the posture and the matched profile.",
  },
  {
    id: "deliver",
    label: "Deliver",
    method: "POST",
    path: "/users/{external_user_id}/deliver",
    pathParams: [USER],
    query: [],
    body: { intent: "display", content: { text: "Hello from the playground" } },
    idempotent: true,
    hint: "Dopl picks the device. An ask holds up to 200 seconds for the answer.",
  },
  {
    id: "createDeviceAction",
    label: "Run a device action",
    method: "POST",
    path: "/devices/{device_id}/actions/{capability}",
    pathParams: [
      { name: "device_id", example: "" },
      { name: "capability", example: "present.notify" },
    ],
    query: [],
    body: { args: { title: "Hello from the playground" } },
    idempotent: true,
    hint: "Calls one capability on one device.",
  },
  {
    id: "getAction",
    label: "Get an action",
    method: "GET",
    path: "/actions/{id}",
    pathParams: [{ name: "id", example: "" }],
    query: [],
    body: null,
    idempotent: false,
    hint: "Pass a delivery_id or action_id to read its status and answer.",
  },
  {
    id: "getDevice",
    label: "Get a device",
    method: "GET",
    path: "/devices/{id}",
    pathParams: [{ name: "id", example: "" }],
    query: [],
    body: null,
    idempotent: false,
    hint: "The device and what it can do.",
  },
  {
    id: "listEvents",
    label: "List events",
    method: "GET",
    path: "/events",
    pathParams: [],
    query: ["limit", "cursor", "since", "outcome", "device_kind", "capability", "intent", "route"],
    body: null,
    idempotent: false,
    hint: "Your test request log. Needs a key with analytics:read.",
  },
];

/**
 * Spec operations deliberately absent, with why. Empty today; an operation that must not run from
 * a browser-driven form (for example one that mints or reveals a secret) goes here.
 */
export const NOT_IN_PLAYGROUND: Readonly<Record<string, string>> = {
  createWebhookEndpoint: "Answers the endpoint's signing secret; the playground never shows secrets.",
  rotateWebhookSecret: "Answers a new signing secret; the playground never shows secrets.",
  updateWebhookEndpoint: "Changes live webhook configuration; done from your server, read on the Webhooks page.",
  deleteWebhookEndpoint: "Deletes an endpoint and its delivery log; done from your server.",
  replayWebhookDelivery: "Sends a real outbound POST to your endpoint; done from your server or the API.",
  listWebhookEndpoints: "Read on the portal's Webhooks page.",
  getWebhookEndpoint: "Read on the portal's Webhooks page.",
  listWebhookDeliveries: "Read on the portal's Webhooks page.",
  getWebhookDelivery: "Read on the portal's Webhooks page.",
};

const BY_ID = new Map(PLAYGROUND_OPS.map((op) => [op.id, op]));

export function playgroundOp(id: string): PlaygroundOp | undefined {
  return BY_ID.get(id);
}

/** A path param value: what a route segment can hold. */
const PATH_VALUE = /^[A-Za-z0-9_.:@*-]{1,255}$/;

/**
 * The op's path with values filled and encoded, or an error sentence. Every placeholder must be
 * given and match `PATH_VALUE`; no other key is accepted.
 */
export function fillPath(op: PlaygroundOp, values: Record<string, string>): { ok: true; path: string } | { ok: false; message: string } {
  const allowed = new Set(op.pathParams.map((p) => p.name));
  for (const k of Object.keys(values)) if (!allowed.has(k)) return { ok: false, message: `Unknown path parameter ${k}.` };
  let path = op.path;
  for (const p of op.pathParams) {
    const v = values[p.name] ?? "";
    if (!PATH_VALUE.test(v)) return { ok: false, message: `Fill in ${p.name} (letters, digits and _ . : @ * - only).` };
    path = path.replace(`{${p.name}}`, encodeURIComponent(v));
  }
  return { ok: true, path };
}
