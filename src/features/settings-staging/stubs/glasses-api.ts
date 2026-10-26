/* eslint-disable @typescript-eslint/no-unused-vars -- stubs keep the real signatures they stand in for */
/**
 * STUB of `@/features/glasses/settings/glasses-api` — same exports, nothing sent. Rotation hands
 * back a made-up key so the real `AssistantKeyDialog` opens.
 */
import type { AssistantKey, DevicePatch, PairClaimInput } from "@/features/glasses/settings/glasses-api";

export type { AssistantKey, GlassesDevice } from "@/features/glasses/settings/glasses-api";
export { PAIRING_CODE_LENGTH, pairingCodeInput } from "@/features/glasses/core/devices/pairing-code";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function claimPairing(_input: PairClaimInput): Promise<void> {
  await wait(500);
}

export async function updateDevice(_id: string, _patch: DevicePatch): Promise<void> {
  await wait(300);
}

export async function revokeDevice(_id: string): Promise<void> {
  await wait(400);
}

export async function rotateAssistantKey(_id: string): Promise<AssistantKey> {
  await wait(300);
  return { key: "dopl_ak_staging_4f9c2e7a1b", url: "https://example.com/mcp/hey-even" };
}
