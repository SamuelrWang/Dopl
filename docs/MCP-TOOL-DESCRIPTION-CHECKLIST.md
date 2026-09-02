# MCP tool descriptions — the ten-question audit

**Measured 2026-09-02, slice A14, over the 13 tools this server serves.**

⚠ **RE-DERIVE, DO NOT QUOTE.** Every yes/no below is read off the surface **as
served** through a real `Client.listTools()`. The mechanically checkable rows
are a test, not a table:

```
cd packages/mcp-server && npx vitest run src/tools/tool-style.test.ts
```

That suite fails on the same conditions this table records. **When the two
disagree, the suite is right** — this file is a snapshot with a date on it, and
the suite runs against the tree.

---

## The ten questions

They are the closing checklist of Samuel's production reference (HubSpot /
Notion / Slack, 15 tool definitions, 2026-09-02). For each tool, can the agent
answer these **from the description alone**, at decision time?

| # | Question | Enforced by |
|---|---|---|
| Q1 | In one sentence, what does this return, and what does it NOT return? | `tool-style.test.ts` › *says what it does NOT do, or is read-only* |
| Q2 | When should I use a different tool, and which one? | `tool-style.test.ts` › *carries at least one "Use \<tool>" line naming a served tool* |
| Q3 | What must I call BEFORE this, and why can't I guess the input? | reviewed by hand — the "because Y" clause is prose, not a shape |
| Q4 | What are the exact limits? | `tool-style.test.ts` › *every rendered limit matches a bound the schema actually enforces* |
| Q5 | What does a valid call look like, as JSON? | `tool-style.test.ts` › *shows at least one valid JSON call shape* |
| Q6 | What are the 3 most common errors and the fix for each? | `tool-style.test.ts` › *its Errors block quotes only literals from `tool-errors.ts`* |
| Q7 | How do I keep the response small? | `response-size.test.ts` — and reviewed by hand for the tools with no knob |
| Q8 | Is this read-only or does it mutate? What's the safe default? | `composeDescription`'s required `policy` field — a description cannot be built without one |
| Q9 | If it returns other people's content, is that content marked as untrusted? | `tool-style.test.ts` › *a tool that fences third-party bodies says so* |
| Q10 | Is the most important sentence in the first 200 characters? | `tool-style.test.ts` › *the headline fits the window a truncating client guarantees* |

⚠ **Q10 IS THE ONE THAT DECIDES WHETHER THE OTHER NINE ARE READ.** The reference
observed four of fifteen production descriptions arriving **cut off mid-word**,
and everything past the cut was invisible to the model at decision time. The
rule is enforced on the opening SENTENCE, not on the opening 200 characters: a
sentence that merely *starts* inside the window is exactly the failure being
measured.

---

## The audit

Legend: **yes** = answerable from the description alone. **n/a** = the question
does not apply and the reason is given. Anything else is a FIX and is listed
under the table.

| Tool | served | Q1 | Q2 | Q3 | Q4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 |
|---|---:|---|---|---|---|---|---|---|---|---|---|
| `list_workspaces` | 429 | yes | yes | n/a¹ | n/a² | yes | n/a³ | n/a⁴ | yes | yes | yes |
| `current_workspace` | 450 | yes | yes | n/a¹ | n/a² | yes | n/a³ | n/a⁴ | yes | yes | yes |
| `dopl_home` | 977 | yes | yes | n/a¹ | yes | yes | yes | n/a⁴ | yes | yes | yes |
| `dopl_status` | 609 | yes | yes | n/a¹ | n/a² | yes | yes | yes | yes | yes | yes |
| `dopl_kb` | 1,947 | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| `dopl_skill` | 1,593 | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| `dopl_chats` | 1,699 | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| `dopl_members` | 1,453 | yes | yes | n/a¹ | n/a² | yes | yes | **FIX A** | yes | yes | yes |
| `dopl_map` | 560 | yes | yes | n/a¹ | n/a² | yes | yes | n/a⁴ | yes | yes | yes |
| `dopl_search` | 912 | yes | yes | n/a¹ | yes | yes | yes | yes | yes | yes | yes |
| `dopl_ontology` | 1,924 | yes | yes | yes | n/a² | yes | yes | **FIX B** | yes | yes | yes |
| `dopl_channel` | 1,591 | yes | yes | yes | n/a⁵ | yes | yes | yes | yes | yes | yes |
| `dopl_agent` | 1,948 | yes | yes | n/a¹ | yes | yes | yes | **FIX C** | yes | yes | yes |

Measured through `listTools()` on 2026-09-02. **Served** is the whole description
— hand-written prose plus the generated `Limits:` / `Errors:` / `e.g.` tail.

