# Ontology system audit — current state (read-only, 2026-09-14)

Repo `/Users/samuelwang/Downloads/setup-intelligence-engine`, branch `ui/agents-tab-polish`.
Uncommitted work in `dopl-desktop-app/**` and `src/features/channels/server/**` ignored.

---

## 1. DATA MODEL

### Tables (all in `supabase/migrations/20260706120000_ontology.sql`)

| Table | Key columns | Notes |
|---|---|---|
| `ontology_clusters` | `id, workspace_id, slug, name, purpose, position, created_by, created_at, updated_at, deleted_at` | :15-26. One row = one ontology board. `layout JSONB` and `agents_may_edit BOOLEAN NOT NULL DEFAULT true`, `last_edited_by`, `last_edited_source` added by `20261001120000_ontology_home_shares.sql`. `description` from `20260610010000`. |
| `ontology_objects` | `id, workspace_id, object_type, name, subtitle, attributes JSONB DEFAULT '[]', methods JSONB DEFAULT '[]', user_id, created_by, created_at, updated_at, deleted_at` | :34-49. `template JSONB NOT NULL DEFAULT '[]'` added `20260708120001_ontology_object_template.sql`. `object_type` CHECK'd to `person|team|client|policy|document` originally, then **dropped** (`20260708160000_ontology_drop_object_type.sql`, `20260708190000_ontology_retire_object_type_cleanup.sql`) — there is no server-side object type today; "type" = the containing lane's name. |
| `ontology_memberships` | `id, workspace_id, cluster_id, parent_object_id, child_object_id, position` | :63-77. `CHECK ((cluster_id IS NULL) <> (parent_object_id IS NULL))` — exactly one parent kind. Columns are objects with `cluster_id` set; cards are objects with `parent_object_id` set. One object can sit under several parents. |
| `ontology_relationships` | `id, workspace_id, source_object_id, label, target_object_id, position` | :85-96. Relational, not JSONB — unique index on `(source, label, target)`, `CHECK (source <> target)`. |
| `ontology_channel_shares` | share rows per (ontology, channel) | `20261001120000_ontology_home_shares.sql`. No write surface; one SELECT policy; `assert_ontology_share_scope()` trigger. |
| `revisions` (append-only) | `resource_type, resource_id, op, payload, actor_kind, agent_session_id, …` | `20261002120000_revisions.sql`. **WRITTEN, NOT APPLIED** per `docs/INVARIANTS.md:1888`. Ontology files **one row per changed field**. |

### How attributes are stored

**JSONB array on each object row — `ontology_objects.attributes`.** Each entry is
`{ key, label, value: { kind, value } }` (`src/features/ontology/types.ts:14-18`).
There are **no attribute rows and no attribute-definition table**. Every object carries
its own ad-hoc `label → value` bag.

### The `AttributeValue` union today (`src/features/ontology/types.ts:4-12`)

```
| { kind: "text";      value: string }
| { kind: "pill";      value: string }      // "Tag" in UI
| { kind: "ref";       value: string[] }    // other object ids
| { kind: "knowledge"; value: string[] }    // KB base/entry ids
| { kind: "skill";     value: string[] }    // skill ids
```
Five kinds. **No number, url, email, date, boolean, currency, or enum.**

### Constraints / CHECKs

- **Zero DB-level shape validation on `attributes` / `template` / `methods`.** Grep over
  `supabase/migrations/*.sql` finds `jsonb_typeof` CHECKs on `agent_templates.fields`
  (`20260822200000:236`) and `channels.info_card` (`20260825120000:95`) — **nothing for ontology**.
  A bad-shaped attribute bag written by anything bypassing the API is accepted at rest.
- The charset rule is deliberately **NOT** applied to nested JSONB labels —
  `src/features/ontology/schema.ts:6-17` states why: *"a CHECK means walking a jsonb array on
  every write, and `ontology_objects` has an editor-scoped UPDATE policy for `public`, so a
  zod-only bound would be a fence beside an open gate."* Only `clusters.name` (200) and
  `objects.name` (300) get `safeLabel` + a matching DB CHECK (`20260731110000_short_label_charset_bounds.sql`).

### RLS shape

Original policies (`20260706120000:127-173`): SELECT for `is_workspace_member(workspace_id, auth.uid(),'viewer')`;
INSERT/UPDATE/DELETE for `'editor'`; memberships/relationships get a FOR ALL editor policy.
`20261001130000_ontology_readable.sql` **widens only** — five `SECURITY DEFINER` functions
(`dopl_ontology_level_rank`, `dopl_ontology_share_level`, `dopl_ontology_object_clusters`,
`dopl_ontology_readable`, …) add an `OR` arm for cross-container shares; the workspace-member
arm is kept verbatim (`docs/INVARIANTS.md:1900`).
Service-role bypasses RLS, so real enforcement is in the service layer:
`server/service-gates.ts › requireObject/requireCluster` (Q9: `edit` on **every** cluster the
object belongs to) and `server/service-audience.ts › resolveOntologyAudience`.

