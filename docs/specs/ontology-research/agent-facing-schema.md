# Typed fields over MCP — how the CRMs do it, and what Dopl should do

Research date 2026-09-14. Primary sources cited inline; all URLs at the bottom.
Grounded against the current code: `packages/mcp-server/src/tools/ontology.ts`
(18 ops, attribute `kind` ∈ text|pill|ref|knowledge|skill, single `value` string or
`values[]`, `set_template_field`, `expected_version`), `ontology-render.ts`
(markdown narration, not JSON), `search.ts` (4 ranked groups, no filters).

---

## (a) How HubSpot / Attio / Salesforce surface schema to agents

### The one pattern all three share

**Schema is a separate tool call, never inlined in records, never in tool descriptions.**
All three ship a "describe" family and return records as flat `property → value` maps
using *internal names*, with the type/label/options only reachable through the describe call.

### HubSpot (official remote MCP server, `mcp.hubspot.com`)

Three schema tools, all read-only, distinct granularity — this is textbook progressive disclosure:

| Tool | What it does |
|---|---|
| `discover_hubspot_schema` | "Search HubSpot schema to discover available object types, or look up specific known types directly." |
| `search_properties` | "Find property definitions for an object type using keyword search." |
| `get_properties` | "Get full property definitions, including data types and enumeration values." |

Writes go through one tool, `manage_crm_objects` ("Create or update CRM records or activities").
Reads: `get_crm_objects`, `search_crm_objects`, plus `query_crm_data` (SQL with HubSpot extensions).
There is a `tool_guidance` tool whose only job is to hand back usage instructions on demand — i.e.
HubSpot also keeps *prose* out of the tool description and behind a call.

The property definition returned is the REST Properties API shape:

```json
{ "name": "preferred_contact_method", "label": "Preferred Contact Method",
  "type": "enumeration", "fieldType": "select",
  "description": "How the contact prefers to be reached",
  "groupName": "contactinformation", "hasUniqueValue": false,
  "options": [ { "label": "Email", "value": "email", "displayOrder": 1 },
               { "label": "Phone", "value": "phone", "displayOrder": 2 } ] }
```

Two axes, deliberately: `type` is the data type (`bool`, `enumeration`, `date`, `datetime`,
`string`, `number`), `fieldType` is the *widget* (`text`, `textarea`, `select`, `radio`,
`checkbox`, `booleancheckbox`, `date`, `file`, `number`, `phonenumber`, `html`,
`calculation_equation`). Options carry `label` + `value` + optional `description` +
`displayOrder` + `hidden`. Note what is **missing**: there is no `url` or `email` type — HubSpot
encodes those as `string` and validates in the UI, which is exactly the trap Dopl should avoid.

Records come back as `{"id": "...", "properties": {"internal_name": "value", ...}}` — internal
names, no labels, no types. The agent must have called `get_properties` to know what
`hs_pipeline_stage: "appointmentscheduled"` means.

### Attio (official hosted MCP, `mcp.attio.com/mcp`, 37 tools)

- `list-objects` — "List all objects in the workspace… with optional fuzzy search"
- `list-attribute-definitions` — "List all attributes available on an object type, **including their types and valid options**"
- `list-list-attribute-definitions` — same for list entries
- `search-records` (full-text across indexed attributes), `list-records` (filter + sort),
  `get-records-by-ids`, `create-record`, `update-record`, **`upsert-record`** — "Create or update a
  record using a matching attribute (e.g., email or domain)"
- `run-basic-report`, `query-particle-sql` (read-only SQL, plan-gated)

Attio's type system is the closest thing to what Samuel is describing — 17 attribute types:
actor-reference, checkbox, currency, date, domain, email-address, interaction, location,
personal-name, number, phone-number, rating, **record-reference**, **select**, **status**,
text, timestamp. Select/status options are objects with `id`, `title`, `is_archived` — options are
**archived, never deleted**, so historical values stay resolvable. Record-reference declares its
target object in the attribute's `config`.

Values are *structured*, not scalars: an email attribute's value has an `email_address` sub-field,
a domain has `domain` / `root_domain`, a name has `full_name` / `first_name`. That is what makes
Attio's filters work (below).

