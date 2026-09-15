# Field type systems: HubSpot, Salesforce, Attio, Airtable, Notion

Research for Dopl's ontology attribute type design. All claims sourced from official docs (URLs at the end of each section).

---

## 1. HubSpot CRM properties

HubSpot splits every property into two orthogonal axes:

- **`type`** — the *storage/data* type. Determines what can be stored and how it is indexed/filtered.
- **`fieldType`** — the *input control*. Determines how the value is entered in the UI or on a form.

Both are required on create. Not every pair is legal.

### type × fieldType matrix

| `type` | valid `fieldType` |
|---|---|
| `bool` | `booleancheckbox`, `calculation_equation` |
| `enumeration` | `select`, `radio`, `checkbox` (multi), `booleancheckbox`, `calculation_equation` |
| `date` | `date` |
| `datetime` | `date` |
| `string` | `text`, `textarea`, `html`, `phonenumber`, `file`, `calculation_equation` |
| `number` | `number`, `calculation_equation` |
| `phone_number` | `phonenumber` |
| `object_coordinates`, `json` | `text` (internal only) |

Note there is **no separate `email` or `url` type** — those are `string` + a *display hint* (`textDisplayHint: email | domain_name | phone_number | ip_address | physical_address | postal_code | multi_line | unformatted_single_line`). Likewise "currency" and "percent" are not types: they are `number` + `numberDisplayHint: currency | percentage | duration | formatted | unformatted | probability` (+ `currencyPropertyName`, `showCurrencySymbol`).

### Field types as the user sees them

| UI field type | type/fieldType | Validation HubSpot enforces | Options model | Multi? | Notes |
|---|---|---|---|---|---|
| Single-line text | string/text | 65,536 char limit via CRM | — | no | |
| Multi-line text | string/textarea | 65,536 chars; no line breaks in emails/quotes/sequences | — | no | |
| Rich text | string/html | 64 KB max property size | — | no | |
| Phone number | string or phone_number / phonenumber | auto-format + validation by country code | — | no | |
| Email | string/text + email display hint | must be valid email w/ domain; domain allow/blocklist | — | no | |
| URL | string/text + domain hint | format enforced, auto-prepends `https://`; domain allow/blocklist | — | no | |
| Single checkbox | bool/booleancheckbox | true/false only | — | no | |
| Dropdown select | enumeration/select | value must be a defined option | `options[]` | no | |
| Radio select | enumeration/radio | same | `options[]` | no | |
| Multiple checkboxes | enumeration/checkbox | same | `options[]` | **yes** | option ≤3,000 chars; property ≤512,000 bytes or 5,000 options |
| Number | number/number | numerals, decimal or scientific | — | no | formatted (20 digits), unformatted (38 digits / 10 decimal), percentage (stored as decimal), currency |
| Date picker | date/date | date only | — | no | |
| Date & time | datetime/date | device timezone for display | — | no | |
| File | string/file | ≤10 files; 20 MB free / 50 MB paid / 100 MB via form | — | yes (10) | |
| HubSpot user (owner) | enumeration + `externalOptions: true` | must be a real user | external | yes | up to 250 owner props per object |
| Calculation | any/calculation_equation | `calculationFormula`; **read-only in UI**, API-writable only | — | — | can't be used on forms |
| Rollup | calculated | Min/Max/Count/Sum/Average over associated records | — | — | |
| Property sync | calculated | mirrors a property on an associated record | — | — | Pro/Enterprise only |
| Score | calculated | — | — | — | cannot be converted to/from other types |

### Property definition JSON (Properties API v3 / 2025-09)

Create request:

