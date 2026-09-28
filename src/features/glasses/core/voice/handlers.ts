import { json } from "../http";
import { UNAUTHORIZED, authedDevice, resolveDeviceDeps, type DeviceHandlerDeps } from "../messages/device-handlers";
import type { GlassesDevice } from "../devices/types";
import { PCM_MAX_BYTES, type SttProvider } from "./stt";
import { recordDevicePost } from "../messages/reply-mirror";
import { resolveVoiceTarget, targetOverrideFrom } from "./target";
import { VoiceInputError, handleVoiceUpload, readCappedBody } from "./upload";
import { UtteranceError, type UtteranceDeps } from "./utterance";

/**
 * Push-to-talk (`/api/glasses/device/voice`, device token). Posts as the device
 * OWNER to the resolved target (`target.ts`); with no usable target the answer is 409.
 */

export interface VoiceHandlerDeps extends DeviceHandlerDeps {
  stt: () => SttProvider | null;
  holdMs?: number;
  /** Per-device utterance limiter (every voice door shares it); true = within the limit. */
  allowUtterance: (deviceId: string) => Promise<boolean>;
  /**
   * Meter one utterance for the device owner: refusal text, or null to proceed.
   * Charged like one glasses MCP tool call, because it does the same work (a
   * post into a channel), plus STT for voice.
   */
  chargeUtterance: (userId: string) => Promise<string | null>;
}

export const UTTERANCE_RPM = 20;
export const NO_TARGET = "Open a channel on your glasses first.";
export const LIMITED = "Too many voice requests from this device; try again in a minute.";

/** Where this device's utterance goes, as utterance deps; null when no target is usable. */
export async function utteranceDepsFor(
  deps: VoiceHandlerDeps,
  device: GlassesDevice,
  request: Request,
): Promise<UtteranceDeps | null> {
  const target = await resolveVoiceTarget(deps.linker, device, targetOverrideFrom(request));
  if (!target) return null;
  const config = { channel: target.channel, operatorUserId: device.user_id, agentId: target.agentId };
  // The post puts its channel in this device's reply-mirror scope for 24h.
  const onPosted = (seq: number) => recordDevicePost(deps, device.id, target.channel.channelId, seq);
  return { gateway: deps.gateway, config, now: deps.now, sleep: deps.sleep, holdMs: deps.holdMs, onPosted };
}

export function createVoiceHandlers(input: VoiceHandlerDeps) {
  const deps = resolveDeviceDeps(input);
  return {
    async voice(request: Request): Promise<Response> {
      const device = await authedDevice(deps, request);
      if (!device) return json(request, UNAUTHORIZED, 401);
      const utterance = await utteranceDepsFor(deps, device, request);
      if (!utterance) return json(request, { error: NO_TARGET }, 409);
      const stt = deps.stt();
      if (!stt) return json(request, { error: "Speech-to-text is not configured on this server." }, 503);
      try {
        if (!(await deps.allowUtterance(device.id))) return json(request, { error: LIMITED }, 429, { "Retry-After": "60" });
        const pcm = await readCappedBody(request, PCM_MAX_BYTES);
        const charge = () => deps.chargeUtterance(device.user_id);
        return json(request, await handleVoiceUpload({ stt, utterance, charge }, pcm));
      } catch (err) {
        if (err instanceof VoiceInputError) return json(request, { error: err.message }, err.httpStatus);
        if (err instanceof UtteranceError) return json(request, { error: err.message }, 400);
        console.error("[glasses] voice failed", err);
        return json(request, { error: "voice failed" }, 502);
      }
    },
  };
}