### Schema ↔ definition separation

**None.** There is exactly one weak "definition" surface: `ontology_objects.template`
(a JSONB array of `{key, label, kind}`, `types.ts:22-26`) on the lane object. It is a
*birth-time copy source*, not a schema: nothing re-reads it after a child is created, nothing
validates a child's attributes against it, and a child can add, rename, retype or delete any
attribute freely.

---

## 2. TEMPLATES

`src/features/ontology/components/template-editor.tsx` (201 lines).

- A template field is `{key, label, kind}` only (`types.ts:22-26`). **No default value,
  no required flag, no options list, no format, no description, no order guarantee beyond array order.**
- `KIND_LABELS` / `KIND_OPTIONS` (`template-editor.tsx:21-37`) are the single declaration of the
  five kinds for both the template picker and the attribute picker.
- Upsert is **by label, case-insensitive** (`template-editor.tsx:82-96`), and `key` is
  `label.toLowerCase().replace(/\s+/g,"-")` — the same derivation used in
  `attributes-editor.tsx:90` and `new-object-dialog.tsx:196-210` and in MCP
  `ontology-ops-write.ts:166`. Four copies of one rule.
- Template is edited only through `OBJECT_UPDATE` with a whole-array `template` patch
  (`template-editor.tsx:77-78`) — no per-field action.
- **Minting a new object from a template** — two mirrored implementations that must not drift:
  - server: `server/service.ts:180-189` — `attributes = (parent.template ?? []).map(f => ({key, label, value: f.kind==="text"||f.kind==="pill" ? {kind,value:""} : {kind,value:[]}}))`; also copies parent's `methods` and `relationships`.
  - client optimistic: `optimistic-create.ts:68-85 › pendingObject`, header comment at :62-67 says it "must mirror" the server.
- A lane's template can also be authored at creation time in the New object dialog
  (`new-object-dialog.tsx:92`, `toTemplate` at :196-210).
- **Templates constrain nothing.** They seed empty attributes and are then inert.
  `kanban-column-header.tsx:210-220` renders a read-only preview (`KIND_LABELS[field.kind]`).

---

## 3. UI

| File | Lines | What it does |
|---|---|---|
| `components/object-panel.tsx` | 238 | 420px right panel: name (`text-display` input), description (`InlineUnderlineField` `.inputAction`), then Attributes / Relationships / Actions / Default fields (columns only) / History. Header is a name + naked trash + naked ✕; no uuid, no pill. |
| `components/attributes-editor.tsx` | 391 | `AttributesEditor` → `AttrRow` → `AttrValueEditor`. Row order since 2026-09-14 is `label : value [kind ▾] ✕` (`AttrRow` :197-239, `ROW_COLON` :154). |
| `components/template-editor.tsx` | 201 | `TemplateEditor` → `FieldRow`; `label [kind ▾] ✕`, **no value cell, no colon** (:147-150). |
| `components/relationships-editor.tsx` | 214 | Edge label (`InlineUnderlineField`) + object chips via `ObjectPickMenu`. |
| `components/actions-editor.tsx` | 176 | Four free-text fields per action: name, description, outcome, tools. All plain strings. |
| `components/pick-menu.tsx` / `object-pick-menu.tsx` / `knowledge-pick-menu.tsx` | 100/—/174 | Grouped pickers. `PickMenu` takes `{id, name, group}` — **this is the nearest thing to an enum picker that exists, and it is id-based, not value-based.** |

**What each kind renders** (`attributes-editor.tsx:253-390 › AttrValueEditor`):
- `knowledge` / `skill` → removable `CHIP` strip + `KnowledgePickMenu` / `PickMenu` (:269-325)
- `ref` → `CHIP` strip of object names + `ObjectPickMenu` `+ Link` (:327-366)
- `pill` → `InlineUnderlineField label="Tag"` — **a free text input, not a pill picker** (:368-379)
- `text` → `InlineUnderlineField label="Value"` (:381-390)

`emptyValueOf` (:244-251) — kind switch keeps the string across `text↔pill` and empties everything else.

**Where a number / link / email / date goes today: `kind:"text"`, a free-text string.**
Nothing renders `type="number"`, `type="url"`, `type="email"` or a date picker anywhere
in `src/features/ontology/**`. No formatting, no parsing, no display affordance
(no clickable link, no `tel:`/`mailto:`, no relative date).

---

## 4. STORE / DISPATCH / SAVE

