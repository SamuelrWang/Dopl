/**
 * Every word in the Multiplayer row — card copy AND the strings drawn inside the
 * three animated visuals — in one place, so the copy can be edited without
 * touching markup. Markup: ./multiplayer-section.tsx, ./multiplayer-visuals.tsx,
 * ./multiplayer-thread.tsx.
 */

/** The user (Alex) as their Admin Assistant identity, shared by all three cards. */
export const AGENT = {
  name: "Alex",
  role: "Admin Assistant",
  audience: "External facing",
  /** Onboarding's primary face — not otherwise used on the landing. */
  photo: "/img/onboarding/onboarding-avatar.jpg",
  /** Runtime mark inset on the avatar. */
  runtimeLogo: "/img/onboarding/chatgpt-logo.svg",
  /** Agent colour-bank slot; 7 is ChatGPT's ring on the login journey. */
  color: 7,
} as const;

export const DOPL_MARK = "/img/onboarding/dopl-mark.png";

export const MULTIPLAYER_COPY = {
  identity: {
    title: "Identity building",
    body: "Each identity is a version of you in one role, ready for any agent to take on.",
    voiceLabel: "Voice",
    voiceFile: "voice-sample.m4a",
    toolsLabel: "Tools",
    tools: ["Google Calendar", "Google Sheets", "Gmail"],
    knowledgeLabel: "Knowledge",
    /** `source: "dopl"` rows wear the Dopl mark, `"notion"` the Notion mark. */
    knowledge: [
      { source: "dopl", name: "Scheduling preferences" },
      { source: "dopl", name: "Contacts" },
      { source: "notion", name: "Meeting notes" },
    ],
  },
  rules: {
    title: "Permissions and triage",
    body: "Set what each identity may do, and route the decisions that matter back to you.",
    rulesLabel: "Rules",
    rules: [
      "Book 30-min slots, Tue–Thu only",
      "Never share calendar details",
      "Nothing after 6pm",
      "CC me on every invite",
    ],
    escalateLabel: "Escalate to me",
    escalate: ["Pricing or contract questions", "Investor or press requests", "A reschedule after 2 tries"],
  },
  deploy: {
    title: "Real-world action",
    body: "Identities act for you across apps, people, and devices, far beyond a chat window.",
    contact: "Jordan Lee",
    /** In order. `from: "alex"` = the Admin Assistant, typing dots first.
     *  Timing is derived from this list (multiplayer-thread.tsx › schedule). */
    messages: [
      { from: "alex", text: "Hi Jordan, I'm Alex's admin assistant." },
      { from: "contact", text: "Hi! Great meeting Alex today. Free to chat next week?" },
      { from: "alex", text: "Let me check Alex's calendar." },
      { from: "alex", text: "Looks like Alex is free Thu 10am or Fri 2pm. Let me know if either works for you!" },
      { from: "contact", text: "Thu 10am works!" },
      { from: "alex", text: "Got it. What's a good email to send a GCal invite to?" },
      { from: "contact", text: "jordan@lee.co" },
      { from: "alex", text: "Got it! Just sent you a GCal invite." },
    ],
    /** The Dopl notification that slides down over the phone at the end. */
    notification: {
      app: "Dopl",
      mark: DOPL_MARK,
      time: "now",
      title: "Admin Assistant",
      body: "Scheduled a 30-min chat with Jordan · Thu 10am",
    },
  },
} as const;

