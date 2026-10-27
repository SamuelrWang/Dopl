import { DEVICE_ID, json, PLANNED } from "./shared";
import type { DocBlock, DocPage } from "./types";

/**
 * Concepts, second half: context profiles and routing (C5, the headline page), displays (C6),
 * events and analytics (C8). ⚠ This restates the BUILT behaviour in
 * `src/features/device-sdk/delivery/` (`resolve-profile.ts`, `router.ts`, `enforce.ts`,
 * `intents.ts`, `default-profiles.ts`); `content.test.ts` holds the defaults table, the fallback
 * order and the intent table to those modules. D3 is the rule this file must never bend: Dopl
 * ENFORCES limits (truncate, send to another device kind, or callback) and NEVER rewrites content.
 */

/** The AR glasses override the routing page and the glasses guide both show. Contract-valid. */
export const AR_GLASSES_PROFILE = {
  id: "ar-glasses",
  match: { kind: "glasses" },
  prompt_append:
    "The user is wearing AR glasses and is probably on the move. Answer in at most three short plain lines, lead with the answer, and offer choices as options instead of asking them to type.",
  output: { max_lines: 3, max_chars: 240, format: "plain", markdown: false },
  allowed_capabilities: ["present.*", "ask.*"],
  confirmation: { T3: "on_device", T4: "deny" },
  overflow: { send_to: "phone" },
};

/** Dopl's per-kind defaults (`default-profiles.ts › DOPL_KIND_PROFILES`): kind, id, max lines, max chars, format, overflow. */
export const DEFAULT_PROFILE_ROWS: [kind: string, id: string, maxLines: number | null, maxChars: number | null, format: string, overflow: string][] = [
  ["glasses", "glasses-default", 5, 300, "plain", "send_to phone"],
  ["phone", "phone-default", null, 2000, "markdown", "truncate"],
  ["desktop", "desktop-default", null, null, "markdown", "truncate"],
  ["watch", "watch-default", 2, 100, "plain", "send_to phone"],
  ["home_hub", "home_hub-default", 4, 400, "plain", "truncate"],
  ["home_device", "home_device-default", null, null, "plain", "truncate"],
  ["vehicle", "vehicle-default", 1, 120, "plain", "truncate"],
  ["robot", "robot-default", null, null, "plain", "truncate"],
];

/** `router.ts › FALLBACK_KIND_ORDER`. */
export const FALLBACK_ORDER = ["phone", "glasses", "watch", "desktop", "home_hub", "vehicle", "home_device", "robot"];

/** `intents.ts › capabilitiesFor`: intent, the capabilities it accepts in preference order. */
export const INTENT_ROWS: [intent: string, capabilities: string][] = [
  ["message", "`present.display`, then `present.notify`, then `present.speak`"],
  ["notify", "`present.notify`, then `present.display`"],
  ["display", "`present.display`"],
  ["ask", "`ask.choice` with two or more `options` or a `choice` block, otherwise `ask.text`, then `ask.confirm`"],
];

const p = (text: string): DocBlock => ({ type: "p", text });
const lim = (n: number | null) => (n === null ? "None" : String(n));