`src/features/ontology/graph-state.ts` (333 lines) — a `useReducer` store, deliberately
(`docs/INVARIANTS.md:931`).

- `GraphAction` union :24-54. Attribute path: `ATTRIBUTE_UPSERT {id, index|null, attribute}`
  and `ATTRIBUTE_DELETE {id, index}` (:48-49; reducer :284-296). Template path goes through the
  generic `OBJECT_UPDATE {id, patch: Partial<OntologyObject>}` (:46, reducer :259-260).
- `objectIdToSync` (:57-71) names the eight actions that trigger a debounced write.
- `resolveIds` (:103-142) rewrites provisional ids in object map keys, `childIds`,
  relationship targets, **`ref` attribute values** (:120-124) and `layout` keys.
  ⚠ A new id-carrying attribute kind would have to be added here or it dangles.
- Debounce: `hooks/use-ontology.ts:28` `OBJECT_SYNC_DELAY_MS = 800`; per-object timer map
  (:84), `syncObject` at :218-230 issues `api.updateObject(workspaceId, objectId, {...})`.
  Flush-on-unmount at :171-206.
- Client: `client/api.ts:107-118 › updateObject` → `PATCH /api/ontology/objects/{objectId}`
  with `X-Updated-At` CAS header.

**The save is a WHOLE-ARRAY PUT of the attribute bag.** A single-character edit in one
attribute ships all 100 attributes.

### Server-side validation today

`src/app/api/ontology/objects/[objectId]/route.ts:21` — `parseJson(request, OntologyObjectUpdateSchema)`.
`src/features/ontology/schema.ts`:

- `attributeValueSchema` :21-27 — discriminated union on `kind`; `text` ≤4000 chars, `pill` ≤400,
  `ref` = `z.string().uuid()` array ≤50, `knowledge`/`skill` = plain string array ≤50.
- `attributeSchema` :29-33 — `key` 1..200, `label` ≤200 (**no charset rule, no uniqueness check**).
- `templateFieldSchema` :35-39 — `key`, `label`, `kind` enum. Same five kinds, hand-duplicated.
- `OntologyObjectUpdateSchema` :90-98 — `attributes` ≤100, `methods` ≤50, `relationships` ≤100,
  `template` ≤100.

**That is the entire validation.** There is:
- no check that an attribute's `kind` matches its lane's template field of the same key,
- no check that attribute `key`s are unique within an object,
- no check that `key` equals `slug(label)`,
- no value-format validation of any kind,
- no `ref` target-existence check (only `uuid()` shape),
- no DB CHECK behind any of it.

Service layer (`server/service.ts:262-300 › updateObject`) handles gates (Q9), CAS/412
(`staleVersionError` :245-252), attribution, and per-field revision capture
(`server/service-revisions.ts`) — but adds **no field-value validation**.

---

## 5. MCP

### `dopl_ontology` — `packages/mcp-server/src/tools/ontology.ts` (176 lines)

18 ops (`ontology.ts:104-124`): `map, anchor, resolve, get, create_cluster, update_cluster,
create_column, create_object, update_object, set_template_field, remove_template_field,
set_attribute, remove_attribute, set_relationship, remove_relationship, set_action,
remove_action, claim_anchor`. **No delete op** — deletion is app-only, fenced by `sessionOnly`
on the DELETE routes (`objects/[objectId]/route.ts:67-72`).

Description text agents see (`ontology.ts:52-91`), verbatim:

> headline: "The object graph you reach — items in objects in ontologies, with attributes, relationships and actions; it routes, not inventories."
>
> policy: "Reads plus writes that edit ONE thing at a time. No delete op — `remove_*` strips a field, not the object. A shared ontology reaches you only at the level its channel grants your role, and an agent gets its operator's. Writes are filed per field in the changelog."
>
> READ — set `op` to:
> - "map" — ontologies and their OBJECTS, with each object's direct items. TWO LEVELS ONLY: items nested deeper, and items in no object, never appear. Call first.
> - "anchor" — the CALLER's own object; start here for "my/me" requests.
> - "resolve" — objects whose NAME or SUBTITLE contains the query (case-insensitive substring), capped at 20 matches.
> - "get" — one object: attributes, relationships, backlinks, children, actions, Version.
>
> WRITE — set `op` to:
> - "create_cluster" / "update_cluster" — name and `purpose`.
> - "create_column" — an object type named for what it holds.
> - "create_object" / "update_object" — inherits the parent's template, edges, actions.
> - "set_template_field" — a DEFAULT field; new objects inherit it empty.
> - "set_attribute" / "set_relationship" / "set_action" — one attribute, one labeled edge (never onto itself), or something the OBJECT does.
> - "remove_template_field" / "remove_attribute" / "remove_relationship" / "remove_action" — drop one, by label or name.
> - "claim_anchor" — link the CALLING user to an object.