The community server (`kesslerio/attio-mcp-server`) adds what the official one deliberately lacks:
`get_record_attribute_options` (valid options for a select/status field), tools to add a select
option or a status, and **Levenshtein-distance "did you mean" suggestions on attribute-name typos**.
Worth stealing: the misuse it exists to fix is the misuse Dopl will see.

### Salesforce (Agentforce / hosted MCP + DX MCP)

Salesforce splits the problem in two:

1. **Metadata as grounding.** Agentforce's line is "without metadata, the LLM isn't able to
   understand any of your customizations" — the *Description* field on objects and fields is
   treated as first-class agent context, not documentation. Field descriptions are the prompt.
2. **Describe, tiered.** The hosted MCP's SObject toolset exposes describe-global / describe-sObject
   / layouts / field metadata; guidance is explicitly "call with no parameters first to get a
   compact index of all queryable business objects — significantly smaller than the raw Describe
   API. Then call with a specific object name to get field-level details." Community reports of the
   flow describe `describe_sobject` output being pasted back **as a markdown table**.
3. **Data Cloud / RAG** handles the unstructured half (hybrid search over documents), separate from
   the structured schema path.

The reusable lesson: a *compact index* call and a *full detail* call are different tools, and the
detail call is scoped to one object type.

### Comparison