```json
{
  "name": "favorite_food",
  "label": "Favorite Food",
  "type": "enumeration",
  "fieldType": "select",
  "groupName": "contactinformation",
  "description": "string",
  "displayOrder": 2,
  "hidden": false,
  "hasUniqueValue": false,
  "formField": true,
  "options": [
    { "label": "Pizza", "value": "pizza", "description": "…",
      "displayOrder": 1, "hidden": false }
  ],
  "dataSensitivity": "non_sensitive | sensitive | highly_sensitive",
  "calculationFormula": "closed - started",
  "currencyPropertyName": "string",
  "externalOptions": false,
  "referencedObjectType": "OWNER",
  "numberDisplayHint": "currency | duration | formatted | percentage | probability | unformatted",
  "textDisplayHint": "domain_name | email | ip_address | multi_line | phone_number | physical_address | postal_code | unformatted_single_line",
  "showCurrencySymbol": true
}
```

Response adds: `archived`, `archivedAt`, `calculated` (bool), `createdAt`, `createdUserId`, `updatedAt`, `updatedUserId`, `hubspotDefined`, `dateDisplayHint` (`absolute | absolute_with_relative | time_since | time_until`), `sensitiveDataCategories[]`, and:

```json
"modificationMetadata": {
  "archivable": true,
  "readOnlyDefinition": false,
  "readOnlyValue": false,
  "readOnlyOptions": false
}
```

That `modificationMetadata` block is the most interesting design idea in HubSpot's schema: **read-only-ness is expressed at three separate levels** — the definition, the value, and the option set — rather than one "system field" boolean.

### Other HubSpot mechanics

- **Required**: not a property-level flag in the API. Required-ness lives on *forms* (`formField`) and on record-creation UI settings ("required properties" per object), not on the property definition. This is a notable gap.
- **Unique**: `hasUniqueValue: true`, max **10 unique-ID properties per object**.
- **Groups**: every property must belong to a `groupName` (property groups are a first-class API object used to categorize properties in the UI).
- **Type changes**: heavily restricted. Conversions that would invalidate stored values are blocked; a property in use by lists/workflows/reports often can't be changed at all; Score/Calculated/Date can't be converted to or from other types. HubSpot's advice is to export data first.
- **Option removal**: options are `hidden`-able rather than deleted, which preserves historical values.

Sources:
- https://developers.hubspot.com/docs/api-reference/crm-properties-v3/guide
- https://developers.hubspot.com/docs/api-reference/latest/crm/properties/create-property
- https://knowledge.hubspot.com/properties/property-field-types-in-hubspot

---

## 2. Salesforce custom fields

Salesforce has **one** axis: `FieldType`, plus a large bag of per-type modifier attributes on `CustomField`.

### FieldType enumeration (Metadata API, complete)

`Address`, `AutoNumber`, `Lookup`, `MasterDetail`, `MetadataRelationship`, `Checkbox`, `Currency`, `Date`, `DateTime`, `Email`, `EncryptedText`, `ExternalLookup`, `IndirectLookup`, `Number`, `Percent`, `Phone`, `Picklist`, `MultiselectPicklist`, `Summary`, `Text`, `TextArea`, `LongTextArea`, `Url`, `Hierarchy`, `File`, `Html`, `Location` (geolocation), `Time`, `Array`, `Integer`, `Long`.

(Number is internally a `double`; `scale: 0` makes it behave like an int.)