Relevant arg `.describe()`s (`ontology.ts:136-151`):
- `label`: "Attribute, relationship, or template-field label."
- `kind`: enum `["text","pill","ref","knowledge","skill"]`, **"set_attribute / set_template_field: value kind (default text)."**
- `value`: "set_attribute (text/pill): the value." (≤4000)
- `values`: "set_attribute (ref/knowledge/skill): ids, slugs, or exact names. kind=knowledge also accepts entry refs: `<base>/<entry path>` or an entry uuid." (≤100)
- `expected_version`: CAS token from a prior `op="get"`.

### Exactly what comes back to an agent

Markdown text, not JSON — `packages/mcp-server/src/tools/ontology-render.ts:169-270 › renderObject`:

```
# <name> (<CONTAINER OBJECT'S NAME> · id: `<uuid>`)
<subtitle>
Version: `<updated_at>` (pass as expected_version to a later write so a concurrent edit can't clobber yours)

## Attributes
- <label>: <rendered value>
## Relationships
- <label>: <name, name>
## Referenced by
- <name> —<label>→ (id: `<uuid>`)
## Default fields (template)
_New objects created inside this one are born with these fields, empty:_
- <label> (<kind>)
## Objects inside
- <name> (id: `<uuid>`)
## Actions
### <name>
  <description>
  Outcome: <outcome>
  Tools: <tools>
```

`renderValue` (:272-304): `pill` → the string; `text` → the string or `—`;
`ref` → comma-joined **names** (ids dropped); `knowledge`/`skill` → `Name (dopl_kb op="read_file" base="…" path="…")`.

⚠ **An attribute's `kind` is invisible in `op="get"`.** The Attributes block prints `label: value`
only; only the *template* block prints `(kind)`. An agent reading an object cannot tell a date
from a name from a number — every value arrives as an untyped string.

⚠ **`set_attribute` does not consult the template.** `ontology-ops-write.ts:282-327` defaults
`kind` to `"text"` (:285) and upserts by lowercased label (:317-325). An agent filling the
template field "Deal size (number)" with `set_attribute label="Deal size" value="1.2M"` silently
overwrites the field's kind to `text`.

⚠ **"edit ONE thing at a time" is a UI-level claim only.** Every write op does a
read-modify-write of the whole array and calls `client.updateOntologyObject(id, {attributes})`
(:326) — the full bag goes over the wire.

Value caps are **hand-mirrored** from the server zod schema, and the code says so
(`ontology-ops-write.ts:51-55`): `TEXT_VALUE_MAX = 4000`, `PILL_VALUE_MAX = 400`.

### `dopl_search` — `packages/mcp-server/src/tools/search.ts` (324 lines)

Indexes ontology objects **by `name` and `subtitle` only** — `search.ts:261-263`:
`Object.values(ontology.objects).filter(o => matches(o.name, o.subtitle))`.
It uses the **summary projection**, which selects `id, name, subtitle` and nothing else
(`src/features/ontology/server/dto.ts:42`). **Attributes are not searchable at all**, and the
tool says so verbatim (`search.ts:135`):

> "Only knowledge entries are matched on their BODIES; skills, ontology objects and agent templates on names and short metadata only, so a term living inside a SKILL.md or inside a template's instructions is not findable here."

Hit line format (`search.ts:275-281`): `- <name> (<container> · id: \`<id>\`) — <subtitle>`.
`search-everywhere.ts:142-152` is the cross-scope twin, same projection, same limitation.
A clipped read is reported via `ontology-clipped.ts › clippedNote` (`search.ts:286-290`).

### `dopl_map` — `packages/mcp-server/src/tools/map.ts` (154 lines)

One line per ontology (:127-139): `- <name> \`<slug>\`<purpose> (objects: <lane names>)`.
Two levels only. Comment at :102-105 records why it uses the summary projection
(*"`attributes` up to 100×4000 chars … 634 KB vs 82 KB on a 366-object workspace"*).

### Budget

Not 47k any more — `packages/mcp-server/src/tool-budget.test.ts:263`:
`SERVED_TOTAL_CEILING = 48_607` (it was 47,464 → 47,319 per the note at :176).
Per-surface: `OVER_BUDGET_CEILINGS.dopl_ontology = 1919` (:181),
`SCHEMA_CEILINGS.dopl_ontology = 2809` (:28 of the SCHEMA block),
`dopl_search = 1076`, `dopl_map = 250`. In-file ratchet: `ontology.ts:40`
`ONTOLOGY_PROSE_BUDGET = 1_503`. Every one is a **ratchet that only moves down**;
the files repeatedly say **"NEVER QUOTE THIS NUMBER — re-derive it."**

