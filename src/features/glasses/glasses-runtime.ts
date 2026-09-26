import "server-only";
import { checkAndRecordRateLimitSubject } from "@/shared/auth/mcp-session";
import { clientIpFromRequest } from "@/shared/auth/oauth-rate-limit";
import type { NextRequest } from "next/server";
import { channelLinker } from "./channel-link";
import { createDeviceHandlers, PAIR_START_RPM } from "./device-handlers";
import { deviceRepository } from "./devices-repository";
import { glassesRepository } from "./repository";
import { sttProviderFromEnv } from "./stt";
import { CLAIM_RPM, createUserHandlers } from "./user-handlers";
import { glassesChannelGateway } from "./voice-channel";
import { createVoiceHandlers } from "./voice-handlers";

/**
 * The production wiring: real stores, the channels-service gateway, the shared
 * `rate_limit_events` limiter. Route files import these three handler sets
 * and nothing else from the feature.
 */

const base = {
  store: glassesRepository,
  devices: deviceRepository,
  gateway: glassesChannelGateway,
  linker: channelLinker,
  allowPairStart: (request: Request) =>
    checkAndRecordRateLimitSubject(
      `glasses-pair:${clientIpFromRequest(request as NextRequest)}`,
      PAIR_START_RPM,
      "POST /api/glasses/device/pair/start",
    ),
};

export const deviceHandlers = createDeviceHandlers(base);

export const voiceHandlers = createVoiceHandlers({ ...base, stt: () => sttProviderFromEnv() });

export const userHandlers = createUserHandlers({
  devices: deviceRepository,
  linker: channelLinker,
  allowClaim: (userId) =>
    checkAndRecordRateLimitSubject(`glasses-claim:${userId}`, CLAIM_RPM, "POST /api/glasses/pair/claim"),
});
