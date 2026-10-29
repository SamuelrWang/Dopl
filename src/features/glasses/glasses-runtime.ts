import "server-only";
import type { NextRequest } from "next/server";
import { checkAndRecordRateLimitSubject } from "@/shared/auth/mcp-session";
import { clientIpFromRequest } from "@/shared/auth/oauth-rate-limit";
import { channelLinker } from "./core/devices/channel-link";
import { deviceRepository } from "./core/devices/repository";
import { CLAIM_RPM, createUserHandlers } from "./core/devices/user-handlers";
import { utteranceCharger } from "./core/mcp/exposure";
import { menuGateway } from "./core/menu/gateway";
import { LAUNCH_RPM, MENU_READ_RPM, createMenuHandlers } from "./core/menu/handlers";
import { PAIR_START_RPM, createDeviceHandlers } from "./core/messages/device-handlers";
import { glassesRepository } from "./core/messages/repository";
import { glassesMessageSource } from "@/features/channels/server/message-source-stamp";
import { answerFromLens, answerFromSdkLens } from "@/features/display/server/answer";
import { glassesChannelGateway } from "./core/voice/channel-gateway";
import { UTTERANCE_RPM, createVoiceHandlers } from "./core/voice/handlers";
import { sttProviderFromEnv } from "./core/voice/stt";
import { createHeyEvenHandlers } from "./platforms/even-g2/hey-even";
import { connectPairingPort } from "@/features/device-sdk/server/connect/pairing-port";
import { sdkGlassesPort } from "@/features/device-sdk/server/glasses/sdk-glasses-port";

/**
 * The production wiring: real stores, the channels-service gateways and the
 * shared `rate_limit_events` limiter. Route files import only from here.
 */

const limiter = (prefix: string, rpm: number, label: string) => (subject: string) =>
  checkAndRecordRateLimitSubject(`${prefix}:${subject}`, rpm, label);

const allowPairStartFrom = limiter("glasses-pair", PAIR_START_RPM, "POST /api/glasses/device/pair/start");

const base = {
  store: glassesRepository,
  devices: deviceRepository,
  gateway: glassesChannelGateway,
  linker: channelLinker,
  // A tap on a lens row linked to a channel decision answers it there too, from glasses.
  answerLinked: (device: { user_id: string; id: string; name: string | null; platform: string }, row: Parameters<typeof answerFromLens>[1]) =>
    answerFromLens(device.user_id, row, glassesMessageSource({ id: device.id, name: device.name ?? "", platform: device.platform })),
  allowPairStart: (request: Request) => allowPairStartFrom(clientIpFromRequest(request as NextRequest)),
};

const voiceDeps = {
  ...base,
  stt: () => sttProviderFromEnv(),
  allowUtterance: limiter("glasses-utterance", UTTERANCE_RPM, "POST /api/glasses/(voice|hey-even)"),
  chargeUtterance: utteranceCharger,
};

// `connect`: a pairing claimed through a Device SDK Connect session (A4) collects its token here too;
// `sdk`: that token then authenticates the inbox / answer / dismiss / unpair routes on the SDK device's own queue (A8).
// `sdkAnswerLinked` (W1.2 gap #3): a migrated G2's answer to the app's own SDK ask posts to its channel decision.
export const deviceHandlers = createDeviceHandlers({
  ...base,
  connect: connectPairingPort,
  sdk: sdkGlassesPort,
  sdkAnswerLinked: (device, settled) =>
    answerFromSdkLens(device.user_id, settled, glassesMessageSource({ id: device.id, name: device.name ?? "", platform: device.platform })),
});

// `sdk` on voice and menu (A8b): a Device SDK G2 gets fixed, data-free answers there instead of a 401,
// which the plugin treats as a revoked pairing. Hey Even authenticates with its own key and stays prosumer-only.
export const voiceHandlers = createVoiceHandlers({ ...voiceDeps, sdk: sdkGlassesPort });

export const heyEvenHandlers = createHeyEvenHandlers({ ...voiceDeps, debug: process.env.GLASSES_DEBUG === "1" });

export const menuHandlers = createMenuHandlers({
  ...base,
  menu: menuGateway,
  sdk: sdkGlassesPort,
  allowRead: limiter("glasses-menu", MENU_READ_RPM, "GET /api/glasses/device/(menu)"),
  allowLaunch: limiter("glasses-launch", LAUNCH_RPM, "POST /api/glasses/device/launch"),
});

export const userHandlers = createUserHandlers({
  devices: deviceRepository,
  allowClaim: limiter("glasses-claim", CLAIM_RPM, "POST /api/glasses/pair/claim"),
});

export { glassesSessionOnly } from "./core/devices/session-policy";
export { preflight } from "./core/http";
