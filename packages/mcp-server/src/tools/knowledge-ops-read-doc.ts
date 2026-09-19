/**
 * `dopl_kb` DOCUMENT reads — `op="outline"` and `op="read_file"`: the two ops
 * that answer *what does this entry SAY*, as against the listings in
 * `knowledge-ops-read.ts`, which answer *what is HERE*.
 *
 * ⚠ **ITS OWN FILE BECAUSE THE READ MODULE PASSED §1's 500-LINE CAP AT THE
 * 2026-09-19 MERGE** (it landed at 557), and the seam is the subject rather
 * than the arithmetic: a LISTING renders many rows of member-written metadata
 * inside one fence and never touches a body, while a DOCUMENT read renders one
 * body, windows it, and owns the section vocabulary — the heading resolver, the
 * miss and ambiguity answers, and the outline. ⚠ **SPLIT RATHER THAN TRIMMED**:
 * three branches of one wave each added a true sentence to this module and none
 * of them is the one to delete.
 *
 * ⚠ Both ops are re-exported from `knowledge-ops-read.ts`, so no importer moved.
 */

import type { DoplClient } from "@dopl/client";
import {
  inlineOr,
  isForeignAuthored,
  NO_NAME,
} from "./narration";
import { ok, type ToolResponse } from "./respond";
import { entryNotFound, resolveBaseOr } from "./knowledge-shared";
import { isErr } from "./channel-shared";
import {
  isConcise,
  windowBody,
  type ResponseFormat,
} from "./response-size";
import { fenceBody } from "./untrusted-fence";
import {
  outlineHeading,
  readHeadingsLine,
  renderOutline,
  sectionAmbiguous,
  sectionMiss,
  KB_SECTION_NUDGE_CHARS,
  type Outline,
} from "./knowledge-sections";
import { bodyFact } from "./body-digest";
import { escapedTitleLine, looksEntityEscaped } from "./knowledge-entity-titles";

/**
 * THE OUTLINE OP — every heading in one entry, with what each costs to read.
 *
 * ⚠ **IT IS A READ THAT DELIBERATELY DOES NOT RETURN THE DOCUMENT.** The body
 * is emptied server-side, so an agent deciding WHETHER to read an entry pays a
 * few dozen characters instead of a few thousand. That is the whole trade, and
 * it is why the routing line names this before `read_file`.
 */
export async function opOutline(
  client: DoplClient,
  ref: string,
  path: string,
): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  // ⚠ **THE 404 IS A REFUSAL, NOT A THROW (S41, 2026-09-18)** — the mapper and
  // the argument for "it may have moved" are in `knowledge-shared.ts ›
  // entryNotFound`. Anything else rethrows: a catch that swallowed an outage
  // would report it as a missing document.
  let read;
  try {
    read = await client.readKbFilePart(base.id, path, { outline: true });
  } catch (e) {
    const missing = entryNotFound(e, path, ref);
    if (missing) return missing;
    throw e;
  }
  const outline = read.outline;
  if (!outline || outline.sections.length === 0) {
    // ⚠ NOT AN ERROR, AND IT MUST NOT READ AS ONE. An entry with no headings is
    // the ordinary state of a short note; what the caller needs is the SIZE, so
    // it can decide whether reading the whole thing is cheap.
    return ok(
      [
        `## ${inlineOr(read.entry.title, NO_NAME)} — no headings`,
        `Path: \`${path}\` · ${outline?.totalChars ?? 0} chars whole.`,
        "",
        `Nothing to address by section — read it with op="read_file". Entries over ${KB_SECTION_NUDGE_CHARS} chars should carry \`##\` headings, one topic each.`,
      ].join("\n"),
    );
  }
  return ok(
    [
      outlineHeading(read.entry.title, outline),
      `Path: \`${path}\` · Version: \`${read.entry.updatedAt}\``,
      "",
      ...renderOutline(outline),
    ].join("\n"),
  );
}

/**
 * ⚠ **THREE WAYS TO SPEND LESS ON ONE DOCUMENT, AND THEY COMPOSE IN ONE ORDER.**
 * `section` picks WHAT (server-side — the rest never crosses the wire), then
 * `offset` and `max_chars` pick how much of that to render. A `section` that
 * does not resolve returns the OUTLINE rather than the document, so the retry
 * costs no round trip.
 */
