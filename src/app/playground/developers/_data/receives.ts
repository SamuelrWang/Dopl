/**
 * WHAT A DEVICE RECEIVES: rules set on a CATEGORY, overridden per MODEL, then narrowed by a segment:
 * Dopl's default, the category's value, the model's, the segment's. Versions are per category. Dopl only passes guidance to the agent and enforces limits (contract D3):
 * overflow is truncate, send_to or callback, and there is no rewrite option anywhere in this file.
 */
import { ALL_MODELS, categoryOf, modelById, type CategoryId, type Model, type ModelId } from "./catalog";
import { minsAgo } from "./company";

export type FieldKey =
  | "priority"
  | "fallback"
  | "agent_instructions"
  | "inbound_template"
  | "max_lines"
  | "max_chars"
  | "format"
  | "allowed_intents"
  | "ask_options"
  | "timeout_s"
  | "overflow"
  | "overflow_send_to"
  | "overflow_callback";

export type FieldValue = string | number | string[];
export type Layer = Partial<Record<FieldKey, FieldValue>>;
export type Segment = "all" | "plan:pro" | "plan:team" | "plan:free" | "region:eu-west";

export const SEGMENTS: { value: Segment; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "plan:pro", label: "plan:pro" },
  { value: "plan:team", label: "plan:team" },
  { value: "plan:free", label: "plan:free" },
  { value: "region:eu-west", label: "region:eu-west" },
];

export interface RuleSet {
  /** Set on the category: every model in it inherits. */
  category: Layer;
  /** A model's own overrides. */
  models: Partial<Record<ModelId, Layer>>;
  segments: Partial<Record<Segment, Layer>>;
}

/** What an edit writes to: the whole category, or one model. */
export type RuleScope = "category" | ModelId;

export interface RuleVersion {
  n: number;
  at: string;
  by: string;
  note: string;
  rules: RuleSet;
}

export interface ReceivesState {
  draft: RuleSet;
  versions: RuleVersion[];
  test: number;
  live: number;
}

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: FieldKey;
  label: string;
  control: "select" | "text" | "textarea" | "number" | "chips";
  options?: (model: Model) => FieldOption[];
  /** Only shown while this other field has one of these values. */
  when?: { key: FieldKey; is: string[] };
  max?: (model: Model) => number;
  min?: number;
  unit?: string;
}

export interface FieldGroup {
  title: string;
  fields: FieldDef[];
}

/** Other categories' live models: fallback and overflow route to a device kind the user may own. */
const SEND_TO = (model: Model): FieldOption[] =>
  ALL_MODELS.filter((m) => (m.id === "g2" || m.id === "macos") && m.id !== model.id).map((m) => ({ value: m.id, label: `${categoryOf(m.id).name} (${m.name})` }));

export const FIELD_GROUPS: FieldGroup[] = [
  {
    title: "Where",
    fields: [
      {
        key: "priority",
        label: "Priority",
        control: "select",
        options: () => [
          { value: "active_first", label: "Active device first" },
          { value: "this_first", label: "This device first" },
          { value: "only_if_alone", label: "Only when nothing else is online" },
          { value: "targeted_only", label: "Only when targeted by id" },
        ],
      },
      {
        key: "fallback",
        label: "Fallback",
        control: "select",
        options: (type) => [{ value: "none", label: "No fallback" }, { value: "queue", label: "Queue until online" }, ...SEND_TO(type)],
      },
    ],
  },
  {
    title: "How it sounds",
    fields: [
      { key: "agent_instructions", label: "Agent instructions", control: "textarea" },
      { key: "inbound_template", label: "Inbound template", control: "text" },
    ],
  },
  {
    title: "Length and format",
    fields: [
      { key: "max_lines", label: "Max lines", control: "number", min: 1, max: (t) => t.floor.maxLines, unit: "lines" },
      { key: "max_chars", label: "Max characters", control: "number", min: 20, max: (t) => t.floor.maxChars, unit: "chars" },
      {
        key: "format",
        label: "Format",
        control: "select",
        options: () => [
          { value: "plain", label: "Plain text" },
          { value: "markdown", label: "Markdown" },
          { value: "blocks", label: "Blocks" },
        ],
      },
    ],
  },
  {
    title: "Interaction",
    fields: [
      { key: "allowed_intents", label: "Allowed intents", control: "chips", options: (m) => m.intents.map((i) => ({ value: i, label: i })) },
      { key: "ask_options", label: "Ask options", control: "number", min: 2, max: (t) => t.floor.maxOptions, unit: "max" },
      { key: "timeout_s", label: "Answer timeout", control: "number", min: 10, max: () => 600, unit: "seconds" },
    ],
  },
  {
    title: "If too long",
    fields: [
      {
        key: "overflow",
        label: "Behaviour",
        control: "select",
        options: () => [
          { value: "truncate", label: "Truncate" },
          { value: "send_to", label: "Send to another device" },
          { value: "callback", label: "Call back your agent" },
        ],
      },
      { key: "overflow_send_to", label: "Send to", control: "select", options: SEND_TO, when: { key: "overflow", is: ["send_to"] } },
      { key: "overflow_callback", label: "Callback URL", control: "text", when: { key: "overflow", is: ["callback"] } },
    ],
  },
];

export const FIELD_DEFS: FieldDef[] = FIELD_GROUPS.flatMap((g) => g.fields);

