/** Shared base resolution and error mappers for the `dopl_kb` op modules. */

import type { DoplClient, KnowledgeBase } from "@dopl/client";
import { inlineOr, NO_NAME, NO_PATH, UUID_RE } from "./narration";
import { apiMessage, err, isApiError, type ToolResponse } from "./respond";
import { KB_ENTRY_NOT_FOUND, KB_ERRORS, refusal } from "./tool-errors";
import { FENCE_HEADER } from "./untrusted-fence";

/** Error rows come from one declaration so the description and the refusal are the same characters. */
const BASE_NOT_FOUND = KB_ERRORS[0];

const AMBIGUOUS_SLUG = KB_ERRORS[2];

const MAX_LISTED_MATCHES = 10;

export type BaseRefResolution =
  | { kind: "found"; base: KnowledgeBase }
  | { kind: "not-found" }
  | { kind: "ambiguous"; matches: KnowledgeBase[] };

/** Base ref (id or slug) → base. Name matching runs over rows the server already filtered — never a second copy of
 *  the visibility predicate. A slug naming bases in several containers is refused, never picked (F-701). */
async function resolveBaseRef(
  client: DoplClient,
  ref: string,
): Promise<BaseRefResolution> {
  const needle = ref.trim();
  if (needle === "") return { kind: "not-found" };
  const bases = await client.listKbBases();

  // Any id matches first, whatever its shape: ids are unique, so this arm can never be ambiguous.
  const byId = bases.find((b) => b.id === needle);
  if (byId) return { kind: "found", base: byId };

  // The id door (F-470): a UUID resolves its own container through the server, with no added reach.
  if (UUID_RE.test(needle)) {
    try {
      return { kind: "found", base: await client.getKbBase(needle) };
    } catch (e) {
      // Only the API's not-found is swallowed (404-never-403: no existence oracle for private bases);
      // a transport failure rethrows so an outage never reads as "no such base".
      if (!isApiError(e, 404, "KNOWLEDGE_BASE_NOT_FOUND")) throw e;
    }
  }

  // Falls through for a UUID-shaped slug, which must stay addressable.
  const matches = bases.filter((b) => b.slug === needle);
  if (matches.length === 0) return { kind: "not-found" };
  if (matches.length === 1) return { kind: "found", base: matches[0] };
  return {
    kind: "ambiguous",
    // Container-ordered so a re-read refusal lists stably.
    matches: [...matches].sort((a, b) => a.workspaceId.localeCompare(b.workspaceId)),
  };
}

/** resolveBaseRef + its two refusals; caller short-circuits on `isError`. */
export async function resolveBaseOr(client: DoplClient, ref: string): Promise<KnowledgeBase | ToolResponse> {
  const res = await resolveBaseRef(client, ref);
  if (res.kind === "found") return res.base;
  if (res.kind === "ambiguous") return ambiguousBase(client, ref, res.matches);
  return err(
    refusal(
      BASE_NOT_FOUND,
      `Ref: ${inlineOr(ref, "`(unreadable ref)`")}. Deleting is permanent, so a base you deleted is not recoverable.`,
    ),
  );
}

/** Lists each match, never picks. The container is named by id, never looked up: `listWorkspaces` would bypass the
 *  session lock (`workspace-directory.ts › getWorkspaceList`). Must never throw — this is already the error path. */
async function ambiguousBase(
  client: DoplClient,
  ref: string,
  matches: KnowledgeBase[],
): Promise<ToolResponse> {
  const shown = matches.slice(0, MAX_LISTED_MATCHES);
  const [personal, counts] = await Promise.all([
    personalBaseIds(client),
    Promise.all(shown.map((b) => entryCount(client, b.id))),
  ]);
  const rest = matches.length - shown.length;
  return err(
    [
      refusal(
        AMBIGUOUS_SLUG,
        `Nothing was read or written — ${inlineOr(ref, "`(unreadable ref)`")} names ${matches.length} knowledge bases you can see, in different containers, and this call refuses rather than picking one. A slug is unique only WITHIN a container, so this is a legitimate state. Re-issue with the ID of the one you meant — an id resolves its own container.`,
      ),
      "",
      ...shown.map((b, i) => matchLine(b, counts[i], personal.has(b.id))),
      ...(rest > 0 ? [`- …and ${rest} more; op="list_bases" has them all.`] : []),
    ].join("\n"),
  );
}

