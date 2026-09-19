/**
 * **AN ENTITY-ESCAPED TITLE, SAID OUT LOUD** — the one field rule this surface
 * owns about `&amp;` in a knowledge title or folder name, and the two sentences
 * that state it (S35, 2026-09-18). The seam is `knowledge-sections.ts`'s: one
 * field's rule plus its prose, next to the op modules that spend it.
 *
 * ⚠ **NOBODY IN THIS TREE EVER ESCAPED A TITLE.** They ride raw from the client
 * to the column and back; the only `escapeHtml` that exists is the web search
 * popup's (`src/features/search/server/snippet.ts`), which renders and stores
 * nothing. A stored `R&amp;D` was escaped by whatever WROTE it, and until now
 * nothing anywhere said so — the row is valid, the charset rule passes, and
 * every surface prints `R&amp;D` forever.
 *
 * ⚠ **THE FIX IS SPLIT AND EACH HALF ONLY REACHES ITS OWN ROWS.**
 * `src/features/knowledge/schema.ts › decodeHtmlEntities` decodes what is
 * WRITTEN from now on, {@link titleDecodedNote} says when it did, and the rows
 * already in storage are the migration's
 * (`supabase/migrations/20261015120000_backfill_entity_escaped_knowledge_titles.sql`).
 * {@link escapedTitleLine} exists because that migration is WRITTEN, NOT
 * APPLIED — and because a title derived from a path LEAF is never decoded at
 * all (the path is an address; `schema.ts › EntryTitleSchema` states why).
 *
 * ⚠ **THIS MODULE DETECTS AND DOES NOT DECODE, DELIBERATELY.**
 * `packages/mcp-server` cannot import the app's `src/` (tsconfig `rootDir`), so
 * a decoder here would be a second, un-pinned opinion about what an entity is.
 * The entity SET is hand-copied below and nothing else is: the signal names the
 * fix and the server performs it.
 */
/** True when a stored label still LOOKS entity-escaped. */
export declare function looksEntityEscaped(label: string): boolean;
/**
 * ONE CLAUSE on a write result, and only when the decode actually changed the
 * title the caller sent.
 *
 * ⚠ **THE STORED VALUE IS THE EVIDENCE, NOT A LOCAL RE-DECODE.** The server
 * answers with the row it wrote, so comparing it against the argument is the
 * only test that cannot disagree with storage. ⚠ Instruction, no rationale: a
 * write result is read once, by an agent that now needs the address.
 */
export declare function titleDecodedNote(requested: string | undefined, stored: string): string;
/**
 * The READ-path signal: one line, naming the fix.
 *
 * ⚠ **`reason=` LEADS AND `fix=` CLOSES**, the shape every other refusal-ish
 * line on this surface takes (`knowledge-sections.ts › unsectionedNudge`), so an
 * agent that has learned one has learned this. ⚠ It is NOT an error — the read
 * succeeded and the title is exactly what storage holds.
 */
export declare function escapedTitleLine(sample: string, count?: number): string;