⚠ Any new kind adds to the served `kind` enum + its `.describe()` in `ontology.ts:137-140`
and therefore pushes against `SCHEMA_CEILINGS.dopl_ontology`. **A typed-field redesign must
budget its prose before writing it.** `ontology.ts:36-38` already names the escape hatch:
*"pull the write-op glosses into an MCP resource"* (as `dopl_channel` does with `dopl://doctrine/channels`).

---

## 6. DOCS / RULINGS a redesign must respect

All from `docs/INVARIANTS.md` unless noted.

1. **Vocabulary, :311** — 🔒 *"any wording that's called 'cluster' should not be there. It's like
   'ontology' … it's not a column, it's an object"* (Samuel, 2026-09-11).
   One ONTOLOGY = one `ontology_clusters` row; one OBJECT = a lane (an object *type*); one ITEM = a card.
   **"NOTHING WAS RENAMED IN CODE, AND THAT IS THE RULING, NOT A SHORTCUT."**
   Gate: `src/features/ontology/vocabulary.test.ts` scans string literals + JSX text against an exact
   six-literal allow-list. **Any new UI string for typed fields goes through this gate.**

2. **The 2026-09-14 field-face ruling, :312 (6)** — Samuel, over this panel:
   *"the distance between the text description and its underline should be increased … for the
   individual fields. I want to remove the gray underline, and have it so that the black underline
   only appears when a user clicks on a field item (vertical center the text also). Also, the format
   should be like: Attribute : Field Dropdown … So reordered"*.
   → attribute row is `label : value [kind ▾] ✕`; the ":" is a static `aria-hidden` glyph the ROW
   draws, **never typed, never part of the label** (a colon in the label would be slugged into `key`);
   row cells take `form-dialog.module.css › .inputQuiet`; the panel's Description takes `.inputAction`.
   Explicitly: *"a template row is label + kind with no value cell — so there is nothing to reorder
   and no two halves to separate."* Pinned by `object-panel.test.tsx › "the 2026-09-14 field ruling"`.

3. **The 2026-09-13 row ruling, :312 (5)** — *"each of those items should have the gray background
   where it sits … Each field should be a white bar … Remove the count, the number of items in each …
   For each line, we should see: the new attribute name, the key, the value field. The 'Add' button
   should be under it"*. And the gloss that matters for a redesign:
   **"'THE KEY' IS THE KIND PICKER, NOT `ObjectAttribute.key`"** — `key` is the label slugged at
   creation, the address MCP writes at, and it stays off screen.
   Also: **the add composer is deleted**; `PanelAddButton` appends an empty live row;
   **an unnamed row is not persisted** (`useDraftRows`); rows are keyed by position so a commit keeps the caret.

4. **Flat/named/naked panel, :312 (1)-(4)** — Samuel, 2026-09-12: *"no more indented stuff … no need
   to show the ID in the UI … at the top, it shouldnt be a pill, just have it be the name of the object
   … for the trash and X buttons, just have it be naked icons, no more button UI"*.
   Kind pickers are `SelectMenu variant="text"` — **no native `<select>` on this surface.**

5. **Minimal UI copy** — `template-editor.tsx:29-32`: *"No `description`: five one-word kinds, and a
   second line per option in a 420px panel is the paragraph the minimal-copy ruling refuses."*
   A kind list that grows past ~8 will collide with this.

6. **Changelog granularity, :1012** — 🔒 *"ONTOLOGY records ONE ROW PER CHANGED FIELD — Samuel's
   HubSpot shape, per object, per field, `old → new`, who, when, and whether a person or which agent —
   because `ontology_objects.attributes` is a JSONB bag and one PATCH moves N properties at once; one
   row per SAVE would collapse the per-property timeline the feature exists for."*
   Three payload shapes: FIELD `{field, before, after}` where `field` is a column
   (`name, subtitle, purpose, methods, template, agentsMayEdit`) **or one attribute spelled
   `attribute:<key>`**; ASSOCIATION `{association, field, before, after}`; BUNDLE `{fields}`.
   ⚠ *"`layout` AND `slug` ARE NOT TRACKED FIELDS."*
   Rendering: `src/features/revisions/lib/field-format.ts:20,35,58-61` — `attribute:stage` → `Stage`,
   and `formatValue` unwraps `{kind, value}` to print the value only, with the comment
   *"the `kind` is a schema fact they did not change."*

7. **Agent reach, :648-654** — 🔒 an agent's ontology reach is its operator's, resolved server-side
   (`service-audience.ts › resolveOntologyAudience`). Guests reachable since 2026-09-09.
   `GET /api/ontology/reach` tells an agent what it reaches.