| Type | Validation / modifiers | Options model | Multi? | Notes |
|---|---|---|---|---|
| Text / TextArea / LongTextArea / Html | `length`, `visibleLines`, `caseSensitive`, `stripMarkup` | — | no | LongTextArea up to 32,000 in the sample |
| EncryptedText | `maskChar` (asterisk/X), `maskType` (all, creditCard, lastFour, ssn, sin, nino) | — | no | Classic encryption |
| Number / Percent / Currency | `precision`, `scale` | — | no | Currency is its own type, not a display hint |
| Checkbox | `defaultValue` | — | — | |
| Date / DateTime / Time | — | — | no | Time is a separate type |
| Email / Phone / Url | format-validated by platform | — | no | first-class types, unlike HubSpot |
| Picklist | `valueSet` | `CustomValue[]` | no | see below |
| MultiselectPicklist | `valueSet`, `visibleLines` | `CustomValue[]` | **yes** | |
| Lookup | `referenceTo`, `relationshipName`, `relationshipLabel`, `deleteConstraint` (`SetNull`/`Restrict`/`Cascade`), `lookupFilter` | — | no | loose reference |
| MasterDetail | `referenceTo`, `relationshipOrder` (0/1 for junction objects), `reparentableMasterDetail`, `writeRequiresMasterRead` | — | no | ownership/cascade-delete parent |
| Hierarchy | — | — | no | self-reference on User |
| ExternalLookup / IndirectLookup | `referenceTargetField` (must be `externalId` + `unique`) | — | no | external data sources |
| Formula | `formula`, `formulaTreatBlanksAs` (`BlankAsBlank`/`BlankAsZero`) | — | — | read-only computed |
| Summary (roll-up) | `summarizedField`, `summaryForeignKey`, `summaryFilterItems[]`, `summaryOperation` (`Count`/`Min`/`Max`/`Sum`) | — | — | requires master-detail |
| AutoNumber | `displayFormat`, `startingNumber` | — | — | read-only, can be `externalId` |
| Location (geolocation) | `displayLocationInDecimal` | — | — | compound lat/long |
| Address | — | — | — | compound |
| File | — | — | — | |

### Picklist value sets — the richest options model of the five

```xml
<valueSet>
  <restricted>true</restricted>                 <!-- reject values not in the set -->
  <valueSetName>Industries</valueSetName>       <!-- OR inherit a GLOBAL value set -->
  <valueSetDefinition>                          <!-- ...OR define locally -->
    <sorted>true</sorted>
    <value>                                     <!-- CustomValue -->
      <fullName>tech</fullName>
      <label>Technology</label>
      <default>false</default>
      <isActive>true</isActive>
      <color>#FF6600</color>                    <!-- used in charts -->
    </value>
  </valueSetDefinition>
  <valueSettings>                               <!-- DEPENDENT picklist -->
    <valueName>SaaS</valueName>
    <controllingFieldValue>tech</controllingFieldValue>
  </valueSettings>
  <controllingField>Industry__c</controllingField>
</valueSet>
```

Four ideas worth stealing:
1. **`restricted`** — an enum can be open (free text allowed) or closed (validated). This is exactly the toggle Dopl's current loose `pill` kind is missing.
2. **Global value sets** — one option list reused across many fields, edited in one place.
3. **Dependent picklists** — option list of field B filtered by the value of field A.
4. **Deactivate, don't delete** — `isActive: false` retires an option without rewriting history (same idea as HubSpot's `hidden`).

Field-level flags that matter: `required`, `unique`, `externalId` (only for auto number / email / number / text), `defaultValue`, `description`, `inlineHelpText` (field-level help text shown in the UI), `securityClassification` (Public/Internal/Confidential/Restricted/MissionCritical), `complianceGroup` (GDPR/PII/HIPAA/…), `trackHistory`.

Beyond field types, Salesforce enforces cross-field rules via **validation rules** — a boolean formula plus an **error message** and an error location (field or top of page). This is the separation Dopl should note: *type* constrains a value's shape; *validation rules* constrain combinations and carry human-readable messages.

Sources:
- https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_field_types.htm (FieldType enum, ValueSet, ValueSetValuesDefinition, ValueSettings — extracted from the official Metadata API Developer Guide PDF at https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_meta.pdf; the HTML pages 403 to automated fetches)
- https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customfield.htm

---

## 3. Attio — closest analog to what Dopl wants

Attio is data-model-first: attributes are a typed, API-symmetric layer with no `type` vs `fieldType` split. One `type` enum, plus a per-type `config` object.

### Attribute types (15 creatable + `interaction`, `personal-name` system types)