export const ROUTING_PAGES: DocPage[] = [
  {
    slug: "concepts/context-profiles-and-routing",
    tab: "about",
    group: "Concepts",
    title: "Context profiles and routing",
    description: "How Dopl picks a device, tells your agent how to write for it and holds the output to its limits",
    status: "coming_soon",
    blocks: [
      PLANNED,
      p(
        "A reply that reads well on a laptop is too long for a lens, and a question that works on a phone is unsafe in a car. Dopl handles this with context: it knows which device the user is on, hands your agent a profile that says how to write for that device, and enforces the device's limits on the way out without changing a word. Dopl ships a default profile for every device kind, and each project can replace any of them."
      ),
      { type: "h2", text: "The context object" },
      p(
        "Read a user's context with `GET /v1/users/{external_user_id}/context`, or `dopl.users.context()` in the SDK. The project MCP server's `context` tool returns the same object, and its `deliver` tool includes it in every result."
      ),
      {
        type: "code",
        tabs: [
          {
            label: "200",
            code: json({
              active_device: { id: DEVICE_ID, kind: "glasses", model: "even_g2", last_seen_s: 4 },
              posture: "glanceable",
              available: [{ kind: "glasses", id: DEVICE_ID, capabilities: ["presence.read", "present.notify", "present.display", "ask.choice", "input.utterance", "input.tap"] }],
              profile: {
                id: AR_GLASSES_PROFILE.id,
                prompt_append: AR_GLASSES_PROFILE.prompt_append,
                output: AR_GLASSES_PROFILE.output,
              },
              source_of_last_message: null,
            }),
          },
        ],
      },
      p(
        "`active_device` is the user's most recently seen online device, and `available` lists every online device with its capabilities. `posture` is inferred from the active device's kind: `glanceable` on glasses and watches, `seated` at a desktop, `driving` in a vehicle, `hands_free` near a home hub, and `unknown` otherwise. `profile` is the profile that applies to the active device. `source_of_last_message` is reserved for the kind of device the user last spoke from, and stays `null` until device input is recorded."
      ),
      { type: "h2", text: "Profiles" },
      p("A context profile applies to devices by kind, model or posture."),
      {
        type: "table",
        columns: ["Field", "What it does"],
        rows: [
          ["`match`", "Which devices the profile applies to: any of `kind`, `model` and `posture`, all of which must hold"],
          ["`prompt_append`", "Text your agent appends to its system prompt while the user is on a matching device"],
          ["`output`", "The limits Dopl enforces: `max_lines` and `max_chars`, plus the `format` (`plain`, `markdown` or `blocks`) and `markdown` your agent should write in"],
          ["`allowed_capabilities`", "The capabilities requests may use on a matching device, such as `present.*`"],
          ["`confirmation`", "How each risk tier is confirmed: `none`, `on_device`, `trusted_surface` or `deny`"],
          ["`overflow`", "What happens when content exceeds the limits: `truncate`, `callback` or `{ \"send_to\": <kind> }`"],
          ["`version`", "Every saved change is a new version, and each event records the version that applied"],
        ],
      },
      { type: "h2", text: "Dopl defaults" },
      p(
        "Every device kind has a default profile, so a project with no configuration still gets output that fits. The glasses default carries the same guidance Dopl's own agents use on the lens: about five short plain lines, no tables, code or long lists, and anything glasses cannot do left for the user's computer. Even Realities G2 glasses get `even_g2-default`, which is the glasses default with the lens limits taken from the G2's own descriptors."
      ),
      {
        type: "table",
        columns: ["Kind", "Profile", "Max lines", "Max characters", "Format", "Overflow"],
        rows: DEFAULT_PROFILE_ROWS.map(([kind, id, lines, chars, format, overflow]) => [
          `\`${kind}\``,
          `\`${id}\``,
          lim(lines),
          lim(chars),
          `\`${format}\``,
          `\`${overflow}\``,
        ]),
      },
      p("Every default denies T4 capabilities, and the device's own descriptors can set tighter limits than the profile, in which case the tighter one wins."),
      { type: "h2", text: "Customize a profile" },
      p(
        "A project profile replaces the default for every device it matches. For example, an assistant built for AR glasses can append its own instructions to the system prompt whenever the user is wearing them, tighten the limits and send anything longer to the phone:"
      ),
      { type: "code", tabs: [{ label: "ar-glasses", code: json(AR_GLASSES_PROFILE) }] },
      {
        type: "quote",
        text: "Profiles are configured by Dopl for each design partner today. Send your profile to [sales@usedopl.com](mailto:sales@usedopl.com) and it is applied to your project. A self serve editor comes with the developer portal.",
      },
      p("Your agent then reads the matched profile from the context before each turn and appends it to its system prompt:"),
      {
        type: "code",
        tabs: [
          {
            label: "TypeScript",
            code: [
              `const context = await dopl.users.context("usr_123");`,
              ``,
              `const system = [BASE_SYSTEM_PROMPT, context.profile?.prompt_append].filter(Boolean).join("\\n\\n");`,
            ].join("\n"),
          },
        ],
      },
      { type: "h2", text: "Which profile applies" },
      p("For each candidate device, Dopl takes the first of these that exists:"),
      {
        type: "list",
        ordered: true,
        items: [
          "The project profile you name with `profile` on a Deliver request, for that request only. An ID with no active profile fails with `invalid_request`.",
          "Your project profile whose `match` fits the device. When several fit, the most specific wins: a `model` match beats a `kind` match, which beats a `posture` match, and a tie goes to the higher version.",
          "A Dopl model default, such as `even_g2-default`.",
          "The Dopl default for the device kind, which always exists.",
        ],
      },
      { type: "h2", text: "Routing" },
      p("Deliver takes a `target`: `auto` (the default) considers every device the user has connected, a device kind considers only devices of that kind, and a device ID considers only that device. Dopl then picks in four steps:"),
      {
        type: "list",
        ordered: true,
        items: [
          "**Filter.** Keep the devices that are online, publish a capability the intent accepts that their profile also allows, and are covered by the user's grant.",
          `**Rank.** The device kind the user last spoke from comes first once device input is recorded, then the most recently seen device, then the fallback order: ${FALLBACK_ORDER.map((k) => `\`${k}\``).join(", ")}.`,
          "**Apply `urgency`.** `normal` reaches the top device. `high` reaches every eligible device at once, the top one with the full content and the others held to their own limits. `low` reaches only the active device, and fails with `device_offline` if that device cannot take it.",
          "**Record the decision.** The response's `routed_to` names the device and the reason, and the event for the call stores the reason and every candidate.",
        ],
      },
      p(
        "When nothing is left, the error names the step that emptied the list: `device_offline` when no device is online, `capability_unsupported` when none can take the intent, the grant's own code when none is granted, and `not_found` for an unknown device ID."
      ),
      { type: "h3", text: "Intents and capabilities" },
      {
        type: "table",
        columns: ["Intent", "Capabilities it accepts"],
        rows: INTENT_ROWS.map(([intent, caps]) => [`\`${intent}\``, caps]),
      },
      { type: "h2", text: "Limits are enforced, never rewritten" },
      p(
        "Dopl never rewrites or summarizes your agent's words. Your model writes for the device using the profile, which keeps your voice and keeps model costs on your side, and Dopl only enforces the limits: the tighter of the profile's `output` and the device's descriptor for the capability in use. When content still exceeds them, `overflow` decides what happens:"
      ),
      {
        type: "table",
        columns: ["`overflow`", "Result"],
        rows: [
          ['`"truncate"`', "Dopl delivers an exact prefix of the content: lines first, then characters, then whole UTF-8 characters, and whole blocks up to the device's block limit. Nothing is added, not even an ellipsis, and the reason in `routed_to` says it was truncated"],
          ['`{ "send_to": "phone" }`', "Dopl delivers the unchanged content to the user's device of that kind, under that device's own profile. If the user has none, or it is too long there as well, Dopl truncates instead"],
          ['`"callback"`', "Dopl delivers nothing, sets the status to `failed` and returns the limits and what it measured in `overflow_callback`, so your agent can write a shorter version"],
        ],
      },
      {
        type: "code",
        tabs: [
          {
            label: "202 callback",
            code: json({
              delivery_id: "4f7e2a10-6c1b-4d9e-8a35-0b2c7d9e1f42",
              routed_to: { device_id: DEVICE_ID, kind: "glasses", reason: "fallback chain" },
              status: "failed",
              overflow_callback: {
                profile_id: "ar-glasses",
                limits: { max_lines: 3, max_chars: 240, max_bytes: 960, max_blocks: 12 },
                measured: { lines: 9, chars: 812, bytes: 812, blocks: 0 },
              },
            }),
          },
        ],
      },
    ],
  },
  {
    slug: "concepts/displays",
    tab: "about",
    group: "Concepts",
    title: "Displays",
    description: "One block vocabulary for every screen, from a glasses lens to a desktop",
    status: "coming_soon",
    blocks: [
      PLANNED,
      p(
        "Your agent describes a screen as a list of display blocks, and each device renders them within its own limits. The vocabulary is the one Dopl uses on Even Realities G2 glasses today, where agents build screens from blocks with `glasses_render` through the [hosted MCP server](/docs/sdks/hosted-mcp). The Device SDK uses it on every device that publishes `present.display`, and adds images."
      ),
      { type: "h2", text: "Blocks" },
      {
        type: "table",
        columns: ["Block", "Fields", "Limits"],
        rows: [
          ["`heading`", "`text`", "120 characters"],
          ["`text`", "`content`, optional `tone` (`muted` or `strong`), `lines`, `brightness`, `border`", "2,000 characters, 1 to 40 lines, brightness 0 to 4"],
          ["`fields`", "`rows` of `label` and `value`", "12 rows"],
          ["`list`", "`items`, optional `style: number`", "20 items of 200 characters"],
          ["`choice`", "`options` of `label`, `description`, `recommended`, `why`", "2 to 12 options, one choice block per screen"],
          ["`progress`", "`value` from 0 to 1, optional `label`", ""],
          ["`table`", "`columns` and `rows`", "2 to 4 columns, 10 rows"],
          ["`divider`", "", ""],
          ["`spacer`", "optional `lines`", "1 to 4 lines"],
          ["`image`", "`url` (https), `alt`, optional `width` and `height`", "`alt` is required"],
        ],
      },
      p("A screen holds up to 24 blocks, and every block has an `id` unique on that screen."),
      { type: "h2", text: "Fitting each device" },
      p(
        "Each device's `present.display` descriptor states its limits, such as the number of blocks and the bytes of text it can show. The G2 lens, for example, is 576 by 248 pixels, monochrome and holds 12 blocks. When a screen is too large, the profile's `overflow` applies: with `truncate`, Dopl keeps the first blocks that fit and cuts the text of `heading` and `text` blocks to an exact prefix."
      ),
      { type: "h2", text: "Planned" },
      p(
        "Saved templates with `{{var}}` placeholders, a preview of each device's screen in the developer portal, and your own on device renderer, such as an Even Hub plugin under your brand, with Dopl handling transport and auth."
      ),
      p("[Build a custom display](/docs/guides/custom-display) walks through a full example."),
    ],
  },
  {
    slug: "concepts/events-and-analytics",
    tab: "about",
    group: "Concepts",
    title: "Events and analytics",
    description: "One event for every call, recorded from the first request",
    status: "coming_soon",
    blocks: [
      PLANNED,
      p(
        "Every call to the API, whether from your server, the SDK or the project MCP server, writes exactly one event, including calls that fail or are refused. Its ID is the `Request-Id` header on the response. Events are kept for 30 days."
      ),
      { type: "h2", text: "What an event records" },
      {
        type: "table",
        columns: ["Area", "Fields"],
        rows: [
          ["Who", "`project_id`, `env`, `external_user_id`, `connection_id`"],
          ["Which device", "`device_id`, `device_kind`, `vendor`, `model`, `firmware`, `adapter_version`"],
          ["What", "`capability`, `intent`, `risk_tier`"],
          ["Why there", "`route_decision` with the `target`, `reason` and `candidates`, plus `profile_id` and `profile_version`"],
          ["How it went", "`outcome` (`ok`, `error` or `denied`), `error_code`, `confirmation`"],
          ["Cost", "`latency_ms` for the API, device delivery and user response, `bytes_in`, `bytes_out`, `cost_units`"],
        ],
      },
      { type: "h2", text: "Webhooks" },
      p(
        "Webhook delivery comes with the developer portal. These are the events it will send; the connection events are already recorded today."
      ),
      {
        type: "table",
        columns: ["Event", "When"],
        rows: [
          ["`connection.created`, `connection.revoked`, `connection.needs_reauth`", "A connection changes"],
          ["`device.online`, `device.offline`", "A device comes or goes"],
          ["`action.completed`, `action.failed`", "An action reaches a final status"],
          ["`ask.answered`", "The user answers a question"],
          ["`input.utterance`", "The user speaks to a device"],
        ],
      },
      { type: "h2", text: "Analytics" },
      p(
        "The developer portal and an analytics API will report active users and devices by kind, your device mix, top capabilities and intents, error rates by vendor and firmware, latency at p50 and p95, where routed messages landed, profile comparisons, and usage for billing."
      ),
    ],
  },
];
