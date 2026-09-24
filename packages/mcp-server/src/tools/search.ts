/**
 * `dopl_search`: ranked hits across ten groups (four MCP-native reads + the app search), one scope or (`scope="everywhere"`) every reachable
 * one. The per-scope read is `search-scope.ts › searchScope`; this file renders.
 */

import { z } from "zod";
import { workspaceContext } from "@dopl/client";
import type { DoplClient } from "@dopl/client";
import type { ChargeCredit } from "../registrar.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { inlineOr, NO_NAME } from "./narration";
import { isConcise, RESPONSE_FORMAT_FIELD } from "./response-size";
import {
  entryAddress,
  more,
  ONTOLOGY_CLIPPED_NOTE,
  searchScope,
  snippet,
  termMatcher,
} from "./search-scope";
import { SEARCH_ERRORS } from "./tool-errors";
import { composeDescription, READ_DESCRIPTION_MAX_CHARS } from "./tool-style";
import { searchLegs } from "../workspace-directory";
import { fanOut, MAX_SCOPES } from "./search-everywhere";
import { appFollowUp, appGroupLines } from "./search-app-render";
import { ok, type RegisterTool, type ToolResponse } from "./respond";

/** One shape: published by the registrar and read by `composeDescription` for its bounds. */
const SEARCH_SHAPE = {
  query: z.string().min(1).describe("What to find."),
  // coerce: some MCP clients send numbers as strings.
  limit: z.coerce.number().int().min(1).max(25).optional().describe("Max hits per group (default 8)."),
  response_format: RESPONSE_FORMAT_FIELD,
  scope: z
    .enum(["here", "everywhere"])
    .optional()
    .describe(
      `"here" (DEFAULT): the resolved container, plus the Home bases, objects and identities a home channel sees, or from Home its home channels' rooms. "everywhere": all containers' rooms ranked, then ${MAX_SCOPES} containers in full (ranked hits first), ONE CREDIT EACH; the rest named.`,
    ),
};

/** Budgeted at {@link READ_DESCRIPTION_MAX_CHARS}; the fan-out's cost and cap live on `scope`'s describe. */
const SEARCH_DESCRIPTION = composeDescription({
  headline:
    "Hits, with addresses, in TEN domains: knowledge, skills, ontology objects, identities, channels, messages, threads, artifacts, members, chats.",
  policy: "Read-only.",
  routing: [
    'Use dopl_channel for a message/thread hit; dopl_kb, dopl_skill, dopl_ontology, dopl_agent, dopl_members, dopl_chats read the rest.',
  ],
  body: [
    'A miss is not absence: only ENTRIES and MESSAGES match on bodies: a term in a SKILL.md or an identity\'s INSTRUCTIONS is lost; the CHAT ARCHIVE matches titles.',
  ],
  limits: { shape: SEARCH_SHAPE, only: ["limit"] },
  errors: SEARCH_ERRORS,
  examples: [
    { query: "onboarding" },
    { query: "pricing", limit: 5 },
    { query: "pricing", scope: "everywhere" },
  ],
  cap: READ_DESCRIPTION_MAX_CHARS,
});

/**
 * The per-call footer: what a miss does NOT prove (metadata-only groups, recall-capped entries,
 * unsearched archive) plus the partial-read notice, which names a group that failed to answer.
 */
function scopeNote(limit: number, notice: string, terse: boolean): string {
  // `concise` drops the standing caveat but keeps this call's facts (the partial-read notice and the
  // recall cap, which the 450-char description cannot afford).
  if (terse) {
    return notice
      ? `_${notice}Scope: max ${limit} per group — a recall-capped sample, not a census. See this tool's description._`
      : `_Scope: max ${limit} per group — a recall-capped sample, not a census. See this tool's description._`;
  }
  return `_${notice}Scope: max ${limit} per group, in the scope this call resolved to (see \`scope\`). Only knowledge entries and channel messages are matched on their BODIES; skills, ontology objects, agent identities, channels, threads, artifacts, members (by name, never shown by email) and the chat archive on names, titles and short metadata only, so a term living inside a SKILL.md or inside an identity's instructions is not findable here. Channel groups cover only channels you are a member of. Drafts are excluded from Skills. Agent identities are the ones you can SEE, across both shelves. Teams are not searched. Knowledge entries are a ranked SAMPLE: candidates are capped before ranking, distant matches are dropped, and hits in bases you cannot read are removed after ranking — so fewer hits than \`limit\` does not mean there are no others. A group whose read failed still shows "No matches" and is named with reason=partial_read opening this line; no group here is proof of absence._`;
}

/** The fan-out footer: a wider scope is not a wider domain. */
const SCOPE_AXIS_NOTE = `Each scope was searched the same way a single-scope call searches: knowledge entries and channel messages on their BODIES, every other group on names and short metadata only, ACTIVE skills only, and only what you can see there. Teams are not searched in ANY scope. A wider SCOPE is not a wider DOMAIN — no scope here is proof of absence.`;

/**
 * The container a single-scope call searched, for the app search (which names its container
 * explicitly, unlike the four MCP-native reads): the per-call override, else the connection's
 * binding, else the home space. `standard` is false for a home space or home channel, where the app
 * searches no members and no chats; an unknown kind reads as standard. `inHomeChannel` is the same
 * answer `container-destination.ts › resolveHomeChannelContainer` gives, off the one kind lookup.
 */
