import { createBridgeHandlers } from "@/features/device-sdk/server/bridge/handlers";
import { bridgePort } from "@/features/device-sdk/server/bridge/port";

/** A local Cast bridge reports in and takes what is pending. Device token (`bridge/handlers.ts`). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createBridgeHandlers(bridgePort).poll;