| | HubSpot | Attio | Salesforce |
|---|---|---|---|
| Schema in record reads | No — internal names only | No — attribute slugs + structured values | No |
| Schema tool | 3 tiers (`discover_hubspot_schema` / `search_properties` / `get_properties`) | `list-objects` + `list-attribute-definitions` | describe-global → describe-sObject |
| Types | 6 data types × 12 field types; no url/email types | 17 types incl. domain, email, record-reference, select, status | full SObject field types |
| Enum options | `label` + `value` + `description` + `displayOrder` + `hidden` | `id` + `title` + `is_archived` (archive, don't delete) | picklist values + labels |
| Records format | JSON `properties{}` | JSON, structured per-type values | JSON / markdown tables in practice |
| Search | `filterGroups` + 13 operators | shorthand + verbose filters, per-type operators | SOQL |
| Upsert | `manage_crm_objects` (create-or-update) | `upsert-record` with matching attribute | upsert by external id |
| Agents editing schema | **No** — property tools are read-only | **No** in official MCP (community server adds option-creation) | No (metadata deploy is a dev tool) |

### Search filters, concretely

HubSpot `POST /crm/v3/objects/{type}/search` with `filterGroups` (OR of groups, AND within a group):
operators `EQ, NEQ, LT, LTE, GT, GTE, BETWEEN, IN, NOT_IN, HAS_PROPERTY, NOT_HAS_PROPERTY,
CONTAINS_TOKEN, NOT_CONTAINS_TOKEN`. Hard limits worth copying: max 5 groups, 6 filters per group,
18 filters total, 1 sort, 3,000-char query body, 10,000 results per query.

Attio `POST /v2/objects/{object}/records/query` takes shorthand or verbose filters. **Operators are
scoped by type** — string-ish types (text, domain, email-address, location, name, phone-number) get
`$eq, $contains, $starts_with, $ends_with, $not_empty`; numeric/temporal (number, currency, date,
timestamp, rating, interaction) get `$eq, $lt, $lte, $gt, $gte`; `$and` / `$or` / `$not` / `$in`
compose. Select filters by option title (`{"stage": "In Progress"}`), domain by normalized root
(`{"domains": {"root_domain": "apple.com"}}`).

---

## (b) Recommended MCP representation for Dopl

### The five rulings

1. **Schema behind one `op="describe"`, not inline, not in the tool description.** The 47k-char
   budget across 11 tools is already at a ratchet (`ONTOLOGY_PROSE_BUDGET = 1503`), and schema is
   per-workspace data that would blow it. Anthropic's own MCP guidance is progressive disclosure —
   loading definitions on demand took one measured case from 150,000 tokens to 2,000 (98.7%).
   All three CRMs do exactly this.
2. **Reads carry the *type tag* but not the *option list*.** A type tag is ~3 tokens per field and
   tells an agent whether it may write free text. The option list is unbounded and belongs in
   describe and in the error.
3. **Markdown-KV / compact markdown for model-facing output; JSON only where the protocol mandates
   it (tool *inputs*, which are JSON Schema by spec) and in `structuredContent` for client code.**
   The 11-format benchmark on 1,000 records: markdown table 51.9% accuracy at 25,140 tokens vs JSON
   52.3% at 66,396 and XML 56.0% at 76,114 — markdown-KV topped at 60.7%. Same accuracy as JSON for
   ~38% of the tokens. This also matches what `ontology-render.ts` already emits, so it is not a
   rewrite.
4. **Enum wire value is a stable slug; the label is an accepted alias; the error carries both.**
   HubSpot's `value`/`label` split and Attio's `is_archived` are both about one thing: a stored
   value must survive a rename.
5. **Typed reads for typed questions.** "Find the object whose website is X" is a lookup, not a
   ranking problem — it needs a filter op, not `dopl_search`. Keep `dopl_search` for prose/semantic;
   add filters where the types live.

### Field type set (mirror Attio, minus what Dopl has no UI for)

`text` · `long_text` · `number` · `currency` · `checkbox` · `date` · `datetime` · `select`
(single) · `multi_select` · `status` (select with an ordered lifecycle) · `url` · `email` ·
`phone` · `relation` (→ object type) · `knowledge` · `skill` · `member` (actor ref).
`pill` in today's schema maps to `select` with `options_open: true`.

### 1. describe-template

`dopl_ontology(op="describe", object="o-12")` — or `template="Company"`.

```
# Template: Company  ·  ontology `crm` · 41 objects
Fields (7) — write with op="set_attribute" label=<Field> value=<value>

| Field    | type         | req | constraint                  | notes                          |
|----------|--------------|-----|-----------------------------|--------------------------------|
| Name     | text         | yes | max 200, unique             | identity field for upsert      |
| Website  | url          |     | https?://, unique by host   | matched on host, not full URL  |
| Owner    | member       |     | workspace member            |                                |
| Stage    | status       | yes | one_of ↓                    | ordered; default `prospect`    |
| Tags     | multi_select |     | one_of ↓, open              | agents may add options         |
| ARR      | currency     |     | USD, >= 0                   |                                |
| Renews   | date         |     | YYYY-MM-DD                  |                                |
| Uses     | relation     |     | → Product (many)            | set with op="set_relationship" |

Stage (status, ordered):
  prospect   "Prospect"    — no contact yet
  engaged    "Engaged"     — a conversation is live
  customer   "Customer"    — signed
  churned    "Churned"     — archived option, still readable, not writable
Tags (multi_select, open): design, infra, ai-native  (+ agents may create)
```

Two-space-indented option blocks only for fields that have options; `value  "Label"  — when to pick
it` is the Markdown-KV shape that benchmarked best, and the third column is the Agentforce lesson
(the description *is* the grounding). Cap at 40 options; beyond that print 20 + `…N more —
op="describe", field="Stage"`.

Clients that want machine schema get the same thing as `structuredContent` (MCP 2025-06-18 allows
`structuredContent` + `outputSchema` alongside the text block) — JSON Schema draft 2020-12, one
schema per template, `enum` + `x-labels`, `format: "uri"|"email"|"date"`. Do **not** send that JSON
inside `content` too: that is the double-cost trap, and the spec's backwards-compat note is about
clients, not models. Gate it on client capability, not on `response_format`.

### 2. read-object

`dopl_ontology(op="get", object="o-12")` — type tag after the value, options never inlined:

```
# Acme Inc  ·  Company  ·  `o-12`  ·  Version 7
Website   https://acme.com                    (url)
Stage     engaged "Engaged"                   (status)
Tags      design, ai-native                   (multi_select)
ARR       120000 USD                          (currency)
Renews    2027-03-01                          (date)
Owner     Samuel Wang                         (member)
Notes     Intro via Dana; wants the desktop…  (long_text, clipped — op="get", field="Notes")
Region    "EMEA/UK" ⚠ unparsed (select)       — not an option; fix or run op="describe"
Uses →    Product `o-88` "Dopl Desktop"
Backlinks ← Deal `o-31` "Acme Expansion"
Fields with options: Stage, Tags — op="describe" before writing them.
```

`response_format: "concise"` drops the type tags and the footer. The `⚠ unparsed` line is the type-
migration escape hatch (below): a value that no longer validates is *shown*, never silently dropped.

### 3. search-with-filter

Do **not** bolt filters onto `dopl_search` — it is a ranked fan-out over four domains and its
description is budgeted. Add `op="query"` to `dopl_ontology`, where the template lives:

```json
{ "op": "query", "template": "Company",
  "where": [ { "field": "Website", "op": "eq", "value": "acme.com" } ],
  "limit": 10 }
```

```json
{ "op": "query", "template": "Company",
  "where": [ { "field": "Stage", "op": "in", "values": ["engaged", "customer"] },
             { "field": "ARR", "op": "gte", "value": 50000 } ],
  "order_by": { "field": "Renews", "direction": "asc" }, "limit": 25 }
```

Result, markdown table (uniform rows → table, per the benchmark):

```
3 Company objects match Stage in (engaged, customer) AND ARR >= 50000.

| id    | Name      | Stage    | ARR        | Renews     |
|-------|-----------|----------|------------|------------|
| o-12  | Acme Inc  | engaged  | 120000 USD | 2027-03-01 |
| o-40  | Globex    | customer | 88000 USD  | 2026-11-12 |
| o-51  | Initech   | customer | 51000 USD  | 2027-01-04 |

Columns: the filtered fields + the identity field. op="get" for the rest.
```

**Operators per type** (Attio's model — an operator an agent cannot use on a type should not be
offered):

| type | operators |
|---|---|
| text, long_text | `eq`, `contains`, `starts_with`, `ends_with`, `empty`, `not_empty` |
| url | `eq` (host-normalized), `contains`, `host_eq`, `not_empty` |
| email | `eq` (lowercased), `contains`, `domain_eq`, `not_empty` |
| number, currency, rating | `eq`, `lt`, `lte`, `gt`, `gte`, `between`, `not_empty` |
| date, datetime | `eq`, `lt`, `lte`, `gt`, `gte`, `between`, `not_empty` |
| select, status, multi_select | `eq`, `in`, `not_in`, `not_empty` (multi also `contains_any`, `contains_all`) |
| checkbox | `eq` |
| relation, member, knowledge, skill | `links_to` (id or exact name), `not_empty` |

**Indexing.** One normalized column per value shape rather than one per type — `value_text`
(lowercased, trigram GIN for `contains`), `value_num` (numeric), `value_ts` (timestamptz),
`value_opt` (option slug, btree), `value_ref` (uuid), plus the raw string always kept. URL and email
get a derived `value_host` (strip scheme/`www.`/trailing slash → registrable host) so
`Website eq "acme.com"` matches `https://www.acme.com/` — this is exactly Attio's
`domains.root_domain`. Keep the existing hybrid FTS/embedding path for `long_text` and prose, and let
`dopl_search` keep serving "what do we know about Acme"; `op="query"` serves "which object has
website acme.com". Hybrid overall, structured where the type is known — that is what both HubSpot
(filters + `query`) and Attio (filters + `search-records` + semantic-search-notes) ship.
Copy HubSpot's caps: ≤18 conditions, 1 sort, 25 rows default.

### 4. write-object success

```json
{ "op": "set_attribute", "object": "o-12", "label": "Stage", "value": "Engaged",
  "expected_version": "7" }
```

```
Set Stage = engaged "Engaged" on Acme Inc `o-12`. (was: prospect "Prospect")
Version 7 → 8. Filed in the changelog.
```

Accept the label, store the slug, echo both. Upsert, for the "agent found a company on the web"
path — Attio's `upsert-record` with a matching attribute:

```json
{ "op": "upsert_object", "template": "Company",
  "match": { "field": "Website", "value": "https://www.acme.com/" },
  "fields": { "Name": "Acme Inc", "Stage": "Engaged", "ARR": 120000 } }
```

```
Matched Acme Inc `o-12` on Website (host acme.com). Updated 2 fields, 1 unchanged.
  Stage  prospect → engaged
  ARR    (empty)  → 120000 USD
  Name   unchanged
Version 7 → 8.
```

`fields{}` is the partial-update primitive: only named fields are touched, and the whole map is
**atomic** — if any field fails validation, nothing is written and every failure is reported at once
(one round trip instead of N). Idempotency: re-running the identical upsert returns
`unchanged, Version 8` and does not bump the version or file a changelog entry.

### 5. write-object validation error

`isError: true`, and the message is the fix, not the complaint (Anthropic: error responses should be
"prompt-engineered to clearly communicate specific and actionable improvements"):

```
Rejected 2 of 3 fields on Acme Inc `o-12` — nothing was written.

Stage = "Onboarding" is not an option of Stage (status).
  Closest: "Engaged" (engaged). Allowed:
    prospect "Prospect" — no contact yet
    engaged  "Engaged"  — a conversation is live
    customer "Customer" — signed
  (churned is archived: readable, not writable.)
  Retry: op="set_attribute" object="o-12" label="Stage" value="engaged"

Website = "acme dot com" is not a url. Expected an absolute http(s) URL,
  e.g. https://acme.com. Retry with value="https://acme.com".

ARR = 120000 USD accepted (not written — atomic batch).
```

Rules: (1) name the field, the rejected value, and the rule it broke; (2) carry the *allowed set* or
the *format exemplar* inline so no extra describe round-trip is needed; (3) offer the nearest match
(Levenshtein / case-insensitive / label-vs-slug), which is what Attio's community server added after
watching agents fail; (4) print the literal retry call; (5) cap the option dump at 20 with a pointer.
Same contract for unique violations ("Website host acme.com already on `o-12` — use
op=\"upsert_object\" to update it") and for stale versions (`expected_version` mismatch → "changed
to Version 9 by Dana; re-read with op=\"get\"").

The controlled study on schema-first tool APIs is a caution, not a refutation: formal schemas cut
invalid calls (5.39 → 3.72 mean per episode) but *raised* semantically-wrong-but-valid calls
(0.93 → 3.03). Read: typing fixes format errors; only field descriptions and option `— when to pick
it` glosses fix the choosing. Budget prose for the option descriptions, not just the slugs.

### Type changes on a template that has data

Never coerce destructively; never delete an option.
- **Widening** (select → text, number → text, single → multi): silent, no migration.
- **Narrowing** (text → select/url/number/date): `op="set_template_field"` with a new `type` runs a
  **dry run first** and refuses until confirmed —
  `"Company.Region → select: 38 of 41 values match an option. 3 do not: \"EMEA/UK\" (o-12),
  … Re-run with confirm=\"migrate\" to keep them as ⚠ unparsed, or add options first."`
- Non-conforming values are **kept raw** and rendered `⚠ unparsed` (see read-object). They are
  writable-over, excluded from typed filters, and included in `op="query"` only via
  `{"field":"Region","op":"unparsed"}`.
- **Options are archived, never deleted** (Attio's `is_archived`): archived options still resolve on
  read, are rejected on write with the reason, and stay filterable.
- Every migration files a changelog entry — the ontology tool already claims "Writes are filed per
  field in the changelog"; a type change should file one row per affected object, not one per field.

### Why not the alternatives (one paragraph)

Pure JSON records + a JSON Schema per template is the honest lingua franca and it is what the
`structuredContent` channel should carry — but as the *model-facing* payload it costs ~2.6× the
tokens of markdown for the same accuracy (66,396 vs 25,140 on the 1,000-record benchmark, 52.3% vs
51.9%), and Dopl's renderer, neutralization rules and clipping notices are all markdown today, so
JSON would be a rewrite that buys nothing the model can use. TypeScript-style type declarations
read beautifully for a *static* schema, but Dopl's templates are user data that changes per
workspace, they cannot express per-option descriptions without comment gymnastics, and no client
validates them — they would be prose pretending to be a contract. Inlining the schema into every
read is the real loser: option lists are unbounded, most reads never write, and it converts a
one-time describe into a per-read tax (the same arithmetic that took Anthropic's example from 150k
to 2k tokens). And schema in tool *descriptions* is impossible on this surface — the budget is 47k
chars across 11 tools with `dopl_ontology` already ratcheted at 1,503, and descriptions are pushed
on every connection to every client whether or not the ontology is ever touched.

---

## (c) Open decisions for Samuel

1. **Where does `op="query"` live?** Recommendation: a new op on `dopl_ontology` (types live there;
   no new tool, no new description budget). Alternative: a `filter` arg on `dopl_search`, which
   mixes ranked and exact semantics and costs `dopl_search`'s budget.
2. **Can agents create fields?** All three products say **no** — HubSpot's MCP property tools are
   read-only, Attio's official 37 tools have no create-attribute. Recommended middle path:
   `op="propose_field"` files a pending suggestion a human accepts in the app, and
   `set_template_field` stays available only on templates flagged `agent_extensible: true`.
3. **Can agents add enum options?** Per-field `options_open` flag (Tags yes, Stage no). Attio's
   community server ships option-creation and the official one does not — that split is the
   decision, and it is a per-field decision, not a global one.
4. **Slug or label on the wire?** Recommendation: store slug, accept both, echo both. Cost: every
   template needs slugs generated and kept stable through renames.
5. **`pill` migration.** Today's `pill` becomes `select` with `options_open: true` and options
   backfilled from existing distinct values — or stays a distinct free-tag type. Needs a ruling
   because it changes existing data.
6. **Is `expected_version` required for typed writes?** Currently optional (last-writer-wins). Enum
   and relation writes are the ones where a blind overwrite is expensive.
7. **Atomic vs partial `fields{}` batch.** Recommended atomic (nothing written on any failure).
   Partial is friendlier to long agent runs but makes the changelog non-deterministic.
8. **Does `structuredContent` ship?** It is free for clients that support it and double cost for
   clients that render both. Needs a capability check, and a test, before it goes on.
9. **URL identity.** Is `Website` unique by registrable host (so `acme.com` and `www.acme.com/x`
   collide) or by full URL? Upsert matching depends on the answer.
10. **Option descriptions ("— when to pick it").** The study says these, not the types, are what fix
    semantically-wrong writes. They are also a data-entry burden on humans. Required, or optional?

---

## Sources

- HubSpot MCP overview — https://developers.hubspot.com/mcp
- HubSpot remote MCP server tool list — https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server
- HubSpot Properties API (types, fieldTypes, options) — https://developers.hubspot.com/docs/api-reference/legacy/crm/properties/guide
- HubSpot property field types (UI) — https://knowledge.hubspot.com/properties/property-field-types-in-hubspot
- HubSpot CRM Search API (operators, limits) — https://developers.hubspot.com/docs/api-reference/latest/crm/search-the-crm
- Attio MCP tool reference — https://docs.attio.com/mcp/overview
- Attio attribute types — https://docs.attio.com/docs/attribute-types
- Attio filtering and sorting — https://docs.attio.com/rest-api/guides/filtering-and-sorting
- Attio community MCP server (option lookup, typo suggestions) — https://github.com/kesslerio/attio-mcp-server
- Salesforce hosted MCP, SObject toolset — https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/sobject-all.html
- Salesforce DX MCP + Agentforce Vibes — https://developer.salesforce.com/docs/platform/agentforcevibes/guide/afv-mcp-servers.html
- "Metadata Is Your Admin Blueprint for Building Better Agents" — https://admin.salesforce.com/blog/2025/metadata-your-admin-blueprint-for-building-better-agents
- Grounding an agent with data (Trailhead) — https://trailhead.salesforce.com/content/learn/modules/grounding-an-agent-with-data/review-options-to-ground-an-agent-with-data
- MCP spec, Tools (inputSchema/outputSchema/structuredContent/isError) — https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- Anthropic, "Writing effective tools for agents" — https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic, "Code execution with MCP" (progressive disclosure, 150k → 2k tokens) — https://www.anthropic.com/engineering/code-execution-with-mcp
- 11-format table benchmark (markdown/JSON/YAML/CSV/XML accuracy + tokens) — https://www.improvingagents.com/blog/best-input-data-format-for-llms
- Nested-format comparison — https://www.improvingagents.com/blog/best-nested-data-format/
- "Schema First Tool APIs for LLM Agents" (invalid vs semantic misuse) — https://arxiv.org/html/2603.13404v1