async function searchedContainer(
  client: DoplClient,
  directory?: WorkspaceDirectory,
): Promise<{
  id: string | null;
  standard: boolean;
  inHomeChannel: boolean;
  appAcross?: ReadonlySet<string>;
}> {
  let id: string | null = null;
  try {
    id = workspaceContext.getStore() ?? client.getWorkspaceId();
  } catch {
    id = null; // an unreadable binding is "not known", never a throw on the search path
  }
  if (!id && directory) id = (await directory.homeContainer().catch(() => null))?.id ?? null;
  if (!id || !directory) return { id, standard: true, inHomeChannel: false };
  const index = await directory.containerKindIndex().catch(() => null);
  const kind = index?.get(id);
  // "here" from the Home space covers its home channels' rooms too. A locked
  // connection never stands in the Home space, so this reaches nothing new.
  const appAcross =
    kind === "personal" && index
      ? new Set([...index].filter(([, k]) => k !== "workspace").map(([cid]) => cid))
      : undefined;
  return {
    id,
    standard: kind === undefined || kind === "workspace",
    inHomeChannel: kind === "home_channel",
    ...(appAcross ? { appAcross } : {}),
  };
}

/** Without `directory` and `charge` there is no fan-out: `scope="everywhere"` answers (and says it
 *  answered) the single-scope search. */
export function registerSearchTool(
  register: RegisterTool,
  client: DoplClient,
  directory?: WorkspaceDirectory,
  charge?: ChargeCredit,
): void {
  register(
    "dopl_search",
    SEARCH_DESCRIPTION,
    SEARCH_SHAPE,
    async (args): Promise<ToolResponse> => {
      const limit = args.limit ?? 8;
      const matches = termMatcher(args.query);

      if (args.scope === "everywhere" && directory && charge) {
        const legs = await searchLegs(directory);
        // The leg the registrar already charged, matched by id (not always the first leg).
        const alreadyCharged =
          workspaceContext.getStore() ?? client.getWorkspaceId();
        const fan = await fanOut(client, charge, {
          legs,
          query: args.query,
          limit,
          alreadyCharged,
          matches,
        });
        // Only a fan-out that searched nothing answers with the credits refusal.
        if (fan.refusal) return fan.refusal;
        const head = [
          `# Search: ${inlineOr(args.query, "`(unreadable query)`")} — everywhere`,
          "",
        ];
        const foot = [appFollowUp(), "", `_${fan.coverage} ${SCOPE_AXIS_NOTE}_`];
        return ok([...head, ...fan.lines, ...foot].join("\n"));
      }

      const terse = isConcise(args.response_format);
      const where = await searchedContainer(client, directory);
      const found = await searchScope(client, {
        query: args.query,
        limit,
        matches,
        inHomeChannel: where.inHomeChannel,
        containerId: where.id,
        appAcross: where.appAcross,
      });

      // The caller's own query is still neutralized: a backtick would escape the heading.
      const lines: string[] = [`# Search: ${inlineOr(args.query, "`(unreadable query)`")}`];

      lines.push("", "## Knowledge entries");
      if (found.entries.length === 0) lines.push("_No matches._");
      for (const h of found.entries) {
        lines.push(`- ${inlineOr(h.title, NO_NAME)} (${entryAddress(h)}) — ${snippet(h.snippet)}`);
      }

      lines.push("", "## Skills");
      if (found.skills.hits.length === 0) lines.push("_No matches._");
      for (const s of found.skills.hits) {
        const trigger = inlineOr(s.whenToUse || s.description, "`(no trigger described)`");
        lines.push(`- ${inlineOr(s.name, NO_NAME)} \`${s.slug}\` — ${trigger}`);
      }
      lines.push(...more(found.skills, "skills"));

      lines.push("", "## Ontology objects");
      if (found.objects.hits.length === 0) lines.push("_No matches._");
      for (const o of found.objects.hits) {
        const subtitle = o.subtitle ? ` — ${inlineOr(o.subtitle, "")}` : "";
        lines.push(
          `- ${inlineOr(o.name, NO_NAME)} (${found.containerOf(o.id)} · id: \`${o.id}\`)${subtitle}`,
        );
      }
      lines.push(...more(found.objects, "ontology objects"));
      if (found.ontologyTruncated) lines.push(ONTOLOGY_CLIPPED_NOTE);

      lines.push("", "## Agent identities");
      if (found.identities.hits.length === 0) lines.push("_No matches._");
      for (const ident of found.identities.hits) {
        const summary = inlineOr(ident.description, "`(no description)`");
        lines.push(
          `- ${inlineOr(ident.name, NO_NAME)} (id: \`${ident.id}\` · seen by ${found.audienceOf(ident)}) — ${summary}`,
        );
      }
      lines.push(...more(found.identities, "agent identities"));

      lines.push(
        ...appGroupLines(found.app, "##", {
          searched: found.appSearched,
          skipEmpty: false,
          standard: where.standard,
        }),
      );
      if (found.app.length > 0) lines.push("", appFollowUp());

      lines.push("", scopeNote(limit, found.notice, terse));
      return ok(lines.join("\n"));
    }
  );
}
