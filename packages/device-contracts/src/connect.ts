/**
 * C2 — the Connect flow, Plaid-Link style (spec v1 › C2), plus the C7
 * per-connection grant. End users are the developer's `external_user_id` and never hold a Dopl
 * account (D1).
 */
import { z } from "zod";

import { CapabilityScopeSchema, DeviceKindSchema, DeviceSchema } from "./capabilities";

/** The developer's own id for their end user. */
export const ExternalUserIdSchema = z.string().min(1).max(255);

/** P8 white-label: the Connect UI carries the developer's brand. */
export const ConnectBrandingSchema = z.object({
  display_name: z.string().min(1).max(80).optional(),
  logo_url: z.url().optional(),
  accent_color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});
export type ConnectBranding = z.infer<typeof ConnectBrandingSchema>;

/** `POST /v1/connect_sessions` (secret or publishable key). */
export const ConnectSessionCreateRequestSchema = z.object({
  external_user_id: ExternalUserIdSchema,
  allowed_kinds: z.array(DeviceKindSchema).min(1).optional(),
  requested_scopes: z.array(CapabilityScopeSchema).min(1),
  redirect_uri: z.url().optional(),
  branding: ConnectBrandingSchema.optional(),
});
export type ConnectSessionCreateRequest = z.infer<typeof ConnectSessionCreateRequestSchema>;

export const ConnectSessionCreateResponseSchema = z.object({
  connect_token: z.string().min(1),
  /** The hosted Connect URL. */
  url: z.url(),
  expires_at: z.iso.datetime(),
});
export type ConnectSessionCreateResponse = z.infer<typeof ConnectSessionCreateResponseSchema>;

/** `POST /v1/connections/exchange` — the widget's one-time public token for a durable connection. */
export const ConnectionExchangeRequestSchema = z.object({
  public_token: z.string().min(1),
});
export type ConnectionExchangeRequest = z.infer<typeof ConnectionExchangeRequestSchema>;

export const ConnectionExchangeResponseSchema = z.object({
  connection_id: z.string().min(1),
  device: DeviceSchema,
});
export type ConnectionExchangeResponse = z.infer<typeof ConnectionExchangeResponseSchema>;

/** C7 layer 2: what the end user granted on this connection; `expires_at` null = no TTL. */
export const GrantSchema = z.object({
  scope: CapabilityScopeSchema,
  granted_at: z.iso.datetime(),
  expires_at: z.iso.datetime().nullable(),
});
export type Grant = z.infer<typeof GrantSchema>;

export const CONNECTION_STATUSES = ["active", "needs_reauth", "revoked"] as const;
export const ConnectionStatusSchema = z.enum(CONNECTION_STATUSES);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

/** One user's grant to one device (§2 object model). */
export const ConnectionSchema = z.object({
  id: z.string().min(1),
  external_user_id: ExternalUserIdSchema,
  status: ConnectionStatusSchema,
  device: DeviceSchema,
  grants: z.array(GrantSchema),
  created_at: z.iso.datetime(),
  revoked_at: z.iso.datetime().nullable(),
});
export type Connection = z.infer<typeof ConnectionSchema>;

/** `GET /v1/users/{external_user_id}/connections`. `DELETE /v1/connections/{id}` returns the revoked {@link Connection}. */
export const ConnectionListResponseSchema = z.object({
  data: z.array(ConnectionSchema),
});
export type ConnectionListResponse = z.infer<typeof ConnectionListResponseSchema>;

/** C2 webhooks (a subset of `events.ts › WEBHOOK_EVENT_NAMES`). */
export const CONNECT_WEBHOOK_EVENTS = [
  "connection.created",
  "connection.revoked",
  "connection.needs_reauth",
  "device.offline",
  "device.online",
] as const;
export const ConnectWebhookEventSchema = z.enum(CONNECT_WEBHOOK_EVENTS);
export type ConnectWebhookEvent = z.infer<typeof ConnectWebhookEventSchema>;