| Type | Value shape | Validation | Options model | Multi? | Notes |
|---|---|---|---|---|---|
| `text` | `{value: string}` | max **10 MB** | — | via `is_multiselect` | plain string accepted on write |
| `number` | `{value: number}` | — | — | — | |
| `currency` | `{currency_value, currency_code}` | ISO 4217 | — | — | `config.currency: {default_currency_code, display_type: code\|name\|narrowSymbol\|symbol}` |
| `checkbox` | `{value: bool}` | — | — | no | |
| `date` | `{value: "YYYY-MM-DD"}` | — | — | — | date-only, distinct from timestamp |
| `timestamp` | `{value: ISO 8601}` | — | — | — | |
| `rating` | `{value: int}` | **0–5 inclusive** | — | no | writable |
| `status` | `{status: {id, title, is_archived, target_time_in_status, celebration_enabled}}` | title/id must exist | separate statuses API | no | kanban column semantics; carries `active_from`/`active_until` — i.e. **time-in-stage is built into the type** |
| `select` | `{option: {id, title, is_archived}}` | title/id must exist; **never auto-creates options** | separate select-options API | `is_multiselect` | single & multi are the *same* type, cardinality is a flag |
| `record-reference` | `{target_object, target_record_id}` | must resolve | `config.record_reference.allowed_objects: ["person"]` | `is_multiselect` | write shortcuts: a bare domain/email/user_id resolves to the record |
| `actor-reference` | actor (workspace member / API token / system) | — | — | yes | "who", distinct from a record link |
| `location` | `{line_1..line_4, locality, region, postcode, country_code, latitude, longitude}` | **atomic** — every property must be sent, even nulls | — | — | also accepts a parsed address string |
| `domain` | `{domain, root_domain}` | domain format | — | yes | |
| `email-address` | `{email_address, email_domain, email_root_domain, email_local_specifier}` | email format, **parsed into parts** | — | yes | |
| `phone-number` | `{phone_number, country_code, original_phone_number}` | E.164 normalization | — | yes | |
| `interaction` | `{interaction_type, interacted_at, owner_actor}` | read-only | — | — | derived from email/calendar sync |
| `personal-name` | `{first_name, last_name, full_name}` | — | — | — | system attribute on people |

Two structural choices that matter for Dopl:

- **Cardinality is a flag (`is_multiselect`), not a type.** There is no separate "multi-select" type — the same `select` type with `is_multiselect: true` takes arrays. Same for record references: `is_multiselect` is literally which side of the relationship you're on ("one" vs "many").
- **Relationships are bidirectional and declared.** A record-reference attribute may carry a `relationship` object naming the reciprocal attribute on the other object, with its own `is_multiselect` — so the pair encodes 1:1 / 1:N / N:N.
- **Every value is time-versioned**: `active_from`, `active_until`, `created_by_actor` are on *every* value, not just history rows. Attribute history is a property of the data model, not a side table. This is directly relevant to Dopl, whose ontology already has "history".

### Attribute definition JSON (GET /v2/objects/{object}/attributes)

```json
{
  "id": { "workspace_id": "…", "object_id": "…", "attribute_id": "…" },
  "title": "Company",
  "description": "A company attribute",
  "api_slug": "company",
  "type": "record-reference",
  "is_system_attribute": false,
  "is_writable": true,
  "is_required": false,
  "is_unique": false,
  "is_multiselect": false,
  "is_default_value_enabled": false,
  "is_archived": false,
  "default_value": null,
  "relationship": {
    "id": { "workspace_id": "…", "object_id": "…", "attribute_id": "…" },
    "object_slug": "companies",
    "title": "Team members",
    "api_slug": "team_members",
    "is_multiselect": true
  },
  "created_at": "2021-11-21T13:22:49.061Z",
  "config": {
    "currency": { "default_currency_code": null, "display_type": null },
    "record_reference": { "allowed_object_ids": ["companies"] }
  }
}
```

