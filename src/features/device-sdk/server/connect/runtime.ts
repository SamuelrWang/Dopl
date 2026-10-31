import "server-only";
import type { NextRequest } from "next/server";
import { deviceRepository } from "@/features/glasses/core/devices/repository";
import { checkAndRecordRateLimitSubject } from "@/shared/auth/mcp-session";
import { clientIpFromRequest } from "@/shared/auth/oauth-rate-limit";
import { deviceAdapters } from "../../adapters/registry";
import { devSdkError } from "../errors";
import { ConnectError } from "./dto";
import { connectPairingPort } from "./pairing-port";
import type { ConnectDeps } from "./service";
import { connectStore } from "./store";

/** The production wiring for Connect. Route files and the hosted page import only from here. */
export const connectDeps: ConnectDeps = {
  store: connectStore,
  adapters: deviceAdapters,
  glasses: { devices: deviceRepository, port: connectPairingPort },
};

/** Requests per minute per IP on the hosted page's POSTs (pairing codes are short). */
const CONNECT_PAGE_RPM = 20;

/** Per-IP limiter for the hosted page's unauthenticated POSTs; true = within the limit. */
export function allowConnectPagePost(request: NextRequest): Promise<boolean> {
  return checkAndRecordRateLimitSubject(`connect-page:${clientIpFromRequest(request)}`, CONNECT_PAGE_RPM, "POST /api/connect/*");
}

/** Run a Connect operation; a {@link ConnectError} becomes the C10 error response. */
export async function answerConnect(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ConnectError) return devSdkError(err.code, err.message);
    throw err;
  }
}

/** The JSON body, or `undefined` when it is not JSON (the schema then reports `invalid_request`). */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