- **n/a¹** — nothing must be called first. The tool either takes no input
  (`list_workspaces`, `dopl_map`), or every input is a value the caller already
  has. Where a prerequisite IS real it is stated as *call X first — because Y*:
  `dopl_kb` (a `read_file` Version token, because `write_file` 412s without
  one), `dopl_skill` (`op="authoring_guide"` before `op="create"`),
  `dopl_ontology` (`op="map"` first — it routes), `dopl_channel` (`op="help"`
  for the law, and `dopl_home` for a container id published nowhere else).
- **n/a²** — the tool declares no zod bound worth stating. `renderLimits`
  renders nothing rather than inventing a limit, and `tool-style.test.ts` fails
  a `Limits:` line naming a bound the published schema does not enforce.
- **n/a³** — no refusal path of its own. Both meta tools are how a lost agent
  finds out where it is; they are uncharged, take no workspace, and the only
  failures they can surface are the cross-cutting ones the briefing states once.
- **n/a⁴** — one page, no rows to narrow and no body to clip. A knob here would
  be a parameter an agent reads on every connection and can never usefully set.
- **n/a⁵** — `dopl_channel` deliberately renders NO `Limits:` block. Every bound
  in `channel-schema.ts` is already spelled into its own `.describe()`, and
  `summary` states the route's 200 where the schema publishes `maxLength: 2000`
  — rendering would push two different numbers for one field. **This is the one
  place the one-source rule is not yet true**, and reconciling it is a RULING
  rather than an edit: the looser cap is pinned by
  `packages/mcp-server/src/tools/channel-schema-caps.test.ts` (*"Pinned below so a 'consistency' pass
  cannot tighten it"*) and `packages/mcp-server/src/tools/channel-post-guidance.test.ts`, on the
  argument that the ROUTE should be what refuses an over-length summary, by
  name, instead of an opaque client-side `-32602`. See
  `docs/MCP-V2-WAVE-A-2026-09-02.md` §9.

### Open fixes

- **FIX A — `dopl_members` has no `fields=`.** Its roster row is the widest on
  the surface (name, email, role, status, last active, team chips) and an agent
  looking up one person's role pays for all six on every row. `fieldFilter` is
  written and tested (`response-size.ts`); it is not wired here. ⚠ **Wiring it
  takes a ruling first:** `docs/INVARIANTS.md`'s framing rule says *never a
  member-typed name without an immutable id beside it*, so the filter must not
  be able to drop the id — which is a decision about the field vocabulary, not a
  parameter to thread through.
- **FIX B — `dopl_ontology` has no `response_format`.** `op="map"` and
  `op="get"` both render metadata an agent routing through the graph does not
  read.
- **FIX C — `dopl_agent(op="get")` has no `max_chars`.** It returns another
  member's INSTRUCTIONS block whole, and that block has no length bound the
  reader controls — the same shape `dopl_kb(op="read_file")` already answers.

⚠ All three are ADDITIONS, not defects in what shipped: every tool above
answers Q7 for the response it actually returns today, and these are surfaces
where a knob would pay and does not exist yet.


---

## What the audit changed

⚠ **The four rows below were NO before this slice and are the reason it
existed.** They are recorded here rather than in a commit message because each
is a rule, not an edit.

1. **Q6 was NO on thirteen of thirteen.** No description named a single error
   code, and no refusal led with one. Both halves now come from
   `packages/mcp-server/src/tools/tool-errors.ts` — `refusal()` writes the wire
   and `renderErrors()` writes the description, so the literal an agent matches
   on is produced once. Slack's whole reliability trick is one clause (*"If
   'channel_not_found', try slack_search_channels first"*) and it works only
   because the two strings are the same characters.
2. **Q5 was NO on thirteen of thirteen.** Not one description carried a call
   shape. `notion-get-users` teaches its entire surface in six lines of JSON;
   prose describing a shape is a shape the model has to reconstruct.
3. **Q7 was NO except where a `limit` happened to exist.** The three knobs are
   `packages/mcp-server/src/tools/response-size.ts`, and the guarantee that
   makes them usable is that `concise` drops METADATA and never CONTENT.
4. **Q4 had TWO sources and they had already drifted.** Bounds were hand-typed
   into `.describe()` strings beside the `.max()` that published them. The
   numbers are now rendered from the zod shape and the describes carry none.

## What it deliberately did NOT copy

From the same reference, and each is refused in code by
`tool-style.test.ts › the reference's anti-patterns stay out of this surface`:

- **A telemetry parameter billed to the caller's context.** HubSpot REQUIRES a
  `chatInsights` object — user intent plus a satisfaction rating, with ~250
  words of instruction on anonymizing PII — on every search and query call.
  That is product metrics collected through the agent's required-parameter list.
  Derive analytics server-side.
- **A regex validator in a published schema.** Its failure is an opaque `-32602`
  rather than a sentence, and the rule has to be reverse-engineered from a
  character class.
- **A description past 2,000 characters.** Not a long description — a partly
  invisible one.
