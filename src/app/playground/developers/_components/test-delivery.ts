/** The delivery a "Send test" adds to the session: the user page and the Users sheet both send it. */
import type { Call } from "../_data/activity";
import { minsAgo } from "../_data/company";
import type { OwnedDevice, PortalUser } from "../_data/users";

export function testDelivery(user: PortalUser, target: OwnedDevice | undefined, reason: string): Call {
  const id = `del_${(Date.now() % 0xffffff).toString(16)}`;
  return {
    id,
    kind: "delivery",
    env: user.env,
    at: minsAgo(0),
    userId: user.id,
    deviceId: target?.id ?? null,
    modelId: target?.modelId ?? null,
    capability: "present.notify",
    intent: "notify",
    status: "seen",
    errorCode: null,
    title: "Test message from the developer portal.",
    requestId: `req_${id.slice(4)}`,
    rulesVersion: null,
    segment: null,
    latencyMs: 212,
    candidates: target ? [{ deviceId: target.id, verdict: "chosen", reason }] : [],
    marks: { queued: 40, sent: 212, seen: 860, answered: null },
    answer: null,
    truncated: null,
    http: null,
    webhook: null,
  };
}
