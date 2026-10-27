/**
 * `new Dopl({ apiKey, baseUrl? })`: one method per route in `docs/specs/device-sdk/openapi.yaml`,
 * plus the `show` / `ask` / `notify` helpers over `deliver` (D4). Request and response types come
 * from `@dopl/contracts/device-sdk` (type imports only, so nothing of the server ships here).
 *
 * The route table is {@link ROUTES}; `openapi-drift.test.ts` fails when the spec gains a path or
 * method this client lacks.
 */
import type {
  Action,
  CapabilityId,
  Connection,
  ConnectionExchangeRequest,
  ConnectionExchangeResponse,
  ConnectionListResponse,
  ConnectSessionCreateRequest,
  ConnectSessionCreateResponse,
  DeliverRequest,
  DeliverResponse,
  Device,
  DeviceActionResponse,
  DeviceContext,
} from "@dopl/contracts/device-sdk";

import { DOC_BASE, DoplError } from "./errors.js";
import { createTransport, seg, type FetchLike, type Transport } from "./http.js";
import { ask, notify, show, type AskOptions, type AskResult, type NotifyOptions, type ShowOptions } from "./helpers.js";

export interface DoplOptions {
  /** A secret key (`sk_test_` / `sk_live_`), or a publishable `pk_` key for `connectSessions.create` only. */
  apiKey: string;
  /** Defaults to {@link DEFAULT_BASE_URL}. Point it at a local server or the simulator host. */
  baseUrl?: string;
  /** Inject a fetch (tests, custom agents). Defaults to the global fetch. */
  fetch?: FetchLike;
  /** Extra headers sent on every request. */
  headers?: Record<string, string>;
}

export interface RequestOptions {
  /** Sent as the `Idempotency-Key` header; on routes whose body carries `idempotency_key` it fills that too. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** `deliver` body: `idempotency_key` is optional here; the SDK fills one when absent. */
export type DeliverParams = Omit<DeliverRequest, "idempotency_key" | "urgency"> &
  Partial<Pick<DeliverRequest, "idempotency_key" | "urgency">>;

/** Every openapi operation, keyed by the SDK method that serves it. */
export const ROUTES = {
  "connectSessions.create": { method: "POST", path: "/connect_sessions" },
  "connections.exchange": { method: "POST", path: "/connections/exchange" },
  "connections.list": { method: "GET", path: "/users/{external_user_id}/connections" },
  "connections.revoke": { method: "DELETE", path: "/connections/{id}" },
  "users.context": { method: "GET", path: "/users/{external_user_id}/context" },
  "users.deliver": { method: "POST", path: "/users/{external_user_id}/deliver" },
  "devices.action": { method: "POST", path: "/devices/{device_id}/actions/{capability}" },
  "devices.get": { method: "GET", path: "/devices/{id}" },
  "actions.get": { method: "GET", path: "/actions/{id}" },
} as const;

export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `idk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Body key and header key must match (openapi `IdempotencyKey`); one is filled from the other. */
function resolveKey(bodyKey: string | undefined, optKey: string | undefined): string {
  if (bodyKey !== undefined && optKey !== undefined && bodyKey !== optKey) {
    throw new DoplError({
      type: "invalid_request_error",
      code: "invalid_request",
      message: "idempotency_key in the body and the idempotencyKey option differ. Pass one, or the same value.",
      retryable: false,
      doc_url: `${DOC_BASE}idempotency-conflict`,
    });
  }
  return optKey ?? bodyKey ?? newIdempotencyKey();
}

export class Dopl {
  readonly connectSessions: {
    create(body: ConnectSessionCreateRequest, opts?: RequestOptions): Promise<ConnectSessionCreateResponse>;
  };
  readonly connections: {
    exchange(body: ConnectionExchangeRequest, opts?: RequestOptions): Promise<ConnectionExchangeResponse>;
    list(externalUserId: string, opts?: RequestOptions): Promise<ConnectionListResponse>;
    revoke(connectionId: string, opts?: RequestOptions): Promise<Connection>;
  };
  readonly users: {
    context(externalUserId: string, opts?: RequestOptions): Promise<DeviceContext>;
    deliver(externalUserId: string, body: DeliverParams, opts?: RequestOptions): Promise<DeliverResponse>;
  };
  readonly devices: {
    get(deviceId: string, opts?: RequestOptions): Promise<Device>;
    action(
      deviceId: string,
      capability: CapabilityId,
      args?: Record<string, unknown>,
      opts?: RequestOptions,
    ): Promise<DeviceActionResponse>;
  };
  readonly actions: {
    get(actionId: string, opts?: RequestOptions): Promise<Action>;
  };

  constructor(options: DoplOptions) {
    // The key is captured by the transport closure and never stored on `this`, so logging or
    // inspecting the client cannot print it.
    const request: Transport = createTransport(options);

    this.connectSessions = {
      create: (body, opts) =>
        request({
          method: "POST",
          path: "/connect_sessions",
          body,
          idempotencyKey: opts?.idempotencyKey,
          allowPublishable: true,
          signal: opts?.signal,
        }),
    };
    this.connections = {
      exchange: (body, opts) =>
        request({
          method: "POST",
          path: "/connections/exchange",
          body,
          idempotencyKey: opts?.idempotencyKey,
          signal: opts?.signal,
        }),
      list: (externalUserId, opts) =>
        request({ method: "GET", path: `/users/${seg(externalUserId)}/connections`, signal: opts?.signal }),
      revoke: (connectionId, opts) =>
        request({ method: "DELETE", path: `/connections/${seg(connectionId)}`, signal: opts?.signal }),
    };
    this.users = {
      context: (externalUserId, opts) =>
        request({ method: "GET", path: `/users/${seg(externalUserId)}/context`, signal: opts?.signal }),
      deliver: (externalUserId, body, opts) => {
        const key = resolveKey(body.idempotency_key, opts?.idempotencyKey);
        const full: DeliverRequest = { ...body, urgency: body.urgency ?? "normal", idempotency_key: key };
        return request({
          method: "POST",
          path: `/users/${seg(externalUserId)}/deliver`,
          body: full,
          idempotencyKey: key,
          signal: opts?.signal,
        });
      },
    };
    this.devices = {
      get: (deviceId, opts) => request({ method: "GET", path: `/devices/${seg(deviceId)}`, signal: opts?.signal }),
      action: (deviceId, capability, args, opts) => {
        const key = resolveKey(undefined, opts?.idempotencyKey);
        return request({
          method: "POST",
          path: `/devices/${seg(deviceId)}/actions/${seg(capability)}`,
          body: { args: args ?? {}, idempotency_key: key },
          idempotencyKey: key,
          signal: opts?.signal,
        });
      },
    };
    this.actions = {
      get: (actionId, opts) => request({ method: "GET", path: `/actions/${seg(actionId)}`, signal: opts?.signal }),
    };
  }

  /** Put content on the user's screen: `deliver` with intent `display`. */
  show(externalUserId: string, opts: ShowOptions): Promise<DeliverResponse> {
    return show(this, externalUserId, opts);
  }

  /** Send a notification: `deliver` with intent `notify`. */
  notify(externalUserId: string, opts: NotifyOptions): Promise<DeliverResponse> {
    return notify(this, externalUserId, opts);
  }

  /** Ask a question and wait for the answer: `deliver` with intent `ask`, then poll `actions.get`. */
  ask(externalUserId: string, opts: AskOptions): Promise<AskResult> {
    return ask(this, externalUserId, opts);
  }
}
