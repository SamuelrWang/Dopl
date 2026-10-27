import "server-only";
import type { NextRequest } from "next/server";
import type { RouteContextArg } from "@/shared/auth/with-auth";
import type { ApiKeyScope } from "../types";
import { devSdkError } from "./errors";
import { touchApiKeyLastUsed, verifyApiKey, type ResolvedDeveloperKey } from "./keys";

/**
 * `withDeveloperKey(handler, { scopes })` — the auth wrapper for every `/api/v1` route (C1).
 *
 *   Bearer parse → verify (keys.ts) → publishable gate → scope check → handler.
 *
 * Every refusal is the C10 shape (`errors.ts › devSdkError`): no/invalid/revoked/expired key →
 * `unauthenticated` (401); missing scope or a publishable key on a route that did not opt in →
 * `insufficient_scope` (403). `last_used_at` is bumped fire-and-forget, never awaited.
 *
 * ⚠ PUBLISHABLE KEYS (`pk_…`) ARE REFUSED UNLESS THE ROUTE OPTS IN with `publishable: true`, and only a
 * route whose required scopes are `connect` alone may opt in (checked when the route is defined).
 * Separate from `withUserAuth` on purpose: no Dopl session, no OAuth token, no cookie is read here.
 */

export type DeveloperKeyContext = ResolvedDeveloperKey;

export interface DeveloperKeyOptions {
  /** Every scope the key must carry. `[]` = any valid key of an allowed kind. */
  scopes: readonly ApiKeyScope[];
  /** Admit publishable keys. Only legal when `scopes` is exactly `["connect"]`. */
  publishable?: boolean;
}

type DeveloperKeyHandler = (
  request: NextRequest,
  ctx: DeveloperKeyContext,
  routeContext: RouteContextArg
) => Promise<Response>;

/** `Authorization: Bearer <key>` → the key, or null. Scheme is case-insensitive (RFC 7235). */
export function readBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header);
  return match ? match[1] : null;
}

export function withDeveloperKey(handler: DeveloperKeyHandler, options: DeveloperKeyOptions) {
  const required = [...options.scopes];
  if (options.publishable && !(required.length === 1 && required[0] === "connect")) {
    throw new Error("withDeveloperKey: only a route requiring exactly the `connect` scope may admit publishable keys");
  }

  return async (request: NextRequest, routeContext: RouteContextArg): Promise<Response> => {
    const raw = readBearer(request);
    if (!raw) {
      return devSdkError(
        "unauthenticated",
        "No API key provided. Send it as `Authorization: Bearer sk_test_…`."
      );
    }

    const verified = await verifyApiKey(raw);
    if (!verified.ok) return devSdkError(verified.code, verified.message);
    const ctx = verified.resolved;

    if (ctx.key.kind === "publishable" && !options.publishable) {
      return devSdkError(
        "insufficient_scope",
        "Publishable keys can only create Connect sessions. Use a secret key for this route."
      );
    }
    const missing = required.filter((s) => !ctx.key.scopes.includes(s));
    if (missing.length > 0) {
      return devSdkError(
        "insufficient_scope",
        `This API key lacks the required scope: ${missing.join(", ")}.`
      );
    }

    touchApiKeyLastUsed(ctx.key.id);
    return handler(request, ctx, routeContext);
  };
}
