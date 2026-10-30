/** Playground's logic: what each capability asks for, and what the simulated device answers. */
import { CAPABILITY_RISK_TIER, type CapabilityId } from "@dopl/device-contracts";
import { CAPABILITY_LABEL, type Model } from "../_data/catalog";

export type Family = "screen" | "speak" | "haptic" | "ask" | "act" | "read" | "capture";
export type Phase = "idle" | "queued" | "delivered" | "seen" | "answered" | "refused";

export function familyOf(c: CapabilityId): Family {
  if (c === "present.speak") return "speak";
  if (c === "present.haptic") return "haptic";
  if (c.startsWith("present.")) return "screen";
  if (c.startsWith("ask.")) return "ask";
  if (c.startsWith("act.")) return "act";
  if (c.startsWith("capture.")) return "capture";
  return "read";
}

export const sendable = (model: Model) => model.capabilities.filter((c) => !c.startsWith("input."));

const READ_LABEL: Partial<Record<CapabilityId, string>> = { "presence.read": "Presence", "state.read": "Read state", "telemetry.read": "Telemetry", "capture.audio": "Microphone", "capture.screen": "Screen capture", "capture.video_stream": "Video", "act.motion.vehicle": "Drive", "act.motion.move": "Move", "act.motion.gripper": "Gripper", "act.motion": "Motion", "present.hologram": "Hologram" };
export const labelOf = (c: CapabilityId) => CAPABILITY_LABEL[c] ?? READ_LABEL[c] ?? c;

/** The choices a capability takes, shown as visible pills. */
export function choicesOf(c: CapabilityId): string[] {
  if (c === "present.haptic") return ["Tap", "Double", "Alert"];
  if (c === "act.lock") return ["Lock", "Unlock"];
  if (c === "act.set") return ["68°", "70°", "72°", "74°"];
  if (c === "act.media") return ["Play", "Pause", "Next"];
  if (c.startsWith("act.motion")) return ["Go", "Stop"];
  return [];
}

export const needsText = (c: CapabilityId) => ["screen", "speak", "ask"].includes(familyOf(c)) || c === "act.navigate";
export const textLabel = (c: CapabilityId) => (familyOf(c) === "ask" ? "Question" : c === "act.navigate" ? "Destination" : "Message");
export const defaultText = (c: CapabilityId) => (familyOf(c) === "ask" ? "Deploy the fix to production?" : c === "act.navigate" ? "Site 12, Bay 9" : "Pump 4 at Site 12 is over pressure. Close valve B before restart.");
export const answersOf = (c: CapabilityId, options: string) => (c === "ask.confirm" ? ["Confirm", "Cancel"] : options.split(",").map((o) => o.trim()).filter(Boolean));
export const needsConfirm = (c: CapabilityId) => ["T3", "T4"].includes(CAPABILITY_RISK_TIER[c]);

export const HAPTICS: Record<string, { on: number; off: number }[]> = {
  Tap: [{ on: 90, off: 0 }],
  Double: [{ on: 70, off: 60 }, { on: 70, off: 0 }],
  Alert: [{ on: 180, off: 70 }, { on: 180, off: 70 }, { on: 180, off: 0 }],
};

export function changeOf(c: CapabilityId, choice: string, text: string): { before: string; after: string; label: string } {
  if (c === "act.lock") return { before: choice === "Lock" ? "Unlocked" : "Locked", after: choice === "Lock" ? "Locked" : "Unlocked", label: "Now" };
  if (c === "act.set") return { before: "70°", after: choice, label: "Set to" };
  if (c === "act.media") return { before: choice === "Play" ? "Paused" : "Playing", after: choice === "Pause" ? "Paused" : choice === "Next" ? "Next track" : "Playing", label: "Now" };
  if (c === "act.navigate") return { before: "No route", after: text, label: "Heading to" };
  return { before: choice === "Go" ? "Stopped" : "Moving", after: choice === "Go" ? "Moving" : "Stopped", label: "Now" };
}

export function readRows(c: CapabilityId, model: Model): [string, string][] {
  if (c === "telemetry.read") return [["Battery", "82%"], ["Range", "214 mi"], ["Speed", "0 mph"]];
  if (c === "presence.read") return [["Status", "Online"], ["Worn", "Yes"], ["Last seen", "Just now"]];
  if (model.id === "thermostat") return [["Temperature", "70°"], ["Mode", "Heat"], ["Humidity", "41%"]];
  return [["Power", "On"], ["Volume", "40%"], ["Playing", "Nothing"]];
}

export function requestOf(c: CapabilityId, deviceId: string, text: string, choice: string, answers: string[], lines?: string[]) {
  const family = familyOf(c);
  const path = family === "act" ? "POST /v1/actions" : family === "read" || family === "capture" ? `GET /v1/devices/${deviceId}/${c}` : "POST /v1/deliver";
  const body = family === "read" || family === "capture" ? null : { target: { device_id: deviceId }, capability: c, ...(needsText(c) ? { content: { ...(lines ? { lines } : { text }), ...(family === "ask" ? { options: answers } : {}) } } : {}), ...(choice ? { value: choice } : {}) };
  return `${path}${body ? `\n${JSON.stringify(body, null, 2)}` : ""}`;
}

export function responseOf(c: CapabilityId, deviceId: string, phase: Phase, model: Model) {
  if (phase === "idle") return "";
  if (phase === "refused") return JSON.stringify({ error: { type: "device_error", code: "device_offline", retryable: true } }, null, 2);
  const family = familyOf(c);
  if (family === "read") return JSON.stringify(Object.fromEntries(readRows(c, model).map(([k, v]) => [k.toLowerCase().replace(/ /g, "_"), v])), null, 2);
  return JSON.stringify({ id: "act_pg7310", status: phase === "queued" ? "queued" : phase === "delivered" ? "sent" : "seen", route: { chosen: deviceId }, capability: c }, null, 2);
}

export function eventsOf(phase: Phase, answer: string | null): [string, string][] {
  if (phase === "idle") return [];
  if (phase === "refused") return [["action.failed", "device_offline"]];
  const out: [string, string][] = [["action.queued", "0 ms"]];
  if (phase !== "queued") out.push(["action.sent", "212 ms"]);
  if (phase === "seen" || phase === "answered") out.push(["action.completed", "860 ms"]);
  if (phase === "answered" && answer) out.push(["ask.answered", answer]);
  return out;
}

/** The call as SDK code: the editor's starting point and the snippet to copy. */
export function snippetOf(c: CapabilityId, deviceId: string, text: string, choice: string, answers: string[]) {
  const family = familyOf(c);
  if (family === "read" || family === "capture") return `const result = await dopl.read({\n  device: "${deviceId}",\n  capability: "${c}",\n});\nconsole.log(result.status);`;
  const value = choice ? `\n  value: "${choice}",` : "";
  const content = needsText(c) ? `\n  content: {\n    text: ${JSON.stringify(text)},${family === "ask" ? `\n    options: ${JSON.stringify(answers)},` : ""}\n  },` : "";
  return `await dopl.${family === "act" ? "act" : "deliver"}({\n  device: "${deviceId}",\n  capability: "${c}",${value}${content}\n});`;
}