function matchLine(
  base: KnowledgeBase,
  count: number | null,
  isPersonal: boolean,
): string {
  const where = isPersonal
    ? `your personal container \`${base.workspaceId}\``
    : `container \`${base.workspaceId}\``;
  const entries =
    count === null
      ? "entry count unavailable"
      : `${count} ${count === 1 ? "entry" : "entries"}`;
  return `- \`${base.id}\` — ${inlineOr(base.name, NO_NAME)} · ${where} · ${entries}`;
}

/** Ids of the caller's personal-container bases; empty when absent or unreadable = no label (INVARIANTS §8). */
async function personalBaseIds(client: DoplClient): Promise<Set<string>> {
  try {
    const payload = await client.listKbBasesPayload();
    return new Set(payload.homeScopedBaseIds ?? []);
  } catch {
    return new Set();
  }
}

/** Entries in one base, or null. `entryLimit: 1` is the cheapest page that makes the server send `entryTotal`. */
async function entryCount(client: DoplClient, baseId: string): Promise<number | null> {
  try {
    const tree = await client.getKbTree(baseId, { entryLimit: 1 });
    return tree.entryTotal ?? null;
  } catch {
    return null;
  }
}

/** Printed above another member's entry body, which renders verbatim inside the fence; the caller's own entries
 *  render bare. Name pinned by `authored-body-untrusted.test.ts`. */
export const UNTRUSTED_ENTRY_BODY_HEADER = FENCE_HEADER;

/** Maps both entry 404s (`KNOWLEDGE_ENTRY_NOT_FOUND`, `KNOWLEDGE_PATH_NOT_FOUND`) to one refusal that names the entry
 *  id as the handle surviving a move; null otherwise so the caller rethrows. */
export function entryNotFound(
  e: unknown,
  path: string,
  baseRef: string,
): ToolResponse | null {
  const traversal = isApiError(e, 404, "KNOWLEDGE_PATH_NOT_FOUND");
  if (!traversal && !isApiError(e, 404, "KNOWLEDGE_ENTRY_NOT_FOUND")) return null;
  const where = traversal
    ? `A FOLDER in that path does not exist${apiMessage(e) ? ` — ${inlineOr(apiMessage(e) ?? "", "")}` : ""}, so nothing below it can.`
    : `The path resolved to nothing, or to a folder rather than an entry.`;
  return err(
    refusal(
      KB_ENTRY_NOT_FOUND,
      `${inlineOr(path, NO_PATH)} in ${inlineOr(baseRef, "`(unreadable ref)`")}. ${where} List the folder it should be in with op="list_dir", or op="get_tree" for the whole base. An ENTRY ID survives a move and a rename; a path does not.`,
    ),
  );
}

/** Maps 403 `AGENT_WRITE_DISABLED` to the server's message; null otherwise so the caller rethrows. */
export function agentWriteDenied(e: unknown): ToolResponse | null {
  if (!isApiError(e, 403, "AGENT_WRITE_DISABLED")) return null;
  return err(
    apiMessage(e) ??
      "This knowledge base is read-only to agents — delete it from the Dopl web UI."
  );
}

/** Runs a write, mapping per-op codes via `more`, then 403 `AGENT_WRITE_DISABLED`; anything unmapped rethrows so an
 *  outage never reads as a refusal. The one copy both write modules share. */
export async function writeOr<T>(
  run: () => Promise<T>,
  more: (e: unknown) => ToolResponse | null = () => null,
): Promise<T | ToolResponse> {
  try {
    return await run();
  } catch (e) {
    const mapped = more(e) ?? agentWriteDenied(e);
    if (mapped) return mapped;
    throw e;
  }
}
