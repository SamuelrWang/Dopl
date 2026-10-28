import { CAPABILITY_FAMILY, CAPABILITY_RISK_TIER, WEBHOOK_EVENT_NAMES, type CapabilityId } from "@dopl/device-contracts";

import { TIER_ROWS } from "./pages-concepts";
import { curl, DEVICE_ID, json } from "./shared";
import type { CapabilityCard, CodeTab, ModelSupport, Rich } from "./types";

/**
 * The ONE capability card every device category uses. A category says which capability, what it
 * means on that kind of device, its limits and which models support it; everything else (tier,
 * permission, the TypeScript and cURL calls, the example response) is derived here from the
 * contracts (`@dopl/device-contracts › CAPABILITY_RISK_TIER`) and the frozen routes in
 * `docs/specs/device-sdk/openapi.yaml`, so no two cards can disagree on them.
 *
 * How the agent reaches a capability:
 *   `action`  `POST /v1/devices/{id}/actions/{capability}` (`dopl.devices.action`) → 202
 *   `read`    the same call, then the result from `GET /v1/actions/{id}` (`dopl.actions.get`)
 *   `answer`  the answer to an `ask.*` the agent sent, from `GET /v1/actions/{id}`
 *   `device`  `GET /v1/devices/{id}` (`dopl.devices.get`): `online` and `last_seen_at`
 *   `event`   device input. No route returns it yet: it is planned as a webhook (C8)
 */

export type CardCall = "action" | "read" | "answer" | "device" | "event";

export interface CardSpec {
  capability: CapabilityId;
  title: string;
  what: Rich;
  limits: Rich[];
  call: CardCall;
  /** Body `args` for `action` / `read`. */
  args?: Record<string, unknown>;
  /** The `result` an `answer` / `read` shows. */
  result?: Record<string, unknown>;
  /** Shown instead of the default `device` response. */
  device?: Record<string, unknown>;
  /** `test`: no model is connected yet, so the response is what a simulated device returns in test mode. */
  responseFrom?: "device" | "test";
  support: ModelSupport[];
}

export const ACTION_ID = "a6d1c0b2-7e45-4f19-8c3a-2b9e5d4f7a11";
const CREATED = "2026-10-27T17:05:00Z";

/** `present.*` → `present.*`: the consent screen's scope for this capability's family. */
export function scopeOf(capability: CapabilityId): string {
  return `${CAPABILITY_FAMILY[capability]}.*`;
}

/** The tier line: the C3 default tier and what consent and the policy engine do with it. */
export function permissionOf(capability: CapabilityId): { tier: string; permission: Rich } {
  const tier = CAPABILITY_RISK_TIER[capability];
  const row = TIER_ROWS.find(([t]) => t === tier)!;
  const consent = row[2] ? "ticked by default on the consent screen" : "unticked on the consent screen until the user ticks it";
  return {
    tier,
    permission: `Scope \`${scopeOf(capability)}\`, ${consent}. At call time: ${row[3].charAt(0).toLowerCase()}${row[3].slice(1)}. See [Permissions and safety](/docs/concepts/permissions-and-safety).`,
  };
}

const ts = (code: string[]): CodeTab => ({ label: "TypeScript", code: code.join("\n") });

function argLines(args: Record<string, unknown>): string {
  // A TypeScript object literal: JSON with bare keys.
  return Object.keys(args).length === 0 ? "{}" : json(args).replace(/"([A-Za-z_]\w*)":/g, "$1:");
}

function code(spec: CardSpec): CodeTab[] {
  const cap = spec.capability;
  const args = spec.args ?? {};
  const actionPath = `/devices/${DEVICE_ID}/actions/${cap}`;
  const actionBody = JSON.stringify({ args, idempotency_key: "req_4812" });
  switch (spec.call) {
    case "action":
      return [
        ts([`const { action_id, status } = await dopl.devices.action(deviceId, "${cap}", ${argLines(args)});`]),
        { label: "cURL", code: curl("POST", actionPath, actionBody) },
      ];
    case "read":
      return [
        ts([
          `const { action_id } = await dopl.devices.action(deviceId, "${cap}", ${argLines(args)});`,
          `const action = await dopl.actions.get(action_id);`,
          `console.log(action.result);`,
        ]),
        { label: "cURL", code: [curl("POST", actionPath, actionBody), "", curl("GET", `/actions/${ACTION_ID}`)].join("\n") },
      ];
    case "answer":
      return [
        ts([
          `// action_id from the ${cap} call you sent`,
          `const action = await dopl.actions.get(action_id);`,
          `if (action.status === "done") console.log(action.result);`,
        ]),
        { label: "cURL", code: curl("GET", `/actions/${ACTION_ID}`) },
      ];
    case "device":
      return [
        ts([`const device = await dopl.devices.get(deviceId);`, `console.log(device.online, device.last_seen_at);`]),
        { label: "cURL", code: curl("GET", `/devices/${DEVICE_ID}`) },
      ];
    case "event":
      return [{ label: "Planned", code: `// No call returns ${cap} yet. ${plannedDelivery(cap)}` }];
  }
}

/** C8 `WEBHOOK_EVENT_NAMES` names `input.utterance`; the other inputs have no event name yet. */
function plannedDelivery(cap: CapabilityId): string {
  return (WEBHOOK_EVENT_NAMES as readonly string[]).includes(cap)
    ? `It is planned as the \`${cap}\` webhook.`
    : "The contract has no event for it yet.";
}

/** `openapi.yaml › Action`, in its field order. */
function action(status: string, result: Record<string, unknown> | null) {
  return {
    action_id: ACTION_ID,
    device_id: DEVICE_ID,
    capability: "",
    status,
    result,
    error: null,
    created_at: CREATED,
    updated_at: "2026-10-27T17:05:09Z",
  };
}

function response(spec: CardSpec): CodeTab[] {
  const cap = spec.capability;
  const test = spec.responseFrom === "test";
  if (spec.call === "event") return [{ label: "Planned", code: "// Not available yet." }];
  if (spec.call === "device") return [{ label: "200", code: json(spec.device) }];
  if (CAPABILITY_RISK_TIER[cap] === "T4") {
    return [
      {
        label: "403",
        code: json({
          error: {
            type: "permission_error",
            code: "confirmation_denied",
            message: `${cap} is T4 and the profile denies it.`,
            retryable: false,
            doc_url: "https://www.usedopl.com/docs/errors/confirmation-denied",
          },
        }),
      },
    ];
  }
  if (spec.call === "action") {
    return [{ label: test ? "202 (test mode)" : "202", code: json({ action_id: ACTION_ID, status: test ? "done" : "queued" }) }];
  }
  const done = { ...action("done", spec.result ?? { simulated: true }), capability: cap };
  return [{ label: test ? "200 (test mode)" : "200", code: json(done) }];
}

export function capabilityCard(spec: CardSpec): CapabilityCard {
  return {
    capability: spec.capability,
    title: spec.title,
    what: spec.what,
    limits: spec.limits,
    ...permissionOf(spec.capability),
    code: code(spec),
    response: response(spec),
    support: spec.support,
  };
}
