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
import { createVoiceHandlers, UTTERANCE_RPM } from "./voice-handlers";
import { createMenuHandlers, LAUNCH_RPM, MENU_READ_RPM } from "./menu-handlers";
import { menuGateway } from "./menu-gateway";
import { utteranceCharger } from "./mcp-exposure";

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

export const voiceHandlers = createVoiceHandlers({
  ...base,
  stt: () => sttProviderFromEnv(),
  allowUtterance: (deviceId) =>
    checkAndRecordRateLimitSubject(`glasses-utterance:${deviceId}`, UTTERANCE_RPM, "POST /api/glasses/(voice|hey-even)"),
  chargeUtterance: utteranceCharger,
  debug: process.env.GLASSES_DEBUG === "1",
});

export const menuHandlers = createMenuHandlers({
  ...base,
  menu: menuGateway,
  allowRead: (deviceId) =>
    checkAndRecordRateLimitSubject(`glasses-menu:${deviceId}`, MENU_READ_RPM, "GET /api/glasses/device/(menu)"),
  allowLaunch: (deviceId) =>
    checkAndRecordRateLimitSubject(`glasses-launch:${deviceId}`, LAUNCH_RPM, "POST /api/glasses/device/launch"),
});

export const userHandlers = createUserHandlers({
  devices: deviceRepository,
  linker: channelLinker,
  allowClaim: (userId) =>
    checkAndRecordRateLimitSubject(`glasses-claim:${userId}`, CLAIM_RPM, "POST /api/glasses/pair/claim"),
});

export { glassesSessionOnly } from "./session-policy";