export function defaultsFor(model: Model): Record<FieldKey, FieldValue> {
  const lens = model.surface === "lens";
  return {
    priority: "active_first",
    fallback: "none",
    agent_instructions: lens ? "Reply for a small lens. Lead with the action. One idea per line." : "Reply for a desktop notification. Keep it to a short paragraph.",
    inbound_template: "{{body}}",
    max_lines: lens ? model.floor.maxLines : 6,
    max_chars: lens ? 200 : 600,
    format: "plain",
    allowed_intents: [...model.intents],
    ask_options: Math.min(3, model.floor.maxOptions),
    timeout_s: 60,
    overflow: "truncate",
    overflow_send_to: model.id === "macos" ? "g2" : "macos",
    overflow_callback: "https://api.larkfield.example/dopl/overflow",
  };
}

export const EMPTY_RULES: RuleSet = { category: {}, models: {}, segments: {} };

export interface Resolved {
  value: FieldValue;
  /** "Dopl default", "Your project · Glasses", "Your project · G2", "Your project · plan:pro". */
  source: string;
  inherited: boolean;
}

export function resolveField(modelId: ModelId, rules: RuleSet, segment: Segment, key: FieldKey): Resolved {
  const seg = segment === "all" ? undefined : rules.segments[segment]?.[key];
  if (seg !== undefined) return { value: seg, source: `Your project · ${segment}`, inherited: false };
  const own = rules.models[modelId]?.[key];
  if (own !== undefined) return { value: own, source: `Your project · ${modelById(modelId).name}`, inherited: false };
  const shared = rules.category[key];
  if (shared !== undefined) return { value: shared, source: `Your project · ${categoryOf(modelId).name}`, inherited: false };
  return { value: defaultsFor(modelById(modelId))[key], source: "Dopl default", inherited: true };
}

/** The value set at exactly this scope, or undefined when it inherits from the level above. */
export function ownValue(rules: RuleSet, scope: RuleScope, segment: Segment, key: FieldKey): FieldValue | undefined {
  if (segment !== "all") return rules.segments[segment]?.[key];
  return scope === "category" ? rules.category[key] : rules.models[scope]?.[key];
}

export function setField(rules: RuleSet, scope: RuleScope, segment: Segment, key: FieldKey, value: FieldValue | undefined): RuleSet {
  const write = (layer: Layer | undefined): Layer => {
    const next: Layer = { ...layer };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  };
  if (segment !== "all") return { ...rules, segments: { ...rules.segments, [segment]: write(rules.segments[segment]) } };
  if (scope === "category") return { ...rules, category: write(rules.category) };
  return { ...rules, models: { ...rules.models, [scope]: write(rules.models[scope]) } };
}

export function countOverrides(rules: RuleSet): number {
  const layers = [rules.category, ...Object.values(rules.models), ...Object.values(rules.segments)];
  return layers.reduce((n, l) => n + Object.keys(l ?? {}).length, 0);
}

export const rulesEqual = (a: RuleSet, b: RuleSet) => JSON.stringify(a) === JSON.stringify(b);

const GLASSES_V5: RuleSet = {
  category: { max_chars: 180, agent_instructions: "Reply for a technician on site. Lead with the action, then the location. No greetings." },
  models: {},
  segments: {},
};
const GLASSES_V6: RuleSet = {
  category: { ...GLASSES_V5.category, fallback: "macos" },
  models: { g2: { timeout_s: 90 } },
  segments: { "plan:pro": { max_lines: 3 } },
};
const GLASSES_V7: RuleSet = {
  ...GLASSES_V6,
  models: { g2: { timeout_s: 90, inbound_template: "{{title}}: {{body}}" } },
};

/** One category's rule history. `test` and `live` are version numbers, 0 = none yet. */
export function seedReceives(id: CategoryId): ReceivesState {
  if (id === "glasses") {
    return {
      draft: GLASSES_V7,
      test: 7,
      live: 6,
      versions: [
        { n: 7, at: minsAgo(190), by: "Mei Tanaka-Ross", note: "Title in the G2 inbound template", rules: GLASSES_V7 },
        { n: 6, at: minsAgo(4320), by: "Mei Tanaka-Ross", note: "Fallback to Desktop, plan:pro limit", rules: GLASSES_V6 },
        { n: 5, at: minsAgo(17280), by: "Dario Vance", note: "Shorter limit for technicians", rules: GLASSES_V5 },
        { n: 4, at: minsAgo(34560), by: "Dario Vance", note: "First live version", rules: EMPTY_RULES },
      ],
    };
  }
  if (id === "desktop") {
    const v3: RuleSet = { category: { fallback: "queue" }, models: { macos: { max_lines: 5 } }, segments: {} };
    return {
      draft: v3,
      test: 3,
      live: 3,
      versions: [
        { n: 3, at: minsAgo(11520), by: "Jonas Eklund", note: "Queue when the app is closed", rules: v3 },
        { n: 2, at: minsAgo(30240), by: "Jonas Eklund", note: "Shorter notifications on macOS", rules: { category: {}, models: { macos: { max_lines: 5 } }, segments: {} } },
        { n: 1, at: minsAgo(79200), by: "Jonas Eklund", note: "First live version", rules: EMPTY_RULES },
      ],
    };
  }
  return { draft: EMPTY_RULES, test: 0, live: 0, versions: [] };
}

export const SAMPLE_MESSAGES = [
  { value: "short", label: "Short alert", title: "Site 12", body: "Pump 4 is over pressure. Close valve B before restart.", options: [] as string[] },
  {
    value: "long",
    label: "Long update",
    title: "Chiller CH-3",
    body: "Commissioning checklist: verify the flow switch, confirm the glycol ratio, log delta T at full load, then photograph the nameplate and attach it to the work order before you leave site.",
    options: [] as string[],
  },
  { value: "ask", label: "Question", title: "Breaker 7", body: "Isolate breaker 7 before you open the panel?", options: ["Isolate now", "Already isolated", "Skip step"] },
] as const;

/** Greedy word wrap; a word longer than a line takes a line to itself and is cut by the device. */
export function wrapLines(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}