Create takes: `title`, `api_slug`, `type`, `description`, `is_multiselect`, `is_required`, `is_unique`, `default_value` (**static** value or **dynamic** template like `current-user` or an ISO 8601 duration), `config`. Select options are **not** set here — they are managed by dedicated endpoints (`.../attributes/{attr}/options` and `/statuses`), and options are archived rather than deleted. `is_unique` is documented as enforced on *new* data only.

Sources:
- https://docs.attio.com/rest-api/endpoint-reference/attributes/list-attributes
- https://docs.attio.com/rest-api/endpoint-reference/attributes/create-an-attribute
- https://docs.attio.com/docs/attribute-types/attribute-types-select
- https://docs.attio.com/docs/attribute-types/attribute-types-status
- https://docs.attio.com/docs/attribute-types/attribute-types-record-reference
- https://docs.attio.com/docs/attribute-types/attribute-types-location
- https://docs.attio.com/docs/attribute-types/attribute-types-rating
- https://docs.attio.com/docs/attribute-types/attribute-types-text
- https://attio.com/help/reference/attio-101/attios-data-model/Understanding-attributes

---

## 4. Airtable and Notion (brief)

### Airtable field types (`type` string + `options`)

| Type | Options shape |
|---|---|
| `singleLineText`, `multilineText`, `richText`, `url`, `email`, `phoneNumber`, `barcode` | none |
| `number`, `percent` | `{precision}` |
| `currency` | `{precision, symbol}` |
| `duration` | `{durationFormat}` |
| `rating` | `{color, icon, max}` |
| `checkbox` | `{color, icon}` |
| `date` | `{dateFormat: {format, name}}` |
| `dateTime` | `{timeZone, dateFormat, timeFormat}` |
| `singleSelect`, `multipleSelects`, `externalSyncSource` | `{choices: [{id, name, color?}]}` |
| `singleCollaborator`, `multipleCollaborators` | `{}` |
| `multipleAttachments` | `{isReversed}` |
| `multipleRecordLinks` | `{linkedTableId, isReversed, prefersSingleRecordLink, inverseLinkFieldId?, viewIdForRecordSelection?}` |
| `multipleLookupValues` | `{fieldIdInLinkedTable, recordLinkFieldId, isValid, result?}` |
| `rollup` | `{fieldIdInLinkedTable?, recordLinkFieldId?, result?, isValid?, referencedFieldIds?}` |
| `count` | `{recordLinkFieldId?, isValid}` |
| `formula` | `{formula, isValid, referencedFieldIds, result?}` |
| `aiText` | `{prompt?, referencedFieldIds?}` |
| `autoNumber`, `button`, `createdTime`, `lastModifiedTime`, `createdBy`, `lastModifiedBy` | read-only / computed |

Select choices: `{id, name, color?}` — **color is part of the option**, and cardinality is baked into the *type name* (`singleSelect` vs `multipleSelects`), the opposite of Attio's flag approach. No `required`/`unique` concept at all; no `default` in the field model. Airtable has no validation layer — the type is the only constraint.

Source: https://airtable.com/developers/web/api/field-model

### Notion database property types

`title`, `rich_text`, `number` (`{format}` — `number`, `number_with_commas`, `percent`, `dollar`, `euro`, … ~20 currency formats), `select`, `multi_select`, `status`, `date`, `people`, `files`, `checkbox`, `url`, `email`, `phone_number`, `formula` (`{expression}`), `relation` (`{data_source_id, single_property | dual_property}`), `rollup` (`{relation_property_id, rollup_property_id, function}` — average, checked, count, sum, min, max, …), `unique_id` (`{prefix}`, auto-incrementing), `created_time`, `created_by`, `last_edited_time`, `last_edited_by`, `button`, `verification`, `place` (partial API support).

