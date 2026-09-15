# Ontology typed fields — design proposal (2026-09-14, DRAFT for Samuel's rulings)

Samuel's ask, verbatim: *"in many ways ontology functions like hubspot in terms of having objects, but
its specifically oriented for agents … Right now, there are no restrictions on what can actually be
put in … for an object template, let's say a specific field is an enumeration. The user needs to be
able to set what options are in the enumeration … the structure of this gets accessed by the agents
via MCP … clearly searchable and clearly understandable by agents because it's optimized for agents."*

Research behind this doc (read these before building): `ontology-research/crm-field-types.md`
(HubSpot / Salesforce / Attio / Airtable / Notion), `ontology-research/current-system-audit.md`
(what exists, file:line), `ontology-research/agent-facing-schema.md` (how CRMs expose schema to
agents; the MCP face). Nothing below is built yet.

## 1. What exists today (one paragraph)

Attributes are a JSONB array on each `ontology_objects` row; `AttributeValue.kind` is one of
`text | pill | ref | knowledge | skill`. A lane's `template` is `{key, label, kind}[]` and is a
birth-time copy source only — nothing re-reads it, nothing enforces it. Server validation is zod
length caps; there is no DB CHECK on the JSONB. `pill` is a free-text input, not a picker. A number,
URL, email or date is `kind:"text"`. Over MCP, `op="get"` renders `label: value` and strips the
kind; `set_attribute` defaults `kind:"text"` and silently retypes a templated field; `dopl_search`
indexes `name`/`subtitle` only, so attributes are unsearchable.

## 2. Principles (borrowed from all five products; non-negotiable unless Samuel overrules)

1. **One `type` axis.** No HubSpot `type × fieldType`. Rendering hints go in an optional `display`
   sub-object, never a second required enum an agent can get wrong.
2. **Cardinality is a flag** (`multi: true`), not a type. `select` covers dropdown, radio, multi-check,
   tags. (Attio.)
3. **Options have a stable id separate from the label**, and are **archived, never deleted**.
   A rename never rewrites data; an archived option still reads, but is refused on write.
4. **Never auto-create an option from a write.** Reject and return the allowed set. This is how
   agents fragment an enum into "Enterprise" / "enterprise" / "Ent." otherwise.
5. **Errors are the fix, not the complaint.** Name the field, the rule, the allowed set or format
   exemplar, the nearest match, and the literal retry call.
6. **Type changes are explicit and lossy-by-declaration.** Widening is silent; narrowing dry-runs,
   reports what will not parse, and refuses until confirmed. Non-conforming values are kept raw and
   shown as `⚠ unparsed`, never coerced or dropped.
7. **Schema behind a describe call, never inline on every read, never in tool descriptions.**
   Reads carry a type tag (≈3 tokens/field); option lists live in describe and in errors.
8. **Markdown for the model-facing face, JSON only where the protocol mandates it** (tool inputs;
   optional `structuredContent` for client code). Same accuracy as JSON at ~38% of the tokens, and
   it is what `ontology-render.ts` already emits.

## 3. Proposed field type set (13 + system)

| type | value shape (stored) | validation / config | notes |
|---|---|---|---|
| `text` | string | `max_length`, `long: true` for textarea | today's `text`, unchanged |
| `number` | JSON number | `min`, `max`, `precision`; `display: plain \| percent \| currency(code)` | currency/percent are display, not types |
| `boolean` | true/false | — | |
| `date` | `YYYY-MM-DD` | ISO date | "close date" |
| `timestamp` | ISO 8601 instant | | "last touched" |
| `select` | option **id** (or id[] when `multi`) | `options[{id,label,color,order,archived,description?}]`, `restricted: bool`, `multi: bool` | **the type Samuel asked for**; `restricted:false` = suggested-but-open |
| `status` | option id | select + ordered stages; time-in-stage derivable from history | pipelines; the #1 CRM shape |
| `email` | string, lowercased | parsed `{address, domain}` at write | dedupe/route by domain |
| `url` | string, normalized | scheme prepended, `host` parsed at write | "Website eq acme.com" matches `https://www.acme.com/` |
| `phone` | E.164 string | | |
| `ref` | object id (or id[]) | `allowed_templates[]`, `multi`, optional declared `inverse` | upgrades today's loose `ref` |
| `actor` | member/agent id | | owner / author; not an ontology object |
| `knowledge` | KB entry id[] | | keep — no CRM has it |
| `skill` | skill id[] | | keep — same |

System (not user-creatable): `created_at/by`, `updated_at/by`; history stays the changelog (one row
per changed field, `attribute:<key>`, per INVARIANTS:1012).

**Migration of the five old kinds:** `text`→`text`, `ref`→`ref`, `knowledge`/`skill` unchanged,
`pill`→`select` with `restricted:false`, options minted from the distinct values already present.
Additive only: no existing value is rewritten; a field only becomes typed when someone retypes it.

**Explicitly out (v1):** formula / rollup / lookup (the agent *is* the formula engine), currency and
percent as types, time-only, geolocation, address, rating, auto-number, file (until a blob store),
dependent picklists, global value sets, rich text (KB entries cover it).

## 4. Where the schema lives