8. **App-only deletion, :140-141** — a rule an agent is *told* must have a fence in code;
   the `_admin` tools were deleted once the routes refused agent credentials.
   `sessionOnly` on object/cluster DELETE is now **the whole fence**.

9. **Read-path discipline, :951-969** — *"A whole-workspace list read selects COLUMNS — never `*`,
   never the JSONB."* `dto.ts` holds both sets side by side. *"a clipped read SAYS SO."*
   This is the rule that keeps attributes out of `dopl_search` today.

10. **Unframed surface, :1134** — *"`ontology` is still UNFRAMED — open, not decided."*
    (desktop prompt-framing categories).

11. **Open debt, `docs/REFACTOR-FINDINGS.md:258-262 (F-026)`** — the web/SPA still pull the whole
    ontology graph per visit, all JSONB; only the agent side got the summary projection.
    `client/api.ts:52` asks `/api/ontology` with no `view` param.

12. **"Ontology demoted to substrate"** — not in `docs/`; it is a memory-level strategic ruling
    (channels pivot, 2026-08-03/05). Closest in-repo trace is `docs/DESIGN-SYSTEM.md:213`
    (`.graph-substrate`, a CSS class — unrelated). Treat the demotion as a scope constraint,
    not a documented spec.

---

## 7. SIZE / RISK

| Area | Lines |
|---|---|
| `src/features/ontology/**` non-test | 10,138 |
| `src/features/ontology/**` tests (23 files) | 5,608 |
| `src/app/api/ontology/**` | 981 |
| `packages/mcp-server/src/tools/ontology*.ts` | 1,281 (`ontology.ts` 176, `-ops-read` 204, `-ops-write` 480, `-render` 305, `-clipped` 25) |

500-line cap: `docs/ENGINEERING.md:93` *"Hard cap: 500 lines. No exceptions for new or edited files."*
:99 — an edit to an over-cap file must split it in the same PR or reduce the count.
CI gate: `size-check` job, `CLAUDE.md:98` (over `packages/`), plus eslint `max-lines`.

**Files at risk** (already 300-500, i.e. one feature away from violating):
`ontology-view.tsx` 496, `server/repository.ts` 475, `server/service.ts` 452,
`components/attributes-editor.tsx` 391, `hooks/use-ontology.ts` 377, `graph-state.ts` 333,
`packages/mcp-server/src/tools/ontology-ops-write.ts` 480.
⚠ **`ontology-ops-write.ts` at 480 and `attributes-editor.tsx` at 391 are where a typed-field
system lands hardest. Both must be split in the same wave.**

### Files a typed-field system touches

**Types / schema (the seam):** `types.ts:4-26`, `schema.ts:21-39`,
`packages/dopl-client/src/ontology-types.ts` (explicit mirror, `dto.ts:135`).
**Storage:** a new migration; `dto.ts:18-19,76-92,176-191`; `server/repository.ts:297-313`.
**Server:** `server/service.ts:180-189` (mint), `:262-300` (update);
`server/service-revisions.ts` (per-field capture).
**Client store:** `graph-state.ts:48-49,103-142,284-296`; `optimistic-create.ts:68-85`;
`hooks/use-ontology.ts:218-230`.
**UI:** `attributes-editor.tsx` (all of `AttrValueEditor`, `emptyValueOf`, `KIND_OPTIONS` use),
`template-editor.tsx:21-37,82-96`, `new-object-dialog.tsx:196-210`,
`kanban-column-header.tsx:210-220`, `kanban-card.tsx`, `object-hover-card.tsx`.
**MCP:** `ontology.ts:137-151` (schema + budget), `ontology-ops-write.ts:39,51-55,163-177,282-327`,
`ontology-render.ts:198-205,272-304`, `search.ts:261-281`, `dto.ts:42` (summary projection).
**Changelog:** `src/features/revisions/lib/field-format.ts:50-66`.
**Gates that will fail loudly:** `vocabulary.test.ts`, `object-panel.test.tsx`,
`schema.test.ts`, `schema-sql.test.ts`, `tool-budget.test.ts`, `parity.test.ts`,
`tool-scope-claims.test.ts`, `map-projection.test.ts`, `read-projection.test.ts`.

### Natural seams

1. `AttributeValue` union + `attributeValueSchema` — one discriminated union, two hand-synced copies.
2. `TemplateField` — the only place a *definition* already exists; the obvious host for options/validation.
3. `AttrValueEditor`'s kind switch — one function, one `if` chain; a registry drops in cleanly.
4. `renderValue` in `ontology-render.ts` — one switch, the whole MCP read face.
5. `dto.ts › ONTOLOGY_OBJECT_SUMMARY_COLS` — the one lever for making attributes searchable.