Options: `select`/`multi_select` options are `{id, name, color}` with a fixed 10-color palette (blue, brown, default, gray, green, orange, pink, purple, red, yellow). **`status` is `{options: [...], groups: [{name, color, option_ids}]}`** — i.e. Notion's status type adds a *grouping* layer over options (To-do / In progress / Complete), which is how it drives board columns.

Notably: Notion explicitly does **not** validate `email`, `url`, or `phone_number` — "no format is enforced". They are labels for rendering only.

Source: https://developers.notion.com/reference/property-object

---

## 5. Cross-cutting consensus

### Consensus matrix

| Candidate type | HubSpot | Salesforce | Attio | Airtable | Notion |
|---|---|---|---|---|---|
| Short text | string/text | Text | text | singleLineText | rich_text / title |
| Long text | string/textarea | TextArea, LongTextArea | text (10 MB) | multilineText | rich_text |
| Rich text | string/html | Html | — | richText | (page content) |
| Number | number/number | Number, Integer, Long | number | number | number |
| Percent | numberDisplayHint | Percent | — (number) | percent | number(format) |
| Currency | numberDisplayHint + currencyPropertyName | Currency | currency | currency | number(format) |
| Boolean | bool/booleancheckbox | Checkbox | checkbox | checkbox | checkbox |
| Date (no time) | date | Date | date | date | date |
| Date+time | datetime | DateTime | timestamp | dateTime | date |
| Time only | — | Time | — | — | — |
| Duration | numberDisplayHint: duration | — | — | duration | — |
| Single select (enum) | enumeration/select\|radio | Picklist | select | singleSelect | select |
| Multi select | enumeration/checkbox | MultiselectPicklist | select + is_multiselect | multipleSelects | multi_select |
| Status / stage | enumeration (pipeline objects) | Picklist | **status** (first class) | singleSelect | **status** (+groups) |
| Rating | — | — | rating (0–5) | rating | — |
| Email | string + textDisplayHint | Email | email-address (parsed) | email | email (unvalidated) |
| URL / domain | string + domain hint | Url | domain (parsed) | url | url (unvalidated) |
| Phone | phone_number/phonenumber | Phone | phone-number (E.164) | phoneNumber | phone_number (unvalidated) |
| Address / location | object_coordinates (internal) | Address, Location | location | — | place (partial) |
| Record reference | enumeration + referencedObjectType | Lookup, MasterDetail, ExternalLookup, Hierarchy | record-reference (+relationship) | multipleRecordLinks | relation |
| Person / user | enumeration + externalOptions (owner) | Lookup(User), Hierarchy | actor-reference | singleCollaborator, multipleCollaborators | people |
| File / attachment | string/file | File | — | multipleAttachments | files |
| Formula | calculation_equation | Formula | — | formula | formula |
| Rollup / aggregate | rollup, property sync | Summary | — | rollup, count, multipleLookupValues | rollup |
| Auto number / unique id | hasUniqueValue | AutoNumber | is_unique | autoNumber | unique_id |
| Created/updated by & at | createdAt/updatedAt metadata | system fields | active_from / created_by_actor | createdTime, createdBy, … | created_time, created_by, … |
| AI-generated text | — | — | (AI attributes in app) | aiText | — |

**The consensus core — in all five:** text, long text, number, boolean/checkbox, date, date-time, single select, multi select, email, url, phone, relation/reference, person/user, files, formula, rollup, system timestamps.

**CRM-sales-specific (present in HubSpot/Salesforce/Attio, absent or generic in Airtable/Notion):** currency with a currency code, pipeline **stage/status with time-in-stage**, roll-up over child records, owner, score, interaction/activity-derived fields, compliance/sensitivity classification.

**Structural vs scalar.** Scalars (text/number/bool/date/enum/email/url/phone) only constrain a single cell. The structural four — **reference, lookup, rollup, formula** — are relationships or derivations: they are *read-mostly*, depend on other objects, can go invalid when the target changes (Airtable literally exposes `isValid` on formula/rollup/lookup), and they are the ones that make a schema hard to migrate. Every product treats them as a separate class: computed fields are read-only, and references carry delete semantics (Salesforce `deleteConstraint`, Attio `allowed_objects`).