export async function opReadFile(
  client: DoplClient,
  ref: string,
  path: string,
  // ⚠ Only the FRAMING reads this — readability is the server's decision and
  // it already ran.
  callerUserId: string | null = null,
  format?: ResponseFormat,
  maxChars?: number,
  section?: string,
  offset?: number,
): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  let outline: Outline | undefined;
  let sectionLine: string | null = null;
  let entry;
  // ⚠ **BOTH LANES SIT INSIDE ONE TRY (S41, 2026-09-18).** A missing path 404s
  // identically whether or not `section` was passed, so mapping one of them
  // would make the refusal depend on an argument that says nothing about
  // whether the entry is there. `knowledge-shared.ts › entryNotFound` writes it.
  let part;
  try {
    if (section === undefined) {
      // 🔒 **THE HEADINGS COME BACK WITH THE DOCUMENT** (Wave 4 a1). Same body
      // as before, plus the addresses this reader can use next time — which is
      // the difference between an agent that pages a 3k entry by section and
      // one that spends an `outline` call to learn the names it should already
      // have. ⚠ **AND IT IS `readKbFilePart`, NOT `readKbFileByPath`, SINCE
      // 2026-09-19** — the headings ride the part reader's own `outline` key,
      // and routing the unsectioned lane through it is what lets ONE catch
      // below map the 404 for both (S41's rule, unchanged).
      part = await client.readKbFilePart(base.id, path, { headings: true });
      entry = part.entry;
      outline = part.outline;
    } else {
      part = await client.readKbFilePart(base.id, path, { section });
      entry = part.entry;
    }
  } catch (e) {
    const missing = entryNotFound(e, path, ref);
    if (missing) return missing;
    throw e;
  }
  // ⚠ `section !== undefined` IS A NARROWING, NOT A SECOND CONDITION: `part` is
  // only ever set on the sectioned lane, and the compiler cannot see that across
  // the try above.
  if (part !== undefined && section !== undefined) {
    const read = part;
    outline = read.outline;
    const found = read.section;
    if (found && found.ok === false) {
      const lines =
        found.reason === "SECTION_AMBIGUOUS"
          ? sectionAmbiguous(section, found.matches)
          : sectionMiss(section, outline, entry.title);
      // ⚠ `ok`, NOT `err`: the READ succeeded and the heading did not resolve.
      // An `isError` here would make a client that retries on error retry a
      // call that can only answer the same way.
      return ok(lines.join("\n"));
    }
    if (found && found.ok) {
      // ⚠ NO OUTER BACKTICKS: `inlineOr` already renders a VALUE as code, and
      // wrapping its output again produced ``` ``Errors`` ``` — a heading an
      // agent cannot copy back into `section=`.
      sectionLine = `Section: ${"#".repeat(Math.min(3, found.level))} ${inlineOr(found.heading, NO_NAME)} · ${found.chars} of ${outline?.totalChars ?? found.chars} chars (starts at offset ${found.start}).`;
    }
  }
  const { body, notice } = windowBody(entry.body, offset, maxChars);
  const terse = isConcise(format);
  const lines = [
    // ⚠ `concise` KEEPS THE VERSION TOKEN AND DROPS THE REST OF THE METADATA.
    // That split is not arbitrary: `write_file` REFUSES without an
    // `expected_version`, so dropping it would make the smaller read unable to
    // feed the write it exists to precede — a knob that quietly costs a round
    // trip is a knob nobody uses twice.
    `# ${inlineOr(entry.title, NO_NAME)}`,
    // ⚠ DIRECTLY UNDER THE TITLE IT IS ABOUT, and it survives `concise` — the
    // smaller read is the one an agent takes before a write, which is exactly
    // the call that can fix this. It is not an error: the read succeeded and
    // the title is what storage holds.
    ...(looksEntityEscaped(entry.title) ? [escapedTitleLine(entry.title)] : []),
    ...(terse
      ? [`Version: \`${entry.updatedAt}\` (pass as expected_version to write_file)`]
      : [
          // ⚠ **THE WHOLE ENTRY'S SIZE AND FINGERPRINT, OFF THE STORED BODY**
          // (S47/S33) — never off `body` above, which a `section`, a `max_chars`
          // or an `offset` may have windowed. A digest that moved with the READ
          // would compare a window to a document. See `body-digest.ts`.
          `Path: \`${path}\` · entry id: \`${entry.id}\` · type: ${entry.entryType} · ${bodyFact(entry.body)}`,
          `Version: \`${entry.updatedAt}\` (pass as expected_version to write_file) · last edited by ${entry.lastEditedSource} · created ${entry.createdAt}`,
        ]),
    ...(sectionLine ? [sectionLine] : []),
    // ⚠ ON EVERY READ, `concise` INCLUDED, and that is the one metadata line
    // `concise` may not drop: it is what a later call costs, not what this one
    // was. Same argument as the Version token two lines up.
    ...[readHeadingsLine(outline, entry.body.length)].filter(
      (l): l is string => l !== null,
    ),
    ...(notice ? ["", notice] : []),
    "",
    "---",
    "",
    // ⚠ FENCED, and only for a document this caller did not write. The fence's
    // own header goes first — a caveat read after the injected line has already
    // been read is not a caveat — and the close tag carries a per-response
    // random suffix so the body cannot end its own fence (`untrusted-fence.ts`).
    ...(isForeignAuthored(entry, callerUserId)
      ? fenceBody(body, "knowledge entry by another member")
      : [body]),
  ];
  return ok(lines.join("\n"));
}