---

## (a) What exists

One ontology board (`ontology_clusters`) holds lane objects, and lane objects hold card objects —
all three are rows in the same `ontology_objects` table, distinguished only by which parent column
their `ontology_memberships` row sets. Every object carries its own untyped bag of attributes as a
JSONB array of `{key, label, value:{kind, value}}`, where `kind` is one of five display hints
(`text`, `pill`, `ref`, `knowledge`, `skill`) — three of which are id-lists and two of which are
free strings. A lane can define a `template` of `{key, label, kind}` field definitions, but that
template is a **birth-time copy source only**: a child is minted with empty attributes matching it
and is then completely free to diverge, and nothing ever re-validates a child against its lane.
Validation is one zod schema of length caps at the API boundary, with **no DB CHECK behind it and
no cross-field consistency rule anywhere**. Writes are optimistic through a reducer, debounced
800ms, and shipped as a whole-array PATCH with an `X-Updated-At` CAS header; every field change is
filed as its own revision row (`attribute:<key>`) per Samuel's HubSpot changelog ruling. Agents get
the graph through `dopl_ontology`'s 18 ops rendered as Markdown — and that rendering **prints
`label: value` with the kind stripped out**, while `dopl_search` indexes ontology objects on
`name`/`subtitle` alone and never sees an attribute at all.

## (b) Gap list vs the HubSpot-style goal

| Goal | Today | Gap |
|---|---|---|
| Typed fields (number, url, email, date, currency, boolean) | Five kinds, three of which are id-lists | **Absent.** Everything non-reference is `text`. |
| Real validation | zod length caps only; **no DB CHECK on the JSONB at all** | No format/range/required/pattern validation anywhere; a non-API writer can store anything. |
| Enum with user-defined options | `pill` is a free-text input, not a picker | **Absent.** No options storage, no picker, no rename-propagation, no colours. |
| Options definable per object template | `TemplateField` = `{key,label,kind}` | No `options`, `required`, `default`, `format`, `help`. |
| Template constrains values | Copies fields at birth, then inert | **No schema enforcement, ever.** Children diverge silently; MCP `set_attribute` defaults `kind:"text"` and overwrites a template's kind (`ontology-ops-write.ts:285`). |
| Unambiguous to agents | `op="get"` prints `label: value`, no kind | An agent cannot distinguish a date from a name; a number arrives as prose; there is no machine-readable JSON face. |
| Searchable | `name`/`subtitle` only, summary projection (`dto.ts:42`) | **Attributes are unsearchable.** "find every deal over $50k" is impossible. Tool text explicitly promises this limitation (`search.ts:135`). |
| Filter / sort by field | Absent | No query op, no `where`, no sort. `op="resolve"` is a name substring capped at 20. |
| One-thing-at-a-time writes | Read-modify-write of the whole bag | Concurrency is CAS-only; two agents editing different attributes of one object conflict. |
| Key hygiene | `slug(label)` derived in **four** places | Rename a label → new `key` → new changelog identity + orphaned template link. |

## (c) The architectural decisions a redesign must make

**1. Schema location: per-template vs per-object vs a property table.**
- (a) Extend `TemplateField` in the lane's `template` JSONB — cheapest, matches the "lane = object type" mental model already in the vocabulary ruling, zero migrations beyond a shape change.
- (b) A real `ontology_properties` table keyed `(cluster_id|column_object_id, key)` — proper rows, FK'd enum options, RLS reuse, DB CHECKs possible.
- (c) Keep schema per-object (status quo).
- **Recommend (a) now, designed so (b) is a later lift**: put `options`, `required`, `format` on `TemplateField`, and make the lane object the authoritative property owner. Ontology is "demoted to substrate" — a whole new table is not proportional to that, and (a) keeps the one place a definition already lives. Write the TS type so a property has an identity (`key`) independent of its label, which is what (b) later needs.

**2. Enforcement posture: advisory vs enforced.**
- (a) Advisory — template describes, values free.
- (b) Enforced on write — server rejects a value whose kind/format contradicts the lane's field.
- (c) Enforced, with a per-field `strict:false` escape.
- **Recommend (b), server-side in `service.ts › updateObject`, not in zod** — zod cannot see the lane's template (it is a different row), so this is a service-layer check that must load the object's clusters/parent anyway for the Q9 gate. That makes it one extra read, not a new query shape. Untemplated (ad-hoc) attributes stay free-typed: the object panel lets people add rows that are not in the template, and killing that would break the 2026-09-13 add-row ruling.