### How each handles the recurring problems

**Options with label + value + color + order**
- HubSpot: `{label, value, description, displayOrder, hidden}` — no color.
- Salesforce: `CustomValue {fullName, label, default, isActive, color}` + `valueSetDefinition.sorted` + global value sets + dependent picklists + `restricted` (open vs closed enum).
- Attio: `{id, title, is_archived}` — no color in the API, order implicit; managed by a dedicated options endpoint; writing an unknown title errors rather than auto-creating.
- Airtable: `{id, name, color}` — color first-class.
- Notion: `{id, name, color}` from a 10-color palette; `status` adds `groups[{name, color, option_ids}]`.

Common law across all five: **options are archived/hidden/deactivated, never hard-deleted**, so existing records keep meaning, and the **stable id is separate from the display label** so renaming an option doesn't rewrite data. (Airtable, Notion, Attio all key on option `id`; HubSpot keys on `value` with `label` free to change; Salesforce keys on `fullName`.)

**Type changes on existing data**
- HubSpot: most conversions blocked; blocked outright if lists/workflows/reports depend on the property; Score/Calculated/Date can't convert either way; export first.
- Salesforce: conversion allowed with data-loss warnings; some (e.g. to/from Master-Detail, formula) require recreating the field.
- Attio: not exposed as an operation in the API — you create a new attribute.
- Airtable/Notion: allow conversion, silently coerce or drop values that don't fit.

**Required / unique / default**
- Salesforce: `required`, `unique`, `externalId`, `defaultValue` all on the field — the most complete.
- Attio: `is_required`, `is_unique` (new data only), `default_value` with a **dynamic** form (`current-user`, relative durations) — the best default-value model.
- HubSpot: `hasUniqueValue` only (max 10/object); required lives on forms/UI, not the definition.
- Airtable / Notion: none of the three.

**Validation messages**
Only Salesforce has a real story: validation rules are boolean formulas with an author-written `errorMessage` and an error display location. Everyone else surfaces generic type errors. For an agent-first system this matters more than for a human UI — an agent can *act on* a good error message and retry; a generic 400 just makes it guess.

---

## 6. What an agent-first system should borrow

Design principles first, because they matter more than the type list:

