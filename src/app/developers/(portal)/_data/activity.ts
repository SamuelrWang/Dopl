/**
 * Every delivery, request and webhook the demo shows, newest first. Deliveries are generated from a
 * fixed seed over `./users.ts`, so ids and times are stable; the cases the pages lean on (the stale
 * pairing refusals, the overflow, the failing webhook) are written out.
 */
import type { CapabilityId, DeliverIntent, ErrorCode } from "@dopl/device-contracts";
import { DEMO_NOW, minsAgo, type Env } from "./company";
import { categoryOf, type ModelId } from "./catalog";
import { ALL_USERS, ownedDevice, userById, type OwnedDevice, type PortalUser } from "./users";

export type CallKind = "delivery" | "request" | "webhook";
export type CallStatus = "accepted" | "sent" | "seen" | "answered" | "failed" | "expired" | "ok" | "retrying";

export interface Candidate {
  deviceId: string;
  verdict: "chosen" | "skipped" | "refused";
  reason: string;
}

export interface Call {
  id: string;
  kind: CallKind;
  env: Env;
  at: string;
  userId: string | null;
  deviceId: string | null;
  modelId: ModelId | null;
  capability: CapabilityId | null;
  intent: DeliverIntent | null;
  status: CallStatus;
  errorCode: ErrorCode | null;
  /** The row's lead: the message, the route, the event. */
  title: string;
  requestId: string | null;
  rulesVersion: number | null;
  segment: string | null;
  latencyMs: number;
  candidates: Candidate[];
  /** Milliseconds after `at`; null = did not happen, or has not yet. */
  marks: { queued: number | null; sent: number | null; seen: number | null; answered: number | null };
  answer: string | null;
  truncated: { kept: number; of: number } | null;
  /** Request rows. */
  http: { method: string; path: string; status: number; key: string } | null;
  /** Webhook rows. */
  webhook: { endpointId: string; event: string; attempts: { at: string; status: number | null; note: string }[] } | null;
}

/** The rules version in force per category and environment (`./receives.ts › seedReceives`). */
const RULES_IN_FORCE: Record<Env, Record<string, number>> = { live: { glasses: 6, desktop: 3 }, test: { glasses: 7, desktop: 3 } };

const MESSAGES: { text: string; intent: DeliverIntent; capability: CapabilityId; answers?: string[] }[] = [
  { text: "Pump 4 at Site 12 is over pressure. Close valve B before restart.", intent: "notify", capability: "present.notify" },
  { text: "Next stop moved to 2:30 PM. Customer confirmed gate access.", intent: "message", capability: "present.notify" },
  { text: "Replacement filter is in van stock, bay 3.", intent: "notify", capability: "present.notify" },
  { text: "Isolate breaker 7 first?", intent: "ask", capability: "ask.choice", answers: ["Isolate now", "Skip step"] },
  { text: "Log this visit as complete?", intent: "ask", capability: "ask.choice", answers: ["Complete", "Needs follow up"] },
  { text: "Wiring diagram for unit RT-220, panel C.", intent: "display", capability: "present.display" },
  { text: "Safety briefing updated for the Eastgate site.", intent: "message", capability: "present.notify" },
  { text: "Parts order 8841 shipped, arriving tomorrow by 10 AM.", intent: "notify", capability: "present.notify" },
  { text: "Reading looks low. Retake the sensor measurement?", intent: "ask", capability: "ask.choice", answers: ["Retake", "Accept reading"] },
];

const hex = (n: number, width = 6) => n.toString(16).padStart(width, "0").slice(-width);

function blank(partial: Partial<Call> & Pick<Call, "id" | "kind" | "env" | "at" | "title">): Call {
  return {
    userId: null,
    deviceId: null,
    modelId: null,
    capability: null,
    intent: null,
    status: "ok",
    errorCode: null,
    requestId: null,
    rulesVersion: null,
    segment: null,
    latencyMs: 0,
    candidates: [],
    marks: { queued: null, sent: null, seen: null, answered: null },
    answer: null,
    truncated: null,
    http: null,
    webhook: null,
    ...partial,
  };
}

