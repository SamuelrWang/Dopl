/**
 * THE NOTIFICATION EVENT REGISTRY — Samuel's ruling of 2026-10-09 (KB dopl-development
 * "Notification Spec Samuel 2026-10-09"; triggers at file:line in "Notification Surface Map
 * 2026-10-09"). One list, read by the profile popup's Notifications tab AND restated by the
 * desktop banner gate (`dopl-desktop-app/main/notification-prefs.js › EVENT_IDS`).
 *
 * ⚠ CODE CONST, NOT A TABLE, AND NOW THE ONLY CEILING. The server table deliberately has no
 * `event_type` CHECK (migration 20261117120000): an enumerated constraint was a ceiling that
 * would need a migration per event, so THIS list is the domain, enforced at the single writer
 * (`server/repository.ts`) and by the route's zod schema derived from it. A new event is a row
 * here, a row in the desktop's `EVENT_IDS`, and an arm at its trigger — on one clock.
 *
 * ⚠ NAMED ≠ RAISED: read `wired`. An id exists here so storage, validation and the parity test
 * all know it; `wired` says whether anything actually raises it yet. The panel shows ONLY wired
 * events, because a switch for an event nothing raises is a control that lies — the same bug
 * class as a switch that cannot mute (see the fail-ON note below), inverted.
 *
 * ⚠ THE DESKTOP RESTATES THIS LIST AND `allowsIn` FAILS TOWARD ON for an id it cannot name
 * (`notification-prefs.js:69`). So an id added here and missed there is a switch the operator can
 * turn OFF and still get banners from: a silently unmutable notification. Fenced by
 * `dopl-desktop-app/test/notification-prefs.test.mjs` ("registry ids match the web registry"),
 * which reads this file as TEXT and regex-extracts the array below with `/"([a-z_]+)"/g`.
 * ⚠ KEEP EVERY ID LOWER-SNAKE. An id carrying a digit or a dash extracts partially and fails that
 * test spuriously; widen the charset there in the same commit that adds such an id.
 *
 * ⚠ `approval` AND THE FOUR SAFETY EVENTS ARE LOCKED ON. Approvals carry the ONE button that
 * answers them (`notify-action.js › buildActionNotification`), and the safety four each mark work
 * STOPPING silently — Samuel kept them deliberately at #2775 ("always on, like approvals"). A
 * locked row shows its state and cannot be switched off. Not a dead row: it states a real fact.
 */

export const NOTIFICATION_EVENT_IDS = [
  "mention",
  "decision",
  "direct_message",
  "approval",
  "peer_ask",
  "draft_reply",
  "agent_started",
  "signed_out",
  "credits_exhausted",
  "runtime_signin",
  "decision_failed",
  "tool_blocked",
  "session_resume",
  "shared_with_me",
] as const;

export type NotificationEventId = (typeof NOTIFICATION_EVENT_IDS)[number];

/**
 * WHERE AN EVENT RAISES ITSELF when it is on.
 * - `mac` — an OS banner, raised in Electron main.
 * - `popup` — the in-app toast (`toast.tsx`), a renderer global.
 * - `both` — ⚠ NEEDS THE DEDUPE PRIMITIVE, which does not exist yet: main's only route into the
 *   renderer is `bridge.onNavigate`, so one event cannot raise both without firing twice. The
 *   focus check at `runtime-credentials.js:83` is the pattern; `runtime_signin` is the one event
 *   that already splits correctly today.
 */
export type NotificationSurface = "mac" | "popup" | "both";

export interface NotificationEvent {
  id: NotificationEventId;
  /** The row name. Also the key into the settings help table (`settings-help.tsx`). */
  label: string;
  /** Where it raises when on. */
  surface: NotificationSurface;
  /** True when the operator cannot turn it off (see the file header). */
  locked?: boolean;
  /** Omitted = on. `false` = the record's default is OFF for this one event. */
  defaultOn?: boolean;
  /** True when something actually raises this event today. The panel shows only these. */
  wired?: boolean;
}