**Recommendation: extend `TemplateField` on the lane's `template` JSONB**, not a new property table.
`TemplateField` becomes `{key, label, type, required?, default?, help?, multi?, restricted?,
options?, min?, max?, allowed_templates?, display?}`. `key` is the field's identity, independent
of `label` (today `slug(label)` is derived in four places — collapse to one). The lane is the
authoritative owner; children carry values keyed by `key`. Designed so a real `ontology_properties`
table is a later lift, not a rewrite. Ad-hoc (untemplated) attributes on one object stay free-typed —
killing them breaks the 2026-09-13 add-row ruling.

**Enforcement: server-side in `service.ts › updateObject`, not zod** — zod cannot see the lane's
template (different row). `updateObject` already loads the object's parent for the Q9 gate, so it is
one extra read. Also add a `jsonb_typeof(attributes) = 'array'` CHECK at minimum.

**Value storage:** typed scalars in `{kind, value}` — number as JSON number, dates as ISO strings,
select as option **id**. `formatValue` (`field-format.ts`) keeps unwrapping `{kind,value}` unchanged.

## 5. Template editor (the human side of "the user sets the options")

The lane's template editor grows, per field: type picker (the 13), required, default, help text
(one line — this is the grounding an agent reads), and for `select`/`status`: an options list with
label, color, drag order, archive, and a one-line "when to pick it" description. Adding an option
from a value row (the +Add affordance HubSpot/Notion have) is allowed for humans; the write path
still refuses unknown ids from agents unless the field is `restricted:false`.

Retype flow: choose new type → dry run → "38 of 41 values parse; 3 do not: …" → confirm keeps the
3 as `⚠ unparsed` overrides on those objects. Never silent.

## 6. MCP face (agent side)

- `op="describe"` (new): template → markdown field table (`Field | type | req | constraint | notes`)
  + indented option blocks `id "Label" — when to pick it`. Cap 40 options; beyond that print 20 +
  pointer. Optional `structuredContent` = JSON Schema 2020-12 per template, gated on client
  capability, never duplicated into `content`.
- `op="get"`: add the type tag after each value — `Stage  engaged "Engaged" (status)` — and a footer
  `Fields with options: Stage, Tags — op="describe" before writing them.` Unparsed values render
  `⚠ unparsed`.
- `set_attribute`: `kind` omitted → inherit the template's type; explicit contradicting kind → error.
  Accept label OR id for select; store id; echo both. Keeps the tool's published example
  (`label="Stage" value="Won"`) working.
- `op="upsert_object"` (new): `match: {field, value}` (email/url/unique text) + atomic `fields{}`
  partial update; identical re-run returns `unchanged`, no version bump, no changelog row.
- Validation error: `isError`, nothing written on a batch, per-field rule + allowed set + nearest
  match + literal retry call (worked example in `agent-facing-schema.md` §b.5).
- `op="query"` (new, **on `dopl_ontology`, not `dopl_search`**): `where[{field, op, value}]`,
  `order_by`, `limit`; per-type operator matrix (text: eq/contains/starts_with/empty; number/date:
  eq/lt/lte/gt/gte/between; select: eq/in/not_in, multi adds contains_any/all; url/email:
  host_eq/domain_eq; ref: links_to). Result = markdown table of the filtered fields + identity.
- Budget: `dopl_ontology` prose is a down-only ratchet (1,503 chars; total 48,607). Fund the new ops
  by moving the write-op glosses into an MCP resource, as `ontology.ts:36-38` already proposes.

**Search/index:** never widen the summary projection to carry attributes (the 634 KB vs 82 KB
payload problem). Instead: normalized columns per value shape (`value_text` trigram GIN, `value_num`,
`value_ts`, `value_opt`, `value_ref`, derived `value_host`) maintained by trigger or a generated
column, queried by `op="query"`. `dopl_search` stays prose/semantic and keeps its honest
"attributes not indexed" line until this ships.

## 7. Waves (each ships alone; 500-line cap forces splits of `ontology-ops-write.ts` and `attributes-editor.tsx` in the first wave that touches them)

1. **Schema + enforcement.** `TemplateField` extension, typed values, server-side validation in
   `updateObject`, `pill`→`select` bridge, JSONB CHECK, template editor with options. No MCP change.
2. **Agent face.** Type tags on `get`, `describe`, `set_attribute` inherits type, validation errors,
   `upsert_object`. Budget the prose first.
3. **Query + index.** Normalized value columns + `op="query"` + operator matrix. Then relax the
   search disclosure.

## 8. Decisions Samuel must rule on

1. **Type set** — the 13 above? Anything to add (currency as a type? rating? file?) or cut (`phone`,
   `actor`)?
2. **`status` as its own type** vs. a flag on `select`. Recommend own type (pipelines + time-in-stage).
3. **Schema on the lane template (JSONB)** vs. a new properties table. Recommend JSONB now.
4. **Enforcement posture:** reject on write (recommended) vs. advisory with a per-field `strict`.
5. **Can agents add fields?** All three CRMs say no. Recommend `op="propose_field"` → pending
   suggestion a human accepts in the app.
6. **Can agents add enum options?** Recommend per-field `restricted` (default true): closed enums
   reject; open enums accept and mint the option.
7. **`pill` fate:** migrate to open `select` (recommended) vs. keep as a legacy kind.
8. **`op="query"` on `dopl_ontology`** (recommended) vs. a `filter` arg on `dopl_search`.
9. **`expected_version` required** on typed writes, or optional as today.
10. **URL identity** for match/unique: registrable host (recommended) vs. full URL.
11. **Option descriptions required** when a human creates an option, or optional. (Evidence: schemas
    cut malformed calls but *raise* valid-but-wrong picks; the description is what fixes choosing.)