function skipReason(d: OwnedDevice, u: PortalUser, m: (typeof MESSAGES)[number]): string {
  if (u.prefs.blocked.includes(d.modelId)) return "Blocked in the user's preferences";
  if (d.state === "offline") return "Offline, last seen before the online window";
  if (d.state === "stale") return "Stale pairing, excluded after a refused send";
  if (d.state === "needs_relink") return "Connection needs relink";
  if (d.modelId === "macos" && m.intent === "ask") return "Does not publish ask.choice";
  if (d.modelId === "macos" && m.intent === "display") return "Does not publish present.display";
  return "Lower priority than the active device";
}

/** A small seeded generator: the demo renders the same rows on server and client. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function generate(env: Env, count: number, seed: number): Call[] {
  const r = rng(seed);
  const users = ALL_USERS.filter((u) => u.env === env && u.activeDeviceId);
  const rows: Call[] = [];
  let mins = 2;
  for (let i = 0; i < count; i++) {
    const user = users[Math.floor(r() * users.length)];
    let m = MESSAGES[Math.floor(r() * MESSAGES.length)];
    const device = ownedDevice(user.activeDeviceId!)!;
    if (device.modelId === "macos" && (m.intent === "ask" || m.intent === "display")) m = MESSAGES[0];
    const others = user.devices.filter((d) => d.id !== device.id);
    const send = 120 + Math.floor(r() * 260);
    const seen = send + 300 + Math.floor(r() * 900);
    const roll = r();
    const isAsk = m.intent === "ask";
    let status: CallStatus = isAsk ? "answered" : "seen";
    if (i < 2) status = isAsk ? "seen" : "sent";
    else if (isAsk && roll < 0.16) status = "expired";
    else if (roll < 0.05) status = "accepted";
    const id = hex(0x4a10c3 + seed * 104729 + i * 40503);
    rows.push(
      blank({
        id: `del_${id}`,
        kind: "delivery",
        env,
        at: minsAgo(mins),
        userId: user.id,
        deviceId: device.id,
        modelId: device.modelId,
        capability: m.capability,
        intent: m.intent,
        status,
        title: m.text,
        requestId: `req_${hex(0x91b2e7 + seed * 15485 + i * 7919)}`,
        rulesVersion: RULES_IN_FORCE[env][categoryOf(device.modelId).id] ?? 1,
        segment: user.plan === "pro" && device.modelId === "g2" ? "plan:pro" : null,
        latencyMs: send,
        candidates: [
          { deviceId: device.id, verdict: "chosen", reason: "Active device, seen within the online window" },
          ...others.map((d) => ({ deviceId: d.id, verdict: "skipped" as const, reason: skipReason(d, user, m) })),
        ],
        marks: {
          queued: 40 + Math.floor(r() * 60),
          sent: status === "accepted" ? null : send,
          seen: status === "seen" || status === "answered" || status === "expired" ? seen : null,
          answered: status === "answered" ? seen + 4000 + Math.floor(r() * 40000) : null,
        },
        answer: status === "answered" ? (m.answers?.[Math.floor(r() * 2)] ?? null) : null,
      })
    );
    mins += 3 + Math.floor(r() * 26);
  }
  return rows;
}

const SPECIALS: Call[] = [
  blank({
    id: "del_7f3a91",
    kind: "delivery",
    env: "live",
    at: minsAgo(3),
    userId: "tech_1107",
    deviceId: "dev_g2_e115",
    modelId: "g2",
    capability: "present.notify",
    intent: "notify",
    status: "seen",
    title: "Hot work permit for Bay 9 expires in 30 minutes.",
    requestId: "req_c0417e",
    rulesVersion: 6,
    segment: null,
    latencyMs: 1284,
    candidates: [
      { deviceId: "dev_g2_6d20", verdict: "refused", reason: "device_offline at send, last seen 19 days ago" },
      { deviceId: "dev_g2_b7f3", verdict: "refused", reason: "device_offline at send, last seen 14 days ago" },
      { deviceId: "dev_g2_e115", verdict: "chosen", reason: "Next candidate, online and acknowledged the send" },
    ],
    marks: { queued: 52, sent: 1284, seen: 1910, answered: null },
  }),
  blank({
    id: "del_b84c02",
    kind: "delivery",
    env: "live",
    at: minsAgo(26),
    userId: "tech_1077",
    deviceId: "dev_g2_cc31",
    modelId: "g2",
    capability: "present.notify",
    intent: "message",
    status: "failed",
    errorCode: "needs_reauth",
    title: "Work order 5520 reassigned to you.",
    requestId: "req_a91d03",
    rulesVersion: 6,
    segment: "plan:pro",
    latencyMs: 210,
    candidates: [{ deviceId: "dev_g2_cc31", verdict: "refused", reason: "needs_reauth, the pairing token was revoked by the device" }],
    marks: { queued: 44, sent: null, seen: null, answered: null },
  }),
  blank({
    id: "del_c1d9e4",
    kind: "delivery",
    env: "live",
    at: minsAgo(41),
    userId: "tech_1084",
    deviceId: "dev_g2_18e7",
    modelId: "g2",
    capability: "present.notify",
    intent: "message",
    status: "seen",
    title: "Commissioning checklist for chiller CH-3: verify flow switch, confirm glycol ratio, log delta T at full load, then photograph the nameplate and attach it to the work order before you leave site.",
    requestId: "req_6e22b1",
    rulesVersion: 6,
    latencyMs: 342,
    candidates: [
      { deviceId: "dev_g2_18e7", verdict: "chosen", reason: "Active device, seen within the online window" },
      { deviceId: "dev_desk_fa02", verdict: "skipped", reason: "Lower priority than the active device" },
    ],
    marks: { queued: 61, sent: 342, seen: 1120, answered: null },
    truncated: { kept: 4, of: 7 },
  }),
  blank({
    id: "del_e20f77",
    kind: "delivery",
    env: "live",
    at: minsAgo(68),
    userId: "tech_1168",
    deviceId: "dev_g2_61f8",
    modelId: "g2",
    capability: "ask.choice",
    intent: "ask",
    status: "answered",
    title: "Customer asks to reschedule. Offer Thursday?",
    requestId: "req_2bc4d8",
    rulesVersion: 6,
    segment: "plan:pro",
    latencyMs: 188,
    candidates: [{ deviceId: "dev_g2_61f8", verdict: "chosen", reason: "Only unblocked device" }],
    marks: { queued: 48, sent: 188, seen: 790, answered: 24_600 },
    answer: "Offer Thursday",
  }),
  blank({
    id: "del_55aa10",
    kind: "delivery",
    env: "live",
    at: minsAgo(92),
    userId: "tech_1091",
    deviceId: "dev_g2_3a6d",
    modelId: "g2",
    capability: "present.notify",
    intent: "notify",
    status: "failed",
    errorCode: "device_offline",
    title: "Tomorrow's route is ready to review.",
    requestId: "req_71fe9a",
    rulesVersion: 6,
    latencyMs: 402,
    candidates: [{ deviceId: "dev_g2_3a6d", verdict: "refused", reason: "device_offline at send, no other device on this user" }],
    marks: { queued: 57, sent: null, seen: null, answered: null },
  }),
];

function request(id: string, mins: number, method: string, path: string, status: number, userId: string | null, key: string, code: ErrorCode | null = null): Call {
  return blank({
    id,
    kind: "request",
    env: "live",
    at: minsAgo(mins),
    userId,
    title: `${method} ${path}`,
    status: status < 400 ? "ok" : "failed",
    errorCode: code,
    requestId: id,
    latencyMs: 40 + (mins % 7) * 23,
    http: { method, path, status, key },
  });
}

const REQUESTS: Call[] = [
  request("req_f1a0c7", 5, "GET", "/v1/users/tech_1042/context", 200, "tech_1042", "sk_live_8fQ2"),
  request("req_e8d311", 14, "POST", "/v1/connect/sessions", 201, "tech_1219", "sk_live_8fQ2"),
  request("req_d02b6e", 37, "GET", "/v1/devices/dev_g2_77d0", 200, "tech_1058", "sk_live_8fQ2"),
  request("req_b4471c", 58, "POST", "/v1/deliver", 409, "tech_1134", "sk_live_8fQ2", "needs_reauth"),
  request("req_907ec2", 110, "GET", "/v1/users/tech_9999/context", 404, null, "sk_live_8fQ2", "not_found"),
  request("req_33ca51", 145, "POST", "/v1/deliver", 429, "tech_1084", "sk_live_Ld71", "rate_limited"),
  request("req_1dd94f", 230, "POST", "/v1/devices/dev_g2_a2f9/actions", 200, "tech_1063", "sk_live_8fQ2"),
];

function hook(id: string, mins: number, endpointId: string, event: string, userId: string | null, status: CallStatus, attempts: { mins: number; status: number | null; note: string }[]): Call {
  return blank({
    id,
    kind: "webhook",
    env: "live",
    at: minsAgo(mins),
    userId,
    title: event,
    status,
    latencyMs: 120 + (mins % 5) * 90,
    webhook: { endpointId, event, attempts: attempts.map((a) => ({ at: minsAgo(a.mins), status: a.status, note: a.note })) },
  });
}

const WEBHOOKS: Call[] = [
  hook("whk_90e1b4", 1, "wh_ops", "device.offline", "tech_1204", "retrying", [
    { mins: 1, status: 500, note: "Internal server error" },
  ]),
  hook("whk_61c7ad", 7, "wh_prod", "ask.answered", "tech_1168", "ok", [{ mins: 7, status: 200, note: "Delivered on first attempt" }]),
  hook("whk_2fb830", 19, "wh_ops", "device.online", "tech_1042", "retrying", [
    { mins: 19, status: 500, note: "Internal server error" },
    { mins: 14, status: 500, note: "Retry after 5 minutes" },
  ]),
  hook("whk_77de02", 26, "wh_prod", "connection.needs_reauth", "tech_1077", "ok", [{ mins: 26, status: 200, note: "Delivered on first attempt" }]),
  hook("whk_0ac4f9", 44, "wh_ops", "device.offline", "tech_1120", "failed", [
    { mins: 760, status: 500, note: "Internal server error" },
    { mins: 760, status: 500, note: "Retry after 5 seconds" },
    { mins: 755, status: 503, note: "Retry after 5 minutes" },
    { mins: 725, status: 500, note: "Retry after 30 minutes" },
    { mins: 605, status: null, note: "Connection timed out" },
    { mins: 305, status: 500, note: "Retry after 5 hours" },
    { mins: 44, status: 500, note: "Attempts exhausted, moved to dead letter" },
  ]),
  hook("whk_c31f6a", 66, "wh_prod", "action.completed", "tech_1063", "ok", [{ mins: 66, status: 200, note: "Delivered on first attempt" }]),
  hook("whk_a8e5d2", 98, "wh_prod", "connection.created", "tech_1219", "ok", [{ mins: 98, status: 200, note: "Delivered on first attempt" }]),
];

const TEST_ROWS: Call[] = [
  blank({
    id: "del_te5701",
    kind: "delivery",
    env: "test",
    at: minsAgo(11),
    userId: "qa_lab_1",
    deviceId: "dev_sim_a102",
    modelId: "g2",
    capability: "ask.choice",
    intent: "ask",
    status: "failed",
    errorCode: "device_offline",
    title: "Magic id sim_device_offline, expected refusal.",
    requestId: "req_te88a1",
    rulesVersion: 7,
    latencyMs: 34,
    candidates: [{ deviceId: "dev_sim_a102", verdict: "refused", reason: "device_offline, returned by the test magic id" }],
    marks: { queued: 12, sent: null, seen: null, answered: null },
  }),
];

export const ALL_CALLS: readonly Call[] = [...generate("live", 58, 7), ...generate("test", 16, 21), ...SPECIALS, ...REQUESTS, ...WEBHOOKS, ...TEST_ROWS].sort(
  (a, b) => Date.parse(b.at) - Date.parse(a.at)
);

export const callById = (id: string): Call | null =>
  ALL_CALLS.find((c) => c.id === id || c.requestId === id) ?? null;

export const STATUS_LABEL: Record<CallStatus, string> = {
  accepted: "Accepted",
  sent: "Sent",
  seen: "Seen by device",
  answered: "Answered",
  failed: "Failed",
  expired: "No answer",
  ok: "Succeeded",
  retrying: "Retrying",
};

export const KIND_LABEL: Record<CallKind, string> = { delivery: "Delivery", request: "Request", webhook: "Webhook" };

export interface TimelineStep {
  key: string;
  label: string;
  state: "done" | "skipped" | "failed" | "pending" | "unknowable";
  detail?: string;
  at?: number | null;
}

/** The delivery as a trail: each step says what is known, and what cannot be. */
export function timelineOf(call: Call): TimelineStep[] {
  const device = call.deviceId ? ownedDevice(call.deviceId) : null;
  const user = call.userId ? userById(call.userId) : null;
  const chosen = call.candidates.find((c) => c.verdict === "chosen");
  const excluded = call.candidates.filter((c) => c.verdict !== "chosen");
  const isAsk = call.intent === "ask";
  const steps: TimelineStep[] = [
    { key: "accepted", label: "Accepted", state: "done", detail: "The API validated the call and returned 202", at: 0 },
    {
      key: "candidates",
      label: "Candidates",
      state: "done",
      detail: `${call.candidates.length} of ${user?.devices.length ?? call.candidates.length} on this user considered`,
    },
    {
      key: "filters",
      label: "Filters",
      state: excluded.length ? "skipped" : "done",
      detail: excluded.length ? `${excluded.length} excluded, reasons listed below` : "No device excluded",
    },
    {
      key: "chosen",
      label: "Chosen device",
      state: chosen ? "done" : "failed",
      detail: chosen ? `${device?.name ?? "Device"}, ${chosen.reason.toLowerCase()}` : "No candidate could take this delivery",
    },
    {
      key: "rules",
      label: "Rules version",
      state: "done",
      detail: `${device?.name ?? "Device"} v${call.rulesVersion ?? 1}${call.segment ? `, segment ${call.segment}` : ""}${call.truncated ? `, truncated to ${call.truncated.kept} of ${call.truncated.of} lines` : ""}`,
    },
    { key: "queued", label: "Queued", state: call.marks.queued === null ? "pending" : "done", at: call.marks.queued },
    {
      key: "sent",
      label: "Sent",
      state: call.marks.sent !== null ? "done" : call.errorCode ? "failed" : "pending",
      detail: call.errorCode ? `Refused with ${call.errorCode}` : call.marks.sent !== null ? "Handed to the device connection" : "Waiting for the connection",
      at: call.marks.sent,
    },
    {
      key: "seen",
      label: "Seen by device",
      state: call.marks.seen !== null ? "done" : call.errorCode ? "failed" : "pending",
      detail: call.marks.seen !== null ? "The device acknowledged the render" : call.errorCode ? "Never reached a device" : "No acknowledgement yet",
      at: call.marks.seen,
    },
  ];
  steps.push(
    isAsk
      ? {
          key: "answered",
          label: "Answered",
          state: call.marks.answered !== null ? "done" : call.status === "expired" ? "failed" : "pending",
          detail: call.marks.answered !== null ? `"${call.answer}"` : call.status === "expired" ? "Timed out with no answer" : "Waiting for the user",
          at: call.marks.answered,
        }
      : { key: "answered", label: "Answered", state: "unknowable", detail: "Not applicable, this intent takes no answer" }
  );
  steps.push({ key: "read", label: "Read by the person", state: "unknowable", detail: "Not knowable, a device reports the render and never the glance" });
  return steps;
}

/** Deliveries per day, ending today, scaled so the last seven days sum to `total7d`. */
export function dailySeries(total7d: number, days: number): { key: string; value: number; label: string; tick: string }[] {
  const shape = [0.82, 1.08, 1.12, 1.16, 1.04, 0.42, 0.36];
  const week = shape.reduce((a, b) => a + b, 0);
  const out: { key: string; value: number; label: string; tick: string }[] = [];
  let tail = 0;
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.parse(DEMO_NOW) - i * 86_400_000);
    const dow = date.getUTCDay();
    const drift = 1 - (i / Math.max(days, 1)) * 0.28;
    const value = Math.round(((shape[(dow + 6) % 7] * total7d) / week) * drift * (1 + ((i * 7) % 5) * 0.01));
    if (i < 7) tail += value;
    const tick = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    out.push({ key: String(i), value, label: `${tick} · ${value.toLocaleString("en-US")} deliveries`, tick });
  }
  // Scale the rounding error into today so the week really sums to the headline figure.
  const today = out[out.length - 1];
  today.value = Math.max(0, today.value + total7d - tail);
  today.label = `${today.tick} · ${today.value.toLocaleString("en-US")} deliveries`;
  return out;
}