**3. Value storage shape.**
- (a) Keep `{kind, value}` and widen `kind`, values still strings/arrays.
- (b) Store a typed scalar per kind (`{kind:"number", value: 42}`).
- (c) Store canonical string + parsed sidecar (`{kind:"date", value:"2026-09-14", display:"Sep 14"}`).
- **Recommend (b) with canonical serialisations** — number as JSON number, date as ISO-8601 date string, url/email as string, enum as the option **id** not its label (so renaming an option does not rewrite every object). `formatValue` (`field-format.ts:50-66`) already unwraps `{kind,value}` and must keep working; a typed scalar flows through it unchanged. Avoid (c): a derived display field in the changelog payload is a second source of truth for the same fact.

**4. Enum options: where they live and what a value references.**
- (a) Options inline on the `TemplateField` (`options: [{id, label, color}]`), value stores option `id`.
- (b) Options in their own table, value stores a FK.
- (c) Value stores the label string (what `pill` effectively does today).
- **Recommend (a)** — matches decision 1, and the `id`-not-label choice is what makes rename cheap and makes the MCP face unambiguous. ⚠ It creates a **third** id-carrying attribute kind, so `graph-state.ts › resolveIds` (:120-124) and the `CREATE_RESOLVE` path need review even though option ids are not object ids. Reject (c) — it reproduces today's ambiguity.

**5. Migration of existing free-text values.**
- (a) Big bang: infer types, rewrite rows.
- (b) Additive: every existing `text`/`pill` stays exactly as it is; new kinds only apply to fields explicitly retyped; retyping offers a preview of what parses and what does not.
- (c) Lazy: coerce on next write.
- **Recommend (b), and make `pill` the compatibility bridge**: a `pill` retyped to `enum` mints options from the distinct values already present, and any value that does not parse stays as a free-text override on that one object rather than being dropped. A big bang is unrecoverable and there is no DB CHECK today to tell you what is actually in the bag. Precedent for the additive posture: `dto.ts:182-184` (`methods` backfill) and the stale-cache `?? EMPTY_X` rule.

**6. MCP representation: how a typed value reaches an agent.**
- (a) Keep Markdown, add the kind inline: `- Deal size (number): 50000`.
- (b) Add a `response_format:"json"` on `op="get"` that returns the typed object graph.
- (c) A new `op="schema"` that returns a lane's field definitions with enum options, so an agent can write valid values before it writes them.
- **Recommend (a) + (c), and defer (b).** (a) is a handful of chars in `ontology-render.ts:198-205` and closes the single biggest legibility gap. (c) is what makes enum writes possible at all — an agent cannot pick from options it has never been shown, and today `op="get"` shows only the template's kinds, not its options. ⚠ Both cost prose against `SCHEMA_CEILINGS.dopl_ontology = 2809` and `ONTOLOGY_PROSE_BUDGET = 1_503`, which are ratchets; fund the new `kind` enum members by moving the write-op glosses into an MCP resource, exactly as `ontology.ts:36-38` already proposes. Skip (b) until an agent actually needs machine parsing — the Markdown face is the one every existing test pins.

**7. MCP write semantics: does `set_attribute` respect the template?**
- (a) Status quo: `kind` defaults to `text`, silently overwrites.
- (b) `kind` omitted → inherit the lane's template kind; explicit `kind` that contradicts the template → error naming the field and its allowed kind.
- (c) `kind` becomes required.
- **Recommend (b).** (c) breaks every existing agent call and burns schema prose; (a) is the bug that makes typed fields unenforceable from the agent side. (b) is also the only option that makes `set_attribute label="Stage" value="Won"` — the tool's own published example (`ontology.ts:88`) — keep working against an enum field.

**8. Search: do attributes become findable?**
- (a) No — keep the summary projection.
- (b) Widen `ONTOLOGY_OBJECT_SUMMARY_COLS` to include `attributes`.
- (c) A denormalised search column / GIN index on a extracted text projection, plus a filter op.
- **Recommend (c) as the target, (a) until then, and never (b).** (b) re-opens exactly the payload problem `dto.ts:28-38` and `map.ts:102-105` were written to close (634 KB vs 82 KB on a 366-object workspace) and would blow every read budget at once. (c) is a generated `tsvector` (or a narrow `attributes_text` column maintained by trigger) plus a `dopl_ontology op="query"` with `where` clauses — a real feature with its own wave. Until (c) ships, **do not weaken `search.ts:135`'s honest disclosure** — the scope-claims gate pins it by phrase.

**Sequencing note.** 1→2→3→4 are one migration + one service wave and can ship without touching MCP.
6/7 are a second wave that must budget its prose first. 8 is a third wave and is the only one that
needs a new index and a new op. Split `ontology-ops-write.ts` (480) and `attributes-editor.tsx` (391)
in whichever wave first edits them — the 500-line cap allows no exception.