1. **One `type` axis, not HubSpot's two.** `type` + `fieldType` exists because HubSpot needs to pick a form widget. Dopl's primary consumer is an agent reading a schema over MCP; a second axis is one more thing for the agent to get wrong. Keep rendering hints in an optional `display` sub-object (Attio's `config` pattern), never as a second required enum.
2. **Cardinality is a flag, not a type** (`is_multi: true`), per Attio. Halves the type count and means an agent writing an array to a single-value field gets a clear "this attribute is single-valued" error instead of needing to know `singleSelect` vs `multipleSelects`.
3. **Options are a sub-resource with stable ids.** `{id, label, color, order, archived}`. Never auto-create an option from a write — that's how agents silently fragment an enum into "Enterprise"/"enterprise"/"Ent." Reject, and return the valid option list in the error. Archive instead of delete.
4. **Every enum gets a `restricted` flag** (Salesforce). Closed = validated against options; open = free text allowed but suggested. This is the migration path from Dopl's current untyped `pill`.
5. **Machine-actionable validation errors.** Every rejection should name the attribute, the rule violated, and the allowed set/range/format — the agent-first equivalent of Salesforce's custom error messages.
6. **Type changes are explicit and lossy-by-declaration.** Either refuse (HubSpot) or require an agent to pass an acknowledgment and report how many values would be dropped. Never silently coerce.

### Recommended type set for Dopl (~13)

| Type | Rationale |
|---|---|
| `text` | Single/multi-line string, optional `max_length` and `format` hint. The universal fallback; keeps today's `text` kind working. |
| `number` | With `precision`, optional `min`/`max`, and a `display` of plain / percent / currency(+code). One numeric type beats three; currency as a display config the way HubSpot does it, not a type. |
| `boolean` | True/false. Cheapest possible constraint and an agent can reason over it; today's untyped text can't be filtered. |
| `date` | Date only, ISO `YYYY-MM-DD`. Separate from timestamp because "close date" and "last touched" behave differently in filters and reminders. |
| `timestamp` | ISO 8601 instant. Agents log events; a real instant type makes recency queries possible. |
| `select` | Enum with user-defined options `{id, label, color, order, archived}`, `restricted` flag, `is_multi` for multi-select. **This is the type Samuel actually asked for** — one type covers dropdown, radio, multi-checkbox, and tags. |
| `status` | Select with ordered stages + optional grouping and time-in-stage (Attio/Notion). Worth separating from `select` because pipelines are the #1 CRM-shaped use case and the time-in-stage data is what agents report on. |
| `email` | Validated and parsed into `{address, domain}`. Dopl's agents route and dedupe by domain constantly; parsing at write time beats regexing at read time. |
| `url` | Validated, normalized (scheme prepended), with `domain` parsed out. Same argument. |
| `phone` | E.164-normalized with country code. Cheap to add once you have a normalizer, and dedupe is impossible without it. |
| `ref` | Object reference with `allowed_object_types[]`, `is_multi`, and an optional declared `inverse` attribute on the target (Attio's `relationship`). Upgrades today's loose `ref` into a typed, bidirectional, validated edge. |
| `actor` | Member/agent reference — "who owns this", "who wrote this". Distinct from `ref` because actors aren't ontology objects and the resolution rules differ (and Dopl already has members + agents as first-class). |
| `knowledge` | Existing kind: link to a KB entry. Keep it — it's Dopl's differentiator and the one type none of these five products has. |
| `skill` | Existing kind: link to a skill. Same argument: an attribute whose value is an executable procedure is the agent-first analog of Salesforce's `button` field. |

Plus, not user-creatable but system-provided on every object: `created_at` / `updated_at` / `created_by` / `updated_by`, and per-value `active_from` / `set_by` (Attio's time-versioning) so "history" falls out of the data model instead of a side table.

### Explicitly leave out

- **`fieldType` as a second required axis** — see principle 1.
- **Formula / calculated fields** — every product has them and every one of them is a language you now have to own (parser, dependency graph, invalidation, `isValid` state). In an agent-first system the agent *is* the formula engine: let a skill compute and write a plain value. Revisit only if agents are recomputing the same expression at scale.
- **Rollup / lookup / count** — same argument, plus they require a live dependency graph across objects. An agent can aggregate on read.
- **Currency, percent, duration as separate types** — display configs on `number`.
- **`time`-only, `geolocation`, `address`, `rating`, `barcode`, `auto-number`** — real types in these products but none map to a Dopl use case today; address in particular is a 10-field compound with atomic-update semantics (Attio) for very little payoff. `text` covers them until something demands otherwise.
- **`file` / attachment** — only once Dopl has a blob store with a lifecycle story; a `url` to the file is a fine interim.
- **Dependent / cascading selects** — powerful (Salesforce) but a large UI surface and a second validation pass. Not v1.
- **Global/shared value sets** — good idea, but ship per-attribute options first and factor them out when duplicate option lists actually appear.
- **Rich text / HTML** — Dopl already has KB entries for long-form content; `knowledge` is the right pointer.
- **Sensitivity/compliance classification** (HubSpot `dataSensitivity`, Salesforce `securityClassification`) — worth a note for later, since agents reading attributes over MCP is exactly the case where a "don't send this off-box" flag earns its keep, but it's an access-control feature, not a field type.
