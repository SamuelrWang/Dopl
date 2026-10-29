import "server-only";
import type { NextRequest } from "next/server";
import type { RouteContextArg } from "@/shared/auth/with-auth";
import * as connectSessions from "../../v1/connect_sessions/route";
import * as connectionsExchange from "../../v1/connections/exchange/route";
import * as connectionById from "../../v1/connections/[id]/route";
import * as userConnections from "../../v1/users/[external_user_id]/connections/route";
import * as userContext from "../../v1/users/[external_user_id]/context/route";
import * as userDeliver from "../../v1/users/[external_user_id]/deliver/route";
import * as deviceAction from "../../v1/devices/[device_id]/actions/[capability]/route";
import * as deviceById from "../../v1/devices/[device_id]/route";
import * as actionById from "../../v1/actions/[id]/route";
import * as events from "../../v1/events/route";

type Handler = (request: NextRequest, ctx: RouteContextArg) => Promise<Response>;

/**
 * Playground operation → the REAL `/api/v1` handler that serves it, and how the op's path params map
 * onto that route folder's dynamic segments. The playground calls these in process, so a run is
 * exactly the production code path (key check, scopes, event row), only without a network hop.
 * `playground-dispatch.test.ts` pins this table to `PLAYGROUND_OPS`.
 */
export const PLAYGROUND_DISPATCH: Record<string, { handler: Handler; segments: (p: Record<string, string>) => Record<string, string> }> = {
  createConnectSession: { handler: connectSessions.POST, segments: () => ({}) },
  exchangePublicToken: { handler: connectionsExchange.POST, segments: () => ({}) },
  listConnections: { handler: userConnections.GET, segments: (p) => ({ external_user_id: p.external_user_id }) },
  revokeConnection: { handler: connectionById.DELETE, segments: (p) => ({ id: p.id }) },
  getContext: { handler: userContext.GET, segments: (p) => ({ external_user_id: p.external_user_id }) },
  deliver: { handler: userDeliver.POST, segments: (p) => ({ external_user_id: p.external_user_id }) },
  createDeviceAction: {
    handler: deviceAction.POST,
    segments: (p) => ({ device_id: p.device_id, capability: p.capability }),
  },
  getAction: { handler: actionById.GET, segments: (p) => ({ id: p.id }) },
  getDevice: { handler: deviceById.GET, segments: (p) => ({ device_id: p.id }) },
  listEvents: { handler: events.GET, segments: () => ({}) },
};