export const NOTIFICATION_EVENTS: ReadonlyArray<NotificationEvent> = [
  // ── Wired today ────────────────────────────────────────────────────────────────────────────
  // ⚠ BOTH ROUTE THROUGH `notification-route.js` as of 2026-10-09, so each resolves to ONE
  // surface: the toast while Dopl is in front, the OS banner while it is away. `mention` has TWO
  // call sites — `trigger.js › sendFyi` for a tag in the room, and `task-notify.js ›
  // notifyTaskReply` for a tag inside a thread I opened, which classify ranks 'task-reply' so it
  // never reaches sendFyi. They share one copy builder so a tag reads the same either way.
  { id: "mention", label: "Mentions and replies", surface: "both", wired: true },
  { id: "decision", label: "Decisions for you", surface: "both", wired: true },
  // ⚠ RULED OFF, BUT KEPT AS A SWITCH (Samuel #2773: "we're not going to do direct message";
  // @orchestrator #2769-answer: keep the id, default OFF). `defaultOn: false` is the ruling, so
  // for THIS row an unreadable record reads OFF — which is the state he asked for, not a silent
  // mute. Re-adding a removed id later would touch both lists and that regex, so it stays.
  { id: "direct_message", label: "Direct messages", surface: "mac", defaultOn: false, wired: true },
  // ⚠ ALWAYS THE BANNER, never focus-gated (Samuel, 2026-10-09). There is no in-app tool-gate
  // surface, so that banner is the only place the question is asked, and
  // `session-windowless.js:293` denies the held tool on a falsy notification — a focused path
  // that answered with an auto-dismissing toast would turn "he was looking at Dopl" into
  // "the tool was refused". ⚠ AND THAT IS WHY `locked` MATTERS HERE BEYOND THE UI: unlock it and
  // muting it would start auto-denying held tools.
  { id: "approval", label: "Approvals", surface: "both", locked: true, wired: true },

  // Samuel KEPT this one when asked (2026-10-09): a peer's agent is blocked on a launch and this
  // is the only thing that says so. Banner with "Launch agent" when away; focused, a toast whose
  // button only OPENS the channel. Default ON, NOT locked.
  { id: "peer_ask", label: "A peer's agent asks you", surface: "both", wired: true },
  { id: "draft_reply", label: "Replies your agent drafted", surface: "both", wired: true },
  // Own-machine spawns only, including one agent launching another; a fan-out burst coalesces
  // into ONE banner (@orchestrator, 2026-10-09). No trigger exists: `task_started` is dropped at
  // `targeting.js:133`, so this needs a new emit.

  // ── Named, NOT raised yet (wired: false ⇒ no row in the panel) ──────────────────────────────
  { id: "agent_started", label: "An agent starts", surface: "both" },
  { id: "signed_out", label: "You get signed out", surface: "both", locked: true },
  // ⚠ NOTHING EMITS THIS FACT. The consume RPC returns nothing at `20260811130000:143` — no row,
  // no log, no realtime — so the emit is server work, OUT of this wave by decision. The id is
  // registered and stays unwired until that lands.
  { id: "credits_exhausted", label: "Credits run out", surface: "both", locked: true },
  { id: "runtime_signin", label: "Agent app needs sign-in", surface: "both", locked: true },
  { id: "decision_failed", label: "A decision didn't save", surface: "both", locked: true },
  { id: "tool_blocked", label: "A tool was blocked", surface: "popup" },
  { id: "session_resume", label: "Resume an interrupted session", surface: "popup" },
  { id: "shared_with_me", label: "Something shared with you", surface: "popup" },
];

/** The rows the Notifications tab draws: only events something actually raises. */
export const VISIBLE_NOTIFICATION_EVENTS: ReadonlyArray<NotificationEvent> =
  NOTIFICATION_EVENTS.filter((e) => e.wired);

export function isNotificationEventId(value: unknown): value is NotificationEventId {
  return (
    typeof value === "string" &&
    (NOTIFICATION_EVENT_IDS as ReadonlyArray<string>).includes(value)
  );
}
