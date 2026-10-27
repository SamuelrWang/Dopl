import { API, json, PLANNED } from "./shared";
import type { DocPage } from "./types";

/**
 * Concepts, second half: context profiles and routing (C5, the headline page), displays (C6),
 * events and analytics (C8). ⚠ D3 is the rule this file must never bend: Dopl ENFORCES limits
 * (truncate, send to another device kind, or callback) and NEVER rewrites content. Profile fields
 * mirror `@dopl/contracts/device-sdk › ContextProfileSchema` exactly.
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

export const ROUTING_PAGES: DocPage[] = [
  {
    slug: "concepts/context-profiles-and-routing",
    tab: "about",
    group: "Concepts",
    title: "Context profiles and routing",
    description: "Dopl tells your agent how to write for each device, and you decide every rule",
    status: "coming_soon",
    blocks: [
      PLANNED,
      {
        type: "p",
        text: "A reply that reads well on a laptop is too long for a lens, and a question that works on a phone is unsafe in a car. Dopl solves this with context: it knows which device the user is on, hands your agent a profile that says how to write for that device, and enforces the device's limits on the way out. Dopl ships sensible defaults for every device kind, and you can override any of them.",
      },
      { type: "h2", text: "The context object" },
      {
        type: "p",
        text: "Read a user's context with `GET /v1/users/{external_user_id}/context`. The project MCP server adds the same object to its tool results, so an agent connected over MCP receives it without asking.",
      },
      {
        type: "code",
        tabs: [
          {
            label: "200",
            code: json({
              active_device: { id: "dev_g2_01", kind: "glasses", model: "g2", last_seen_s: 4 },
              posture: "glanceable",
              available: [
                { kind: "glasses", id: "dev_g2_01", capabilities: ["present.display", "present.notify", "ask.choice"] },
                { kind: "desktop", id: "dev_mac_01", capabilities: ["presence.read", "present.notify"] },
              ],
              profile: {
                id: AR_GLASSES_PROFILE.id,
                prompt_append: AR_GLASSES_PROFILE.prompt_append,
                output: AR_GLASSES_PROFILE.output,
              },
              source_of_last_message: "glasses",
            }),
          },
        ],
      },
      {
        type: "p",
        text: "`posture` is one of `glanceable`, `hands_free`, `seated`, `driving` or `unknown`, and `source_of_last_message` is the kind of device the user last wrote from.",
      },
      { type: "h2", text: "Profiles" },
      {
        type: "p",
        text: "A context profile belongs to your project and applies to devices by kind, model or posture.",
      },
      {
        type: "table",
        columns: ["Field", "What it does"],
        rows: [
          ["`match`", "Which devices the profile applies to: any of `kind`, `model` and `posture`"],
          ["`prompt_append`", "Text your agent appends to its system prompt while the user is on a matching device"],
          ["`output`", "The limits Dopl enforces: `max_lines`, `max_chars`, `format` (`plain`, `markdown` or `blocks`) and `markdown`"],
          ["`allowed_capabilities`", "The capabilities requests may use on a matching device, such as `present.*`"],
          ["`display_template`", "A saved display template to render content into"],
          ["`confirmation`", "How each risk tier is confirmed: `none`, `on_device`, `trusted_surface` or `deny`"],
          ["`overflow`", "What happens when content exceeds `output`: see below"],
        ],
      },
      { type: "h2", text: "Dopl defaults" },
      {
        type: "p",
        text: "Every device kind has a default profile, so a project with no configuration still gets output that fits. The glasses default is the guidance Dopl's own agents use on the lens today: answer in about five short plain text lines, with no tables, code or long lists, put choices in display blocks, and leave anything glasses cannot do, such as approving permissions or typing long text, for the user's computer.",
      },
      { type: "h2", text: "Your overrides" },
      {
        type: "p",
        text: "Write a profile for any kind, model or posture and it replaces the default for your project. For example, an assistant built for AR glasses can append its own instructions to the system prompt whenever the user is wearing them, tighten the limits and send anything longer to the phone:",
      },
      { type: "code", tabs: [{ label: "ar-glasses", code: json(AR_GLASSES_PROFILE) }] },
      {
        type: "p",
        text: "Your agent then reads the matched profile from the context and appends it to its system prompt:",
      },
      {
        type: "code",
        tabs: [
          {
            label: "TypeScript",
            code: [
              `const context = await fetch("${API}/users/usr_123/context", { headers }).then((r) => r.json());`,
              ``,
              `const system = [BASE_SYSTEM_PROMPT, context.profile?.prompt_append].filter(Boolean).join("\\n\\n");`,
            ].join("\n"),
          },
        ],
      },
      {
        type: "p",
        text: "Profiles are versioned, and every event records the profile and version that applied, so you can compare two versions in analytics. Per user overrides are planned after project profiles.",
      },
      { type: "h2", text: "Which profile applies" },
      {
        type: "list",
        ordered: true,
        items: [
          "A profile you name on the request with `profile`, for that request only.",
          "Your project profile whose `match` fits the device.",
          "The Dopl default for the device kind.",
          "The per kind fallback, used when nothing above applies.",
        ],
      },
      { type: "h2", text: "Routing" },
      {
        type: "p",
        text: "When a request leaves `target` as `auto`, Dopl picks the device in four steps:",
      },
      {
        type: "list",
        ordered: true,
        items: [
          "Keep the devices that are present, support the capability the intent needs and are covered by the user's grants.",
          "Rank them by your rules. By default the device the last message came from wins, then the most recently active one, then the rest of your chain.",
          "Apply `urgency`: `high` may reach several devices at once, and `low` waits for the active device.",
          "Record the decision, the candidates and the reason on the event.",
        ],
      },
      {
        type: "p",
        text: "Set `target` to a device kind or a device ID to skip ranking. Every response includes `routed_to` with the device and the reason it was chosen.",
      },
      { type: "h2", text: "Limits are enforced, never rewritten" },
      {
        type: "p",
        text: "Dopl never rewrites or summarizes your agent's words. Your model writes for the device using the profile, which keeps your voice and keeps model costs on your side, and Dopl only enforces the limits. When content still exceeds them, `overflow` decides what happens:",
      },
      {
        type: "table",
        columns: ["`overflow`", "Result"],
        rows: [
          ['`"truncate"`', "Dopl cuts the content to the profile's limits and delivers it"],
          ['`{ "send_to": "phone" }`', "Dopl delivers the full content to the user's device of that kind instead"],
          ['`"callback"`', "Dopl delivers nothing and hands the content back, so your agent can write a shorter version"],
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
      {
        type: "p",
        text: "Your agent describes a screen as a list of display blocks, and each device renders them within its own limits. The vocabulary is the one Dopl uses on Even Realities G2 glasses today, where agents build screens from blocks with `glasses_render` through the [hosted MCP server](/docs/sdks/hosted-mcp). The Device SDK brings it to every device and adds images.",
      },
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
      {
        type: "p",
        text: "A screen holds up to 24 blocks, and every block has an `id` unique on that screen so you can update it in place.",
      },
      { type: "h2", text: "Fitting each device" },
      {
        type: "p",
        text: "Each device's `present.display` descriptor states its limits, and Dopl adapts blocks to them with per device rules. On a device without a raster screen, an `image` shows its `alt` text. The G2 lens, for example, is 576 by 248 pixels, monochrome and holds 12 blocks.",
      },
      { type: "h2", text: "Templates and previews" },
      {
        type: "p",
        text: "Save a screen as a project template with `{{var}}` placeholders and fill it per request, and preview how a screen will look on each device before you send it. A web simulator of every device's screen will double as the playground in the developer portal.",
      },
      { type: "h2", text: "Your own renderer" },
      {
        type: "p",
        text: "If blocks are not enough, you will be able to ship your own on device app, such as an Even Hub plugin, under your own brand, while Dopl handles transport and auth. This comes after the block path.",
      },
      { type: "p", text: "[Build a custom display](/docs/guides/custom-display) walks through a full example." },
    ],
  },
  {
    slug: "concepts/events-and-analytics",
    tab: "about",
    group: "Concepts",
    title: "Events and analytics",
    description: "One event for every call, webhooks for what happens next",
    status: "coming_soon",
    blocks: [
      PLANNED,
      {
        type: "p",
        text: "Every call through the REST API, an SDK or the MCP server writes one event. Events are recorded from the first call, because analytics cannot be filled in after the fact.",
      },
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
      {
        type: "p",
        text: "Webhooks are signed, retried on failure and can be replayed from the developer portal.",
      },
      { type: "h2", text: "Analytics" },
      {
        type: "p",
        text: "The developer portal and an analytics API will report active users and devices by kind, your device mix, top capabilities and intents, error rates by vendor and firmware, latency at p50 and p95, where routed messages landed, profile comparisons, and usage for billing.",
      },
    ],
  },
];
