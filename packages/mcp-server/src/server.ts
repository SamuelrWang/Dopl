import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { DoplClient } from "./api-client.js";
import type { ClusterSummary, BrainData } from "./types.js";
import {
  writeClusterSkill,
  writeGlobalCanvasSkill,
  writeGlobalClaudemd,
  appendMemoryToSkill,
  skillExists,
  removeClusterSkill,
  type SkillTarget,
} from "./skill-writer.js";

const CONTEXT_CHAR_BUDGET = 2000;

const SERVER_INSTRUCTIONS = `You are connected to **Dopl** — a knowledge base of proven AI and automation implementations including agent workflows, n8n automations, Claude skills, API integrations, and more.

## How to use this

You are an expert architect. Use the Dopl tools as your reference library — search for proven patterns, retrieve implementation details, and synthesize custom solutions. Your job is to **compose original recommendations** by combining knowledge from multiple sources, not to list or recommend individual entries.

## Proactive use — start with search, don't ask permission

When the user describes anything AI/automation-adjacent — building an agent, wiring up an n8n workflow, composing a Claude skill, integrating an API, scraping a site, automating a task, connecting two services, setting up an MCP, handling webhooks — **call \`search_setups\` immediately, before synthesizing anything from scratch**. Do not ask the user "should I search the KB first?" or "want me to check Dopl?" — just search. It's cheap (1 credit), the result is always relevant context, and it's the reason you're connected to this server.

Same rule applies when the user asks "how would I…", "what's a good way to…", "can you help me build…" — these are all search triggers, not questions you answer from general knowledge.

## Session start — preload the user's workspace

At the very start of every new session, before your first substantive reply, call \`list_clusters\` and \`canvas_list_panels\` **in parallel**. This loads the user's current clusters and canvas entries so questions about their workspace are grounded in real state from turn one — not in whatever stale picture their local CLAUDE.md or installed skill files might paint.

You do NOT need to re-run these on every turn. Once per session is enough, with these exceptions:

- **User asks about their workspace** ("what's on my canvas?", "which clusters do I have?", "show my setup") → **re-query first**. They may have added or removed entries via the web UI mid-session; stale data will mislead them.
- **After your own write ops** (\`canvas_add_entry\`, \`canvas_create_cluster\`, \`delete_entry\`, \`rename_cluster\`, etc.) → trust the tool response. It already reflects the new state.
- **Unrelated turns** → don't refresh. The session-start load covers you.

**Canvas/clusters > local files as source of truth.** If a user's \`CLAUDE.md\` or a \`~/.claude/skills/\` file implies they have a different set of clusters than what \`list_clusters\` returns, trust the MCP result and flag the drift. Local skill files are caches that can fall out of sync; the canvas is canonical.

## Decision tree — which tool first

- User wants to **find or build** something AI/automation-shaped → \`search_setups\` (cross-KB) or \`query_cluster\` (if a cluster is already in scope)
- User wants the **full details** of an entry you already have a slug/UUID for → \`get_setup\`
- User wants to **save** a specific entry to their workspace → \`canvas_add_entry\` (one entry by slug) or \`canvas_search_and_add\` (search + batch add in one shot)
- User wants to **group** saved entries into a reusable skill → \`canvas_create_cluster\`
- User gives you a **durable preference or correction** ("I prefer X over Y", "skip step Z") → \`save_cluster_memory\` on the relevant cluster
- User wants to **compose an original solution** spanning multiple patterns → \`build_solution\`
- User asks **has anything changed** in their saved work → \`check_cluster_updates\` (bulk) or \`check_entry_updates\` (one)

## Pending ingestions — the user's Dopl queue

Every Dopl tool response carries a \`_dopl_status\` footer with \`pending_ingestions: N\`. These are URLs the user pasted into the Dopl website chat that are **waiting for YOU** (their connected agent) to process. The site no longer auto-ingests — ingestion is your job.

**When the footer shows \`pending_ingestions > 0\`:**

1. Tell the user: "You have N URL(s) queued on Dopl — want me to process them?"
2. On yes: call \`list_pending_ingests\` to see the URLs, then call \`prepare_ingest(url)\` for each. \`prepare_ingest\` transparently claims the pending skeleton (flips it to processing) — you do NOT need a special parameter; pass the same URL that's in the queue.
3. Follow the normal \`prepare_ingest\` → run prompts → \`submit_ingested_entry\` flow. The amber tile on the user's canvas updates live as you progress.

Don't nag the user repeatedly in a single session. If they decline once, drop it until they bring it up or a new item appears.

## Sibling pairs — pick carefully

These tool pairs overlap and picking the wrong one wastes a round trip:

- \`search_setups\` (cross-KB, broad) vs \`query_cluster\` (scoped to one cluster, narrow) — use the second only when a cluster is already the focus of the conversation.
- \`canvas_add_entry\` (you already have the slug) vs \`canvas_search_and_add\` (search + batch) — use the second when the user's request implies discovery, not a known entry.
- \`save_cluster_memory\` (NEW memory) vs \`update_cluster_memory\` (edit existing) — call \`get_cluster_brain\` first if you're not sure whether a matching memory already exists.
- \`check_entry_updates\` (one entry) vs \`check_cluster_updates\` (every entry in a cluster) — use the bulk version for cluster-wide refresh.
- \`update_cluster_brain\` (edit synthesized instructions) vs \`save_cluster_memory\` (append a short preference) — use the memory path for short corrections, the brain edit path for structural changes.

## What you can do

- **Search** — Find relevant implementations by natural language query
- **Deep dive** — Pull full implementation details (README, setup instructions, metadata) for any entry
- **Build** — Compose a complete solution by combining patterns from multiple implementations
- **Canvas** — Manage the user's workspace: add entries, organize into clusters, browse saved items
- **Brain** — Read and edit cluster brains (synthesized instructions + memories) to capture durable preferences and corrections
- **Skills** — Cluster knowledge can be synced as skill files. Run \`sync_skills\` to write them to ~/.claude/skills/ (Claude Code) or pass target='openclaw' to write to ~/.openclaw/workspace/data/dopl/

## Linking entries

Every entry has a public URL of the form \`<host>/e/<slug>\`. Tool responses include this URL alongside each entry. **Whenever you mention a specific entry in your reply to the user, render it as a markdown link using that URL** — e.g. \`[Claude Agents in Production](https://www.usedopl.com/e/claude-agents-in-production)\`. **Never surface entry IDs, UUIDs, or raw slugs in prose** — they are internal handles used only for follow-up tool calls.

When a tool accepts an \`entry\` parameter, you may pass either the entry's slug or its UUID — the server resolves either.

## Cluster brains are the skill itself

A cluster brain IS the skill body that Claude Code executes against — the local \`SKILL.md\` file is a thin pointer that fetches the brain at invocation time. That makes brain quality = skill quality, 1:1. **All brain generation happens in YOUR context, not on Dopl's server.** The server returns prompts and templates; you run the synthesis.

The canonical brain structure mirrors Claude Code's native skill-creator format. Every brain should have these sections (omit any you can't fill honestly):

\`## When to use this skill\` — concrete trigger scenarios with user-prompt phrasings
\`## Instructions\` — core guidance for executing the skill
\`## Step-by-step\` — numbered procedure (omit if the skill isn't procedural)
\`## Examples\` — 2–3 concrete user-intent → agent-response scenarios
\`## Anti-patterns\` — what NOT to do; wrong tools, out-of-scope uses
\`## References\` — one line per cluster entry with its role

When creating a new cluster: the tool response instructs you to call \`get_skill_template\` to fetch the synthesis prompt, run synthesis in your context against the entries' agents.md, and write the result with \`update_cluster_brain\`.

## When to edit the brain vs. save a memory vs. do nothing

This is a routing decision every conversation will produce. Get it right:

**Edit the brain (\`update_cluster_brain\`) when the user gives you structural, durable knowledge:**
- They correct a step in the workflow itself ("actually, step 3 is wrong — it should be X", "remove the part about Y")
- They add a new repo/entry to the cluster that introduces a pattern the brain doesn't cover (chain with \`add_entry_to_cluster\` first)
- They describe a new use case the skill should cover ("let's also make this work for …")
- A section is out of date or contradicts current reality
- The correction changes the fundamental approach, not just a parameter
Read the brain first with \`get_cluster_brain\`, then make a SURGICAL edit — replace only the affected section, keep the rest verbatim. Never rewrite from scratch; the brain often contains prior edits you'd lose.

**Save a memory (\`save_cluster_memory\`) when the user gives you a short preference, correction, or environmental fact:**
- They express a preference ("I prefer Resend over SendGrid", "always use X")
- They reveal a setup-specific value ("my API key env var is OPENAI_KEY, not OPENAI_API_KEY")
- They note a gotcha specific to their environment ("this step doesn't work on Windows", "skip step 2 in my case")
- Short corrections that augment rather than replace existing brain content
Use \`update_cluster_memory\` instead when a near-duplicate memory already exists (call \`get_cluster_brain\` first to see memory IDs).

**Do both when** a conversation produces both a structural correction AND a short preference. Don't cram preferences into brain instructions; memories are a separate lane for a reason.

**Ask first when** the edit is material (renaming a section, removing guidance the user previously wrote) AND the user's intent was implicit — e.g., they described a problem but didn't explicitly ask you to change the skill. Brief confirmation: "Should I update the X cluster's skill to reflect this?"

**Do nothing when** the observation is transient or task-specific (debugging a one-off, current session context, questions you answered but that don't change durable guidance).

**Trigger phrases to pattern-match on:**
- "from now on…" → memory or brain edit depending on scope
- "actually, step X is wrong…" → brain edit
- "for my setup…" / "in my environment…" → memory
- "let's also include…" / "add X to the skill" → brain edit
- "remove the part about…" / "that's wrong" → brain edit
- "I just added <repo> to my canvas, update the <cluster> skill" → \`add_entry_to_cluster\` + brain edit

After any brain or memory write, call \`sync_skills\` so the thin-pointer \`SKILL.md\` on disk reflects the canonical state.

## Behavior

- When the user describes what they want to build, search first, then synthesize a concrete plan
- Focus on actionable guidance: tool recommendations with rationale, architecture decisions, integration patterns, setup steps
- Reference specific tools, repos, and patterns — not the database entries they came from
- Cluster skills are living documents — update them when you learn new patterns or receive user corrections
- Never edit cluster \`SKILL.md\` files directly on disk; always go through the MCP tools so changes propagate to the brain (the canonical source)`;

/**
 * Tool-response shape the MCP SDK accepts. We re-declare it locally to
 * keep the wrapper typed without pulling the SDK's handler type.
 */
type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Append a pending-ingestion status footer to a tool response so the
 * user's connected agent notices URLs they queued from the Dopl website
 * chat. Fires on every tool response (see the `tool()` helper below).
 *
 * Skips the footer when:
 *   - the handler returned isError: true (don't muddy error messages)
 *   - the user has zero pending ingestions (keep successful responses
 *     clean when there's nothing to surface)
 *
 * The pending status is cached inside DoplClient for 5s; prepare_ingest
 * invalidates the cache so the footer reflects a just-claimed row.
 */
async function appendDoplStatus(
  response: ToolResponse,
  client: DoplClient,
): Promise<ToolResponse> {
  if (response.isError) return response;

  let status;
  try {
    status = await client.getPendingStatus();
  } catch {
    return response;
  }

  if (!status || status.pending_ingestions <= 0) return response;

  const hint = `Call \`list_pending_ingests\` to see queued URLs, then \`prepare_ingest(url)\` to claim and process.`;
  const footer = `\n\n---\n_dopl_status:\n  pending_ingestions: ${status.pending_ingestions}\n  hint: "${hint}"`;

  // Append to the final text block so the agent sees the footer at the
  // end of a rendered response. If the response has no text content
  // (rare — tools always return text), add a new block.
  const content = [...response.content];
  const lastIdx = content.length - 1;
  if (lastIdx >= 0 && content[lastIdx]?.type === "text") {
    content[lastIdx] = {
      type: "text",
      text: `${content[lastIdx].text}${footer}`,
    };
  } else {
    content.push({ type: "text", text: footer.trimStart() });
  }
  return { ...response, content };
}

/**
 * Wrap a tool handler so every successful response ends with the
 * `_dopl_status` footer. Handlers stay unaware of the mechanism.
 */
function withDoplStatus<A extends object>(
  handler: (args: A) => Promise<ToolResponse>,
  client: DoplClient,
): (args: A) => Promise<ToolResponse> {
  return async (args: A) => {
    const result = await handler(args);
    return appendDoplStatus(result, client);
  };
}

export function createServer(
  client: DoplClient,
  options: { isAdmin?: boolean } = {},
): McpServer {
  const isAdmin = options.isAdmin === true;
  const server = new McpServer(
    {
      name: "dopl",
      version: "0.1.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  // ── Tool registration helper ─────────────────────────────────────
  // Every call funnels through here so the _dopl_status footer is
  // attached uniformly. Matches the MCP SDK's own zod-inference
  // signature so handler arg types come through correctly.
  function registerTool<S extends ZodRawShape>(
    name: string,
    description: string,
    schema: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>,
  ): void {
    server.tool(
      name,
      description,
      schema,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      withDoplStatus(handler as any, client) as any,
    );
  }

  // ── search_setups ──────────────────────────────────────────────────
  registerTool(
    "search_setups",
    "Search the Dopl knowledge base for AI/automation setups. Returns ranked results with summaries. Use this for ANY user request that's AI/automation-shaped — 'how would I build X', 'find me patterns for Y', 'what's a good way to Z' — before synthesizing from scratch. Formatting recommendations / picking the best hit is YOUR job now (server no longer runs Claude synthesis); weigh similarity, read the summaries, and compose in your own context. For scoped search inside one cluster, use `query_cluster` instead.",
    {
      query: z.string().describe("Natural language search query, e.g. 'AI agent for job applications' or 'n8n automation with Supabase'"),
      tags: z.array(z.string()).optional().describe("Filter by tags, e.g. ['claude', 'playwright']"),
      use_case: z.string().optional().describe("Filter by use case category"),
      max_results: z.number().optional().describe("Number of results to return (default 5)"),
    },
    async (params) => {
      const result = await client.searchSetups(params);

      const lines: string[] = [];
      lines.push(`## Results (${result.entries.length} found)\n`);
      for (const entry of result.entries) {
        const title = entry.title || "Untitled";
        const url = client.entryUrl(entry.slug);
        const heading = url ? `[${title}](${url})` : title;
        const tierBadge =
          entry.ingestion_tier === "skeleton" ? " _(skeleton)_" : "";
        lines.push(`### ${heading} (${Math.round(entry.similarity * 100)}% match)${tierBadge}`);
        if (entry.summary) lines.push(entry.summary);
        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── get_setup ──────────────────────────────────────────────────────
  registerTool(
    "get_setup",
    "Retrieve full implementation details — README, agents.md, manifest, tags — for one specific entry. Use this after `search_setups` when the user wants the complete setup for a match, or when the user references an entry by slug/URL/UUID. Also the right tool to poll an entry's status after `ingest_url` or `skeleton_ingest` — check the status field. Returns null content for entries still processing.",
    {
      entry: z.string().describe("Entry slug or UUID (from search_setups or a prior tool response)"),
    },
    async ({ entry: entryRef }) => {
      const entry = await client.getSetup(entryRef);

      const lines: string[] = [];
      const title = entry.title || "Untitled";
      const url = client.entryUrl(entry.slug);
      lines.push(`# ${url ? `[${title}](${url})` : title}`);
      if (entry.summary) lines.push(`\n${entry.summary}`);
      lines.push(`\nStatus: ${entry.status}`);
      lines.push(`Source: ${entry.source_url}`);
      lines.push(`Platform: ${entry.source_platform || "unknown"}`);
      lines.push(`Complexity: ${entry.complexity || "unknown"}`);
      lines.push(`Use case: ${entry.use_case || "unknown"}`);

      if (entry.tags && entry.tags.length > 0) {
        lines.push(`\nTags: ${entry.tags.map((t) => `${t.tag_type}:${t.tag_value}`).join(", ")}`);
      }

      // Skeleton-tier entries have no readme/agents_md/manifest — show
      // the descriptor as their body instead. Full-tier entries show the
      // normal README + agents.md + manifest sections.
      if (entry.ingestion_tier === "skeleton" && entry.descriptor) {
        lines.push("\n---\n## Descriptor (skeleton tier)\n");
        lines.push(entry.descriptor);
        lines.push(
          "\n*This is a skeleton entry. Read the source repo directly for implementation details.*"
        );
      } else {
        if (entry.readme) {
          lines.push("\n---\n## README\n");
          lines.push(entry.readme);
        }

        if (entry.agents_md) {
          lines.push("\n---\n## agents.md (AI Setup Instructions)\n");
          lines.push(entry.agents_md);
        }

        if (entry.manifest) {
          lines.push("\n---\n## Manifest\n");
          lines.push("```json");
          lines.push(JSON.stringify(entry.manifest, null, 2));
          lines.push("```");
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── build_solution ─────────────────────────────────────────────────
  registerTool(
    "build_solution",
    "Prepares a composite-solution synthesis task from the Dopl knowledge base. Returns retrieved entries + a pre-substituted synthesis prompt. YOU run the prompt in your own Claude context to produce the composite README + agents.md for the user — the server no longer runs Claude for this. Use when the user says 'design me a…', 'build me an…', 'compose a solution that…' across multiple KB patterns. For a single known entry, use `get_setup` instead.",
    {
      brief: z.string().describe("Description of what you want to build, e.g. 'An AI agent that monitors GitHub issues and auto-triages them'"),
      preferred_tools: z.array(z.string()).optional().describe("Tools you want to use, e.g. ['claude', 'n8n']"),
      excluded_tools: z.array(z.string()).optional().describe("Tools to avoid"),
      max_complexity: z.string().optional().describe("Maximum complexity: simple, moderate, complex, or advanced"),
    },
    async (params) => {
      const result = await client.buildSolution(params);

      const lines: string[] = [];

      if (result.status === "no_matches") {
        lines.push("## No matches found");
        lines.push("");
        lines.push(`No entries in the KB matched the brief: _${result.brief}_.`);
        lines.push("");
        lines.push(result.instructions);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }

      lines.push("# Build Solution — Agent Task");
      lines.push("");
      lines.push(`**Brief**: ${result.brief}`);
      if (result.constraints) {
        lines.push("");
        lines.push("**Constraints**:");
        lines.push("```json");
        lines.push(JSON.stringify(result.constraints, null, 2));
        lines.push("```");
      }
      lines.push("");
      lines.push(`## Retrieved candidates (${result.entries.length})`);
      lines.push("");
      for (const e of result.entries) {
        const url = client.entryUrl(e.slug);
        const label = url ? `[${e.title ?? "Untitled"}](${url})` : (e.title ?? "Untitled");
        lines.push(`- **${label}** — ${Math.round(e.similarity * 100)}% match`);
      }
      lines.push("");
      lines.push("## Instructions");
      lines.push("");
      lines.push(result.instructions);
      lines.push("");
      lines.push("## Prompt — run this in your own context");
      lines.push("");
      lines.push("```");
      lines.push(result.prompt);
      lines.push("```");

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── list_setups ────────────────────────────────────────────────────
  registerTool(
    "list_setups",
    "Paginated browse of all entries in the knowledge base, with optional filters (use_case, complexity). Use this for open-ended exploration when the user says 'what's in here?' or 'show me what you have for X complexity' — NOT for targeted retrieval. For anything keyword-shaped or task-shaped, use `search_setups` instead; semantic ranking always beats a flat list.",
    {
      use_case: z.string().optional().describe("Filter by use case category"),
      complexity: z.string().optional().describe("Filter by complexity: simple, moderate, complex, advanced"),
      limit: z.number().optional().describe("Number of results (default 20)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
    async (params) => {
      const result = await client.listSetups({
        ...params,
        limit: params.limit ?? 20,
      });

      const lines: string[] = [];
      lines.push(`## Setups (${result.total} total, showing ${result.entries.length})\n`);

      for (const entry of result.entries) {
        const title = entry.title || "Untitled";
        const url = client.entryUrl(entry.slug);
        const label = url ? `[${title}](${url})` : title;
        lines.push(`- **${label}** [${entry.complexity || "?"}] — ${entry.summary || "No summary"}`);
        lines.push(`  Source: ${entry.source_url}`);
      }

      if (result.total > result.offset + result.entries.length) {
        lines.push(`\n_Use offset=${result.offset + result.entries.length} to see more._`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── list_clusters ──────────────────────────────────────────────────
  registerTool(
    "list_clusters",
    "List all clusters (curated groupings of setups) in the knowledge base. Call this when you need to discover what clusters exist — to show the user their workspace, pick a cluster before scoping a search or update, or when another tool expects a cluster slug you don't already know. Cheap metadata call; run it proactively rather than asking the user for a slug.",
    {},
    async () => {
      const { clusters } = await client.listClusters();
      const lines = clusters.map(
        (c) =>
          `- **${c.name}** (slug: \`${c.slug}\`) — ${c.panel_count ?? 0} entries`
      );
      return {
        content: [
          {
            type: "text" as const,
            text: lines.join("\n") || "No clusters found.",
          },
        ],
      };
    }
  );

  // ── get_cluster ────────────────────────────────────────────────────
  registerTool(
    "get_cluster",
    "Retrieve a cluster's metadata plus its member entries (summaries + truncated READMEs). Use this when the user wants to see what's in a cluster, or when you need the member list before operating on the cluster. If you don't have a slug yet, call `list_clusters` first. For searching inside a cluster's entries, use `query_cluster`.",
    {
      slug: z.string().describe("Cluster slug from list_clusters"),
    },
    async ({ slug }) => {
      const cluster = await client.getCluster(slug);

      const lines: string[] = [];
      lines.push(`# Cluster: ${cluster.name}`);
      lines.push(`Slug: \`${cluster.slug}\``);
      lines.push(`Entries: ${cluster.entries.length}\n`);

      for (const e of cluster.entries) {
        const title = e.title || "Untitled";
        const url = client.entryUrl(e.slug);
        const heading = url ? `[${title}](${url})` : title;
        lines.push(`### ${heading}`);
        if (e.summary) lines.push(e.summary);
        if (e.readme) {
          lines.push(`\nREADME:\n${e.readme.slice(0, CONTEXT_CHAR_BUDGET)}`);
        }
        if (e.agents_md) {
          lines.push(
            `\nagents.md:\n${e.agents_md.slice(0, CONTEXT_CHAR_BUDGET)}`
          );
        }
        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── query_cluster ──────────────────────────────────────────────────
  registerTool(
    "query_cluster",
    "Semantic search scoped to the entries inside one specific cluster. Use this when a cluster is already the focus of the conversation and the user wants to find something within it — NOT for broad discovery. For cross-KB search spanning every entry, use `search_setups` instead. If you don't have a cluster slug yet, call `list_clusters` first.",
    {
      cluster_slug: z.string().describe("Cluster slug"),
      query: z.string().describe("Natural language search query"),
      max_results: z
        .number()
        .optional()
        .describe("Max results (default 5)"),
    },
    async ({ cluster_slug, query, max_results }) => {
      const result = await client.queryCluster(
        cluster_slug,
        query,
        max_results
      );

      const lines: string[] = [];
      lines.push(
        `## Cluster Search: "${query}" in ${result.cluster_slug} (${result.results.length} results)\n`
      );

      for (const r of result.results) {
        const title = r.title || "Untitled";
        const url = client.entryUrl(r.slug);
        const heading = url ? `[${title}](${url})` : title;
        lines.push(
          `### ${heading} (${Math.round(r.similarity * 100)}% match)`
        );
        if (r.summary) lines.push(r.summary);
        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── sync_skills ─────────────────────────────────────────────────────
  registerTool(
    "sync_skills",
    "Write Dopl cluster skill files to disk so Claude Code can invoke them as real skills. Default target is Claude Code (`~/.claude/skills/`); pass target='openclaw' for `~/.openclaw/workspace/data/dopl/`. Call this AFTER any material change to a cluster — creating it, adding/removing entries, editing the brain, saving a memory — so the on-disk skill matches the DB state. Safe to call repeatedly; skips clusters that already have an up-to-date file unless force=true.",
    {
      force: z.boolean().optional().describe("Overwrite existing skill files (default: false, skips existing)"),
      target: z.enum(["claude", "openclaw"]).optional().describe("Target platform: 'claude' (default) writes to ~/.claude/skills/, 'openclaw' writes to ~/.openclaw/workspace/data/dopl/"),
    },
    async ({ force, target }) => {
      const skillTarget = target as SkillTarget | undefined;
      const { clusters } = await client.listClusters();
      const results: string[] = [];
      const clusterSummaries: ClusterSummary[] = [];

      for (const cluster of clusters) {
        try {
          // Check if skill already exists
          if (!force && await skillExists(cluster.slug, skillTarget)) {
            results.push(`- **${cluster.name}** — skipped (already exists)`);
            // Still collect summary for global files
            const detail = await client.getCluster(cluster.slug);
            clusterSummaries.push(buildClusterSummary(cluster.slug, cluster.name, detail.entries));
            continue;
          }

          const detail = await client.getCluster(cluster.slug);

          // Client-only synthesis: the server does NOT auto-synthesize
          // missing brains anymore. If a brain is missing or empty, we
          // still write the skill file (so trigger-matching works) but
          // flag the cluster so the agent can synthesize it.
          let brain: BrainData = { instructions: "", memories: [] };
          let brainEmpty = false;
          try {
            brain = await client.getClusterBrain(cluster.slug);
            if (!brain.instructions || brain.instructions.trim().length === 0) {
              brainEmpty = true;
            }
          } catch {
            brainEmpty = true;
          }

          await writeClusterSkill(cluster.slug, cluster.name, brain, detail.entries, skillTarget);
          if (brainEmpty) {
            results.push(`- **${cluster.name}** — wrote thin-pointer skill (⚠️ brain is empty — synthesize it with \`get_skill_template\` → \`update_cluster_brain("${cluster.slug}", …)\`)`);
          } else {
            results.push(`- **${cluster.name}** — wrote skill with ${detail.entries.length} entries`);
          }

          clusterSummaries.push(buildClusterSummary(cluster.slug, cluster.name, detail.entries));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push(`- **${cluster.name}** — ERROR: ${msg}`);
        }
      }

      // Write global files (always overwrite these)
      try {
        await writeGlobalCanvasSkill(clusterSummaries, skillTarget);
        const targetLabel = skillTarget === "openclaw" ? "~/.openclaw/workspace/data/dopl" : "~/.claude/skills";
        results.push(`\nGlobal canvas skill: wrote ${targetLabel}/dopl-canvas/SKILL.md`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push(`\nGlobal canvas skill: ERROR — ${msg}`);
      }

      try {
        await writeGlobalClaudemd(clusterSummaries, skillTarget);
        const indexLabel = skillTarget === "openclaw" ? "~/.openclaw/workspace/data/dopl/INDEX.md" : "~/.claude/CLAUDE.md";
        results.push(`Index: updated ${indexLabel}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push(`Global CLAUDE.md: ERROR — ${msg}`);
      }

      return {
        content: [{
          type: "text" as const,
          text: `## Skills Synced\n\n${results.join("\n")}`,
        }],
      };
    }
  );

  // ── save_cluster_memory ───────────────────────────────────────────
  registerTool(
    "save_cluster_memory",
    "Append a NEW durable preference or correction to a cluster's brain. Trigger phrases: 'I prefer X over Y', 'always use Z', 'skip that step', 'for my setup we don't use…', 'note that…'. Memories override the base instructions in future sessions. Use `update_cluster_memory` instead if a similar memory already exists (call `get_cluster_brain` first to check). Use `update_cluster_brain` for structural edits to the synthesized playbook rather than short preferences.",
    {
      slug: z.string().describe("Cluster slug"),
      memory: z.string().describe("The preference or correction to remember, e.g. 'User prefers Resend over SendGrid for email' or 'Skip the Slack notification step'"),
    },
    async ({ slug, memory }) => {
      let result: { id: string; content: string };
      try {
        result = await client.saveClusterMemory(slug, memory);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to save memory for cluster "${slug}": ${msg}`,
            },
          ],
          isError: true,
        };
      }

      // Also append to on-disk SKILL.md (non-fatal)
      let diskNote = "";
      try {
        await appendMemoryToSkill(slug, memory);
        diskNote = `\n(Also updated ~/.claude/skills/dopl-${slug}/SKILL.md)`;
      } catch (err) {
        console.error(`[Dopl] Failed to update skill file for ${slug}:`, err);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Saved memory for cluster "${slug}": "${result.content}"${diskNote}`,
          },
        ],
      };
    }
  );

  // ── list_pending_ingests ───────────────────────────────────────────
  // URLs the user pasted into the Dopl website chat that are waiting
  // for their connected agent to process. Read by the agent when the
  // `_dopl_status` footer (attached to every tool response) shows a
  // non-zero pending count. After listing, call `prepare_ingest(url)`
  // per URL — the dedup logic transparently claims the pending row.
  registerTool(
    "list_pending_ingests",
    "List the URLs the user queued from the Dopl website chat that are waiting to be ingested. Call this when the `_dopl_status` footer on a previous tool response showed `pending_ingestions > 0` and the user has agreed to process them. Returns one line per pending URL with its queue time. After listing, call `prepare_ingest(url)` for each — the dedup logic transparently claims the pending skeleton (no special parameter).",
    {},
    async () => {
      // Always bypass the cache so the list reflects the DB right now.
      client.invalidatePendingCache();
      const status = await client.getPendingStatus();

      if (status.pending_ingestions === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No pending ingestions. The user has nothing queued from the Dopl website chat.",
            },
          ],
        };
      }

      const lines: string[] = [];
      lines.push(`## Pending ingestions (${status.pending_ingestions})\n`);
      const now = Date.now();
      for (const item of status.recent) {
        const ageMs = now - new Date(item.queued_at).getTime();
        const mins = Math.max(1, Math.round(ageMs / 60_000));
        const ageLabel =
          mins < 60
            ? `${mins}m ago`
            : mins < 1440
            ? `${Math.round(mins / 60)}h ago`
            : `${Math.round(mins / 1440)}d ago`;
        lines.push(`- ${item.url} — queued ${ageLabel}`);
      }
      lines.push(
        `\nCall \`prepare_ingest(url)\` with any of these to claim and process them.`
      );

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  // ── prepare_ingest ─────────────────────────────────────────────────
  // Step 1 of the agent-driven ingest flow. Server fetches + extracts content;
  // we run the AI generation prompts locally; then call submit_ingested_entry.
  registerTool(
    "prepare_ingest",
    "Start agent-driven ingestion. The server fetches the URL + follows links (no AI on their side), and returns the raw content + the exact prompts YOU run in your own Claude context. After running the prompts (content_type classify → manifest → README → agents.md → tags, plus vision for any images), call `submit_ingested_entry` with the artifacts. Costs 1 credit total (vs 7 for the legacy `ingest_url`). Prefer this over `ingest_url` for every URL the user wants to save.\n\nThe response includes a complete `instructions` field — follow it step-by-step. If the URL was already ingested, status=\"already_exists\" is returned and you can call `get_setup` directly.",
    {
      url: z.string().describe("URL to ingest (blog post, GitHub repo, tweet, docs page, etc.)"),
      text: z.string().optional().describe("Optional pre-extracted text content (e.g. from a browser extension that already grabbed the page)."),
      links: z.array(z.string()).optional().describe("Optional additional URLs to follow and include in the gathered content."),
      images: z.array(z.string()).optional().describe("Optional base64-encoded images to analyze (max 5, each ≤ 10MB)."),
    },
    async ({ url, text, links, images }) => {
      const content: { text?: string; links?: string[]; images?: string[] } = {};
      if (text) content.text = text;
      if (links) content.links = links;
      if (images) content.images = images;

      const result = await client.prepareIngest(
        url,
        Object.keys(content).length > 0 ? content : undefined
      );

      if (result.status === "already_exists") {
        const title = result.title || "Untitled";
        const entryUrl = client.entryUrl(result.slug);
        const label = entryUrl ? `[${title}](${entryUrl})` : title;
        const ref = result.slug ?? result.entry_id;
        return {
          content: [
            {
              type: "text" as const,
              text: `Already ingested: **${label}**\n\nUse \`get_setup("${ref}")\` to view. No prepare needed.`,
            },
          ],
        };
      }

      // status === "ready" — return the full bundle as structured JSON so
      // the agent can parse it and run the prompts.
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ── submit_ingested_entry ───────────────────────────────────────────
  // Step 2 of the agent-driven ingest flow. Call this with the artifacts you
  // generated after running the prompts from `prepare_ingest`.
  registerTool(
    "submit_ingested_entry",
    "Finalize an agent-driven ingest. Submit the artifacts YOU generated after running the prompts returned by `prepare_ingest`. The server validates the shape, runs embeddings (the only AI call still on our side), persists the entries/tags/chunks rows, and marks status='complete'. Returns { entry_id, slug, title, use_case, complexity, content_type }.\n\nRequired fields come from the steps in the prepare response's `instructions`. Fields are:\n  - entry_id: from prepare response\n  - content_type: from step 1 (content_type classifier)\n  - source_type: from step 1\n  - manifest: entire JSON from step 3\n  - readme: markdown from step 4\n  - agents_md: markdown from step 5 (empty string for content_type='resource')\n  - tags: array from step 6 ({ tag_type, tag_value })\n  - image_analyses: array from step 7 (omit if no images)\n  - content_classification: JSON from step 2 (omit for non-setup/tutorial)\n\nOn success the entry is visible at `<host>/e/<slug>` and searchable by other agents.",
    {
      entry_id: z.string().uuid().describe("Entry ID from the prepare_ingest response."),
      content_type: z
        .enum([
          "setup",
          "tutorial",
          "knowledge",
          "article",
          "reference",
          "resource",
        ])
        .describe("Content type you classified in step 1."),
      source_type: z
        .string()
        .describe(
          "Source type you classified in step 1 (e.g. 'blog_post', 'github_repo', 'news_article')."
        ),
      manifest: z
        .object({
          title: z
            .string()
            .min(1)
            .describe("Descriptive title (non-empty, required)."),
          description: z.string().describe("One-paragraph description (required)."),
          use_case: z
            .object({
              primary: z
                .string()
                .min(1)
                .describe("Main category (e.g. 'agent_system', 'data_pipeline')."),
              secondary: z.array(z.string()).optional(),
            })
            .passthrough(),
          complexity: z
            .enum(["simple", "moderate", "complex", "advanced"])
            .describe("Overall complexity (required)."),
        })
        .passthrough()
        .describe("Full manifest JSON from step 3."),
      readme: z.string().min(1).describe("Markdown README from step 4."),
      agents_md: z
        .string()
        .describe(
          "Markdown agents.md (or key-insights / reference-guide) from step 5. Empty string if content_type='resource'."
        ),
      tags: z
        .array(
          z.object({
            tag_type: z.string(),
            tag_value: z.string(),
          })
        )
        .describe("Tags from step 6."),
      image_analyses: z
        .array(
          z.object({
            image_id: z.string().optional(),
            source_type: z.enum([
              "code_screenshot",
              "architecture_diagram",
              "image",
              "other",
            ]),
            raw_content: z.string(),
            extracted_content: z.string(),
            metadata: z.record(z.string(), z.unknown()).optional(),
          })
        )
        .optional()
        .describe("Per-image vision analyses from step 7. Omit if no images."),
      content_classification: z
        .object({
          sections: z
            .array(
              z
                .object({
                  title: z.string(),
                  classification: z.enum([
                    "EXECUTABLE",
                    "TACTICAL",
                    "CONTEXT",
                    "SKIP",
                  ]),
                  reason: z.string(),
                  content_preview: z.string(),
                })
                .passthrough()
            )
            .optional(),
          stats: z.record(z.string(), z.unknown()).optional(),
          preservation_notes: z.array(z.string()).optional(),
        })
        .passthrough()
        .optional()
        .describe(
          "Section classification from step 2. Only for setup/tutorial content_type."
        ),
    },
    async (input) => {
      const result = await client.submitIngestedEntry(input);
      const entryUrl = client.entryUrl(result.slug);
      const label = entryUrl
        ? `[${result.title}](${entryUrl})`
        : result.title;
      return {
        content: [
          {
            type: "text" as const,
            text: `Ingestion complete. Entry: **${label}**\n\nType: ${result.content_type}\nUse case: ${result.use_case}\nComplexity: ${result.complexity}\n\nUse \`get_setup("${result.slug}")\` to retrieve, or \`canvas_add_entry("${result.slug}")\` to pin it to the user's canvas.`,
          },
        ],
      };
    }
  );

  // ── get_ingest_content ─────────────────────────────────────────────
  // Pull extracted content for an in-progress (or completed) ingestion.
  // Called between `prepare_ingest` and `submit_ingested_entry` to
  // retrieve the body the agent substitutes into prompt
  // `{ALL_RAW_CONTENT}` / `{POST_TEXT}` placeholders.
  //
  // Why this exists: the prepare response used to inline a single fat
  // `gathered_content` string plus 10 copies of it across prompt
  // templates. That blew the MCP tool-response size cap for anything
  // larger than a trivial repo. Now prepare returns a `sources[]`
  // inventory + slim templates, and the agent calls this tool per-prompt
  // to retrieve content (optionally narrowed to a single source to save
  // tokens on steps that only need the README).
  registerTool(
    "get_ingest_content",
    "Retrieve the extracted content for an in-progress ingestion (between prepare_ingest and submit_ingested_entry). Returns the aggregated text from all successful sources, or — when `source_url` is passed — just that one source. Use this before running each prompt from the prepare_ingest response: substitute the returned `content` into the `{ALL_RAW_CONTENT}` / `{POST_TEXT}` placeholders. Pass `source_url` matching a `sources[].url` entry from the prepare response to fetch only that source (saves tokens on narrow steps like the content_type classifier that only need the README). Returns `{ content, chars, truncated }` — if `truncated` is true, the content exceeds the 500KB cap and the agent should narrow to specific sources.",
    {
      entry_id: z.string().describe("Entry UUID from the prepare_ingest response"),
      source_url: z
        .string()
        .optional()
        .describe(
          "Optional: fetch only the content for one source (must match a `sources[].url` from prepare_ingest). Omit to get all sources concatenated."
        ),
    },
    async ({ entry_id, source_url }) => {
      const result = await client.getIngestContent(entry_id, source_url);
      const suffix = result.truncated
        ? `\n\n---\n_Truncated: total ${result.chars.toLocaleString()} chars, returned first ${result.content.length.toLocaleString()}. Narrow via \`source_url\` to fetch specific sources._`
        : "";
      return {
        content: [
          {
            type: "text" as const,
            text: `${result.content}${suffix}`,
          },
        ],
      };
    }
  );

  // ── ingest_url — RETIRED ────────────────────────────────────────────
  // The legacy server-side ingestion tool has been removed. Use
  // `prepare_ingest` + `submit_ingested_entry` instead. The backend
  // POST /api/ingest returns 410 Gone for any lingering external callers.

  // ── skeleton_ingest ────────────────────────────────────────────────
  // Admin-only. Runs the lightweight descriptor-only pipeline for mass
  // indexing public GitHub repos. Backend is gated by withAdminAuth
  // (reads ADMIN_USER_ID env var) and returns 404 to non-admins. We
  // additionally avoid advertising the tool at all to non-admin MCP
  // sessions — `isAdmin` is determined at startup via the mcp-status
  // ping. Non-admin clients' `tools/list` simply will not contain it.
  if (isAdmin) {
    registerTool(
      "skeleton_ingest",
      "ADMIN ONLY. Mass-index a public GitHub repo at skeleton tier — a single Sonnet call produces a task-agnostic descriptor + one embedding, no README/agents.md/manifest. Use this when the admin hands you a list of GitHub URLs to bulk-populate the discovery index. For a regular URL ingest with full generation, use `ingest_url` instead. Poll with `get_setup` — descriptor usually lands in 10–30s.",
      {
        url: z.string().describe("Public GitHub repo URL (e.g. https://github.com/owner/repo)"),
      },
      async ({ url }) => {
        const result = await client.skeletonIngest(url);
        const entryUrl = client.entryUrl(result.slug);
        const label = entryUrl
          ? `[${result.title ?? result.slug ?? result.entry_id}](${entryUrl})`
          : result.title ?? result.slug ?? result.entry_id;
        const ref = result.slug ?? result.entry_id;

        if (result.status === "already_exists") {
          return {
            content: [{
              type: "text" as const,
              text: `Skeleton entry already exists: **${label}** (tier: ${result.tier ?? "unknown"})\nUse \`get_setup("${ref}")\` to view it.`,
            }],
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: `Skeleton ingestion started for ${url}\nEntry ID: \`${result.entry_id}\`\nStatus: ${result.status}\n\nPoll with \`get_setup("${ref}")\` — the descriptor usually lands in 10–30s.`,
          }],
        };
      }
    );
  }

  // ── update_cluster ─────────────────────────────────────────────────
  registerTool(
    "update_cluster",
    "Rename a cluster or REPLACE its entry membership with a new set of entry IDs. Use this for structural changes to an existing cluster. For adding a single entry without replacing the whole set, use `add_entry_to_cluster` — it's less destructive. Note: does not regenerate the brain; follow up with `update_cluster_brain` if the membership change implies new patterns.",
    {
      slug: z.string().describe("Cluster slug from list_clusters"),
      name: z.string().optional().describe("New cluster name"),
      entry_ids: z.array(z.string()).optional().describe("New set of entry IDs (replaces existing membership)"),
    },
    async ({ slug, name, entry_ids }) => {
      const updates: { name?: string; entry_ids?: string[] } = {};
      if (name) updates.name = name;
      if (entry_ids) updates.entry_ids = entry_ids;

      const result = await client.updateCluster(slug, updates);

      // If the slug changed (due to rename), clean up old skill dir
      if (result.slug !== slug) {
        try {
          await removeClusterSkill(slug);
        } catch (err) {
          console.error(`[Dopl] Failed to remove old skill dir for ${slug}:`, err);
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: `Updated cluster **${result.name}** (slug: \`${result.slug}\`) — ${result.panel_count ?? 0} entries.`,
        }],
      };
    }
  );

  // ── rename_cluster ─────────────────────────────────────────────────
  // Thin wrapper over `update_cluster` with a focused purpose so the
  // agent reaches for it when the user explicitly asks to rename. The
  // auto-naming route `/api/cluster/name` was deleted as part of the
  // client-only-LLM pivot — if you (the agent) want to propose a better
  // name for a cluster based on its contents, call this.
  registerTool(
    "rename_cluster",
    "Rename a cluster. Use this when the user asks to rename, or when you decide a clearer name would help (e.g. after the user has added enough entries for the theme to be obvious). Thin wrapper over `update_cluster` — the two are interchangeable, this one just reads clearer in context. Membership and brain are untouched.",
    {
      slug: z.string().describe("Cluster slug (from list_clusters)"),
      name: z.string().min(1).describe("New cluster name"),
    },
    async ({ slug, name }) => {
      const result = await client.updateCluster(slug, { name });
      return {
        content: [{
          type: "text" as const,
          text: `Renamed cluster to **${result.name}** (slug: \`${result.slug}\`).`,
        }],
      };
    }
  );

  // ── rename_chat ────────────────────────────────────────────────────
  registerTool(
    "rename_chat",
    "Rename a chat panel on the user's canvas. Use this when the user asks to rename a chat, or when the initial auto-derived title (first user message truncated) no longer captures the conversation's topic. Purpose-named wrapper over the generic panels PATCH endpoint.",
    {
      panel_id: z.string().describe("Chat panel ID (e.g. 'panel-3')"),
      title: z.string().min(1).describe("New chat title"),
    },
    async ({ panel_id, title }) => {
      await client.renameChat(panel_id, title);
      return {
        content: [{
          type: "text" as const,
          text: `Renamed chat to "${title}".`,
        }],
      };
    }
  );

  // ── delete_cluster ─────────────────────────────────────────────────
  registerTool(
    "delete_cluster",
    "Delete a cluster grouping. Individual entries REMAIN in the KB and on the user's canvas; only the cluster (and its brain + memories) is removed. Use when the user explicitly asks to drop a cluster. Irreversible — confirm intent if the user's phrasing is ambiguous.",
    {
      slug: z.string().describe("Cluster slug from list_clusters"),
    },
    async ({ slug }) => {
      await client.deleteCluster(slug);
      return {
        content: [{
          type: "text" as const,
          text: `Deleted cluster \`${slug}\`. Entries remain in the knowledge base.`,
        }],
      };
    }
  );

  // ── get_skill_template ─────────────────────────────────────────────
  registerTool(
    "get_skill_template",
    "Fetch the canonical skill synthesis prompt + expected output structure. Use this whenever you need to generate or restructure a cluster brain — e.g. right after `canvas_create_cluster` (initial synthesis), when restructuring a flat/legacy brain, or when a `update_cluster_brain` response returned a structure warning. The server does NOT run synthesis for you; paste the returned prompt into your context, feed it the entries' agents.md from `get_cluster(slug)`, produce a structured body, then call `update_cluster_brain(slug, <body>)`. No credits are charged by this tool.",
    {},
    async () => {
      const tpl = await client.getSkillTemplate();
      return {
        content: [{ type: "text" as const, text: tpl.payload }],
      };
    }
  );

  // ── get_cluster_brain ──────────────────────────────────────────────
  registerTool(
    "get_cluster_brain",
    "Read the current brain for a cluster — synthesized instructions plus numbered user memories. Call this before `update_cluster_brain` (so surgical edits preserve existing text), before `update_cluster_memory` / `delete_cluster_memory` (to get memory IDs), and any time you want to know what durable knowledge already exists for a cluster before adding more.",
    {
      slug: z.string().describe("Cluster slug from list_clusters"),
    },
    async ({ slug }) => {
      const brain = await client.getClusterBrain(slug);

      // Return the brain as a complete SKILL.md body so Claude Code can
      // treat it as the canonical skill content at invocation time —
      // no translation or assembly step on the agent's side. If the
      // instructions are already section-structured, they carry through;
      // if they're flat (legacy), they render as a plain body and the
      // consumer still gets usable content.
      const sections: string[] = [];
      sections.push(`# Skill: ${slug}`);
      sections.push("");
      sections.push(
        `> Canonical skill body for cluster \`${slug}\`, fetched from Dopl. Treat this as the full SKILL.md body — execute against it directly. If you need to modify it, call \`update_cluster_brain\` for structural changes or \`save_cluster_memory\` for short preferences.`
      );
      sections.push("");

      if (brain.instructions && brain.instructions.trim().length > 0) {
        // If the brain already has the canonical section headings, pass
        // through as-is. Otherwise wrap the flat text in an Instructions
        // section so the body still parses as a valid skill.
        if (brain.instructions.includes("## When to use") || brain.instructions.includes("## Instructions")) {
          sections.push(brain.instructions.trim());
        } else {
          sections.push("## Instructions");
          sections.push("");
          sections.push(brain.instructions.trim());
        }
        sections.push("");
      } else {
        sections.push("## Instructions");
        sections.push("");
        sections.push(
          `_This brain is empty._ Synthesize one: call \`get_skill_template\` for the canonical prompt, run synthesis in your context against \`get_cluster("${slug}")\`, then call \`update_cluster_brain("${slug}", <result>)\`.`
        );
        sections.push("");
      }

      // Memories always render as their own section so the agent can
      // distinguish durable structural guidance from user-specific
      // overrides. IDs are kept for update/delete tool targeting.
      if (brain.memories.length > 0) {
        sections.push("## User Memories");
        sections.push("");
        sections.push(
          "_Persistent user preferences and corrections. These override the base instructions above when they conflict._"
        );
        sections.push("");
        for (let i = 0; i < brain.memories.length; i++) {
          sections.push(`${i + 1}. ${brain.memories[i].content} _(id: \`${brain.memories[i].id}\`)_`);
        }
        sections.push("");
      }

      return { content: [{ type: "text" as const, text: sections.join("\n") }] };
    }
  );

  // ── delete_cluster_memory ──────────────────────────────────────────
  registerTool(
    "delete_cluster_memory",
    "Remove one specific memory from a cluster's brain by ID. Use when the user reverses a prior preference ('actually, ignore that', 'that's not true anymore') or explicitly says to drop a memory. Call `get_cluster_brain` first to get the memory ID. For REVISING an existing memory rather than deleting it, use `update_cluster_memory`.",
    {
      slug: z.string().describe("Cluster slug"),
      memory_id: z.string().describe("Memory ID to delete"),
    },
    async ({ slug, memory_id }) => {
      await client.deleteClusterMemory(slug, memory_id);
      return {
        content: [{
          type: "text" as const,
          text: `Deleted memory ${memory_id} from cluster "${slug}".`,
        }],
      };
    }
  );

  // ── update_cluster_brain ───────────────────────────────────────────
  registerTool(
    "update_cluster_brain",
    "Overwrite the cluster's brain with new instructions (the skill body Claude Code will execute against on invocation). ALWAYS call `get_cluster_brain` first and edit SURGICALLY — replace only the affected section, preserve the rest verbatim. The canonical structure has these section headings: `## When to use this skill`, `## Instructions`, `## Step-by-step`, `## Examples`, `## Anti-patterns`, `## References`. Omitting the first two triggers a structure warning in the response (non-blocking). Use this for structural/durable knowledge — for short preferences or environmental facts, use `save_cluster_memory` instead; for revising an existing memory, use `update_cluster_memory`. See the server instructions for the full when-to-edit-what decision rules.",
    {
      slug: z.string().describe("Cluster slug"),
      instructions: z
        .string()
        .describe("New brain instructions (markdown). This REPLACES the previous instructions — include everything you want kept."),
    },
    async ({ slug, instructions }) => {
      const result = await client.updateClusterBrain(slug, instructions);

      // Keep the on-disk skill file in sync with the new brain.
      let diskNote = "";
      try {
        const detail = await client.getCluster(slug);
        const brain = await client.getClusterBrain(slug);
        await writeClusterSkill(slug, detail.name, brain, detail.entries);
        diskNote = `\n(Also updated ~/.claude/skills/dopl-${slug}/SKILL.md)`;
      } catch (err) {
        console.error(`[Dopl] Failed to sync skill for ${slug}:`, err);
      }

      // Surface the backend's advisory structure check so the agent learns
      // what a proper brain looks like and self-corrects next time.
      let warningNote = "";
      if (result.structure_warning) {
        warningNote =
          `\n\n⚠️ Structure warning: brain is missing required sections: ${result.structure_warning.missing_sections.join(", ")}. ` +
          `The write succeeded, but the skill will produce weaker results at invocation time. ` +
          `Call \`get_skill_template\` for the canonical structure and consider re-synthesizing.`;
      }

      return {
        content: [{
          type: "text" as const,
          text: `Updated brain for cluster "${slug}" (${instructions.length} chars).${diskNote}${warningNote}`,
        }],
      };
    }
  );

  // ── update_cluster_memory ──────────────────────────────────────────
  registerTool(
    "update_cluster_memory",
    "Revise the text of an EXISTING memory in place. Use this when the user refines or corrects a preference you already saved — avoids accumulating near-duplicate memories. Call `get_cluster_brain` first to get memory IDs and current text. For a genuinely new preference with no existing counterpart, use `save_cluster_memory`.",
    {
      slug: z.string().describe("Cluster slug"),
      memory_id: z.string().describe("Memory ID to update"),
      content: z.string().describe("New memory content (fully replaces the prior text)"),
    },
    async ({ slug, memory_id, content }) => {
      const updated = await client.updateClusterMemory(slug, memory_id, content);
      return {
        content: [{
          type: "text" as const,
          text: `Updated memory for cluster "${slug}": "${updated.content}"`,
        }],
      };
    }
  );

  // ── update_entry ───────────────────────────────────────────────────
  registerTool(
    "update_entry",
    "Update an entry's editable metadata fields: title, summary, use_case, complexity. Use when the user wants to correct an entry's categorization or description. Does NOT edit README, agents.md, or the source URL — those are regenerated only via re-ingestion. Scoped to the entry's owner and admin callers.",
    {
      entry: z.string().describe("Entry slug or UUID"),
      title: z.string().optional().describe("New title"),
      summary: z.string().optional().describe("New summary"),
      use_case: z.string().optional().describe("New use case category"),
      complexity: z.enum(["simple", "moderate", "complex", "advanced"]).optional().describe("New complexity level"),
    },
    async ({ entry, title, summary, use_case, complexity }) => {
      const updates: { title?: string; summary?: string; use_case?: string; complexity?: string } = {};
      if (title) updates.title = title;
      if (summary) updates.summary = summary;
      if (use_case) updates.use_case = use_case;
      if (complexity) updates.complexity = complexity;

      const updated = await client.updateEntry(entry, updates);
      const t = updated.title || "Untitled";
      const url = client.entryUrl(updated.slug);
      const label = url ? `[${t}](${url})` : t;
      return {
        content: [{
          type: "text" as const,
          text: `Updated entry **${label}**.`,
        }],
      };
    }
  );

  // ── delete_entry ───────────────────────────────────────────────────
  registerTool(
    "delete_entry",
    "Permanently remove an entry from the knowledge base. Use only when the user explicitly asks to delete it. Irreversible — the chunks, tags, sources, and entry row are all dropped. Does not remove canvas panels owned by other users that reference this entry (their canvases will show a missing-entry placeholder). Ask for confirmation before calling if the user's intent is at all ambiguous.",
    {
      entry: z.string().describe("Entry slug or UUID to delete"),
    },
    async ({ entry }) => {
      await client.deleteEntry(entry);
      return {
        content: [{
          type: "text" as const,
          text: `Deleted entry from the knowledge base.`,
        }],
      };
    }
  );

  // ── check_entry_updates ─────────────────────────────────────────────
  registerTool(
    "check_entry_updates",
    "Check whether ONE GitHub-sourced entry has new commits since it was ingested. Use when the user asks 'is this still current?' about a specific entry. Non-GitHub entries are skipped (returns a no-op status). For checking every entry in a cluster at once, use `check_cluster_updates` — much faster than looping.",
    {
      entry: z.string().describe("Entry slug or UUID to check"),
    },
    async ({ entry }) => {
      const result = await client.checkEntryUpdates(entry);

      // The check-updates endpoint echoes back entry_id (UUID). We fetch the
      // entry metadata so we can render a proper hyperlink via slug.
      let url: string | null = null;
      try {
        const e = await client.getSetup(result.entry_id);
        url = client.entryUrl(e.slug);
      } catch {
        // Non-fatal; fall back to plain title.
      }
      const title = result.title || "Untitled";
      const label = url ? `[${title}](${url})` : title;

      if (result.has_updates === null) {
        return {
          content: [{
            type: "text" as const,
            text: `**${label}**: ${result.reason || "Update checking not available."}`,
          }],
        };
      }

      if (result.has_updates) {
        return {
          content: [{
            type: "text" as const,
            text: `**${label}** (${result.repo}): Updates available.\nRepo last pushed ${result.days_since_push} day(s) ago. You ingested it ${result.days_since_ingestion} day(s) ago.\nConsider re-ingesting with \`ingest_url\`.`,
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: `**${label}** (${result.repo}): No updates since ingestion (${result.days_since_ingestion} day(s) ago).`,
        }],
      };
    }
  );

  // ── check_cluster_updates ──────────────────────────────────────────
  registerTool(
    "check_cluster_updates",
    "Bulk-check every GitHub-sourced entry in a cluster for upstream changes. Use this when the user asks 'has anything in my cluster changed?', 'is my stack still current?', or before running `sync_skills` so the refreshed brain reflects reality. For a single entry, use `check_entry_updates`. Non-GitHub entries are skipped.",
    {
      slug: z.string().describe("Cluster slug from list_clusters"),
    },
    async ({ slug }) => {
      const detail = await client.getCluster(slug);

      const updated: string[] = [];
      const current: string[] = [];
      const skipped: string[] = [];

      for (const entry of detail.entries) {
        const url = client.entryUrl(entry.slug);
        const mkLabel = (title: string | null) => {
          const t = title || entry.title || "Untitled";
          return url ? `[${t}](${url})` : t;
        };
        try {
          const result = await client.checkEntryUpdates(entry.entry_id);
          if (result.has_updates === true) {
            updated.push(`- **${mkLabel(result.title)}** (${result.repo}) — updated ${result.days_since_push}d ago, ingested ${result.days_since_ingestion}d ago`);
          } else if (result.has_updates === false) {
            current.push(`- ${mkLabel(result.title)}`);
          } else {
            skipped.push(`- ${mkLabel(result.title)} — ${result.reason || "not GitHub"}`);
          }
        } catch {
          skipped.push(`- ${mkLabel(null)} — check failed`);
        }
      }

      const lines: string[] = [];
      lines.push(`## Cluster: ${detail.name} — Update Check\n`);

      if (updated.length > 0) {
        lines.push(`### Updates available (${updated.length})\n`);
        lines.push(...updated);
        lines.push("");
      }
      if (current.length > 0) {
        lines.push(`### Up to date (${current.length})\n`);
        lines.push(...current);
        lines.push("");
      }
      if (skipped.length > 0) {
        lines.push(`### Skipped (${skipped.length})\n`);
        lines.push(...skipped);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── add_entry_to_cluster ───────────────────────────────────────────
  registerTool(
    "add_entry_to_cluster",
    "Add a single entry to an existing cluster when the user wants to expand a cluster's membership. The brain is NOT auto-regenerated (initial synthesis runs once at cluster creation; later edits are preserved). If the new entry introduces a pattern the brain should reflect, follow up with `update_cluster_brain` — otherwise the addition is silent. To create a brand-new cluster from canvas entries, use `canvas_create_cluster` instead.",
    {
      slug: z.string().describe("Cluster slug"),
      entry: z.string().describe("Entry slug or UUID to add to the cluster"),
    },
    async ({ slug, entry: entryRef }) => {
      // Get current cluster to build updated entry list
      const detail = await client.getCluster(slug);
      const existingIds = detail.entries.map((e) => e.entry_id);

      // Validate entry exists and resolve slug → UUID for cluster membership.
      const newEntry = await client.getSetup(entryRef);
      const newEntryId = newEntry.id;
      const title = newEntry.title || "Untitled";
      const url = client.entryUrl(newEntry.slug);
      const label = url ? `[${title}](${url})` : title;

      if (existingIds.includes(newEntryId)) {
        return {
          content: [{
            type: "text" as const,
            text: `**${label}** is already in cluster "${slug}".`,
          }],
        };
      }

      // Add entry to cluster membership.
      const updatedIds = [...existingIds, newEntryId];
      await client.updateCluster(slug, { entry_ids: updatedIds });

      // Refresh the on-disk skill file so the entry list stays in sync, but
      // leave brain.instructions ALONE — auto-synthesis after initial creation
      // risks wiping edits the user has made.
      let skillNote = "";
      try {
        const updatedDetail = await client.getCluster(slug);
        const currentBrain = await client.getClusterBrain(slug);
        await writeClusterSkill(slug, detail.name, currentBrain, updatedDetail.entries);
        skillNote = " Skill file updated with the new entry list.";
      } catch (err) {
        console.error(`[Dopl] Skill sync failed for ${slug}:`, err);
        skillNote = " (Skill file not refreshed — run `sync_skills` to fix.)";
      }

      return {
        content: [{
          type: "text" as const,
          text: `Added **${label}** to cluster "${slug}" (now ${updatedIds.length} entries). Brain unchanged — if this entry introduces new patterns you want reflected in the cluster brain, edit it with \`update_cluster_brain\`.${skillNote}`,
        }],
      };
    }
  );

  // ── canvas_list_panels ──────────────────────────────────────────────
  registerTool(
    "canvas_list_panels",
    "List every entry currently saved to the user's canvas. Use this when the user asks 'what's on my canvas?', 'show me my saved setups', or before operations that need to reason about the current workspace (e.g. deciding what belongs in a new cluster). Returns entry slugs, titles, and positions — not full content.",
    {},
    async () => {
      const panels = await client.listCanvasPanels();

      if (panels.length === 0) {
        return {
          content: [{ type: "text" as const, text: "Your canvas is empty. Use `canvas_add_entry` to add entries, or `search_setups` to find them first." }],
        };
      }

      const lines: string[] = [];
      lines.push(`## Your Canvas (${panels.length} entries)\n`);

      for (const p of panels) {
        const title = p.title || "Untitled";
        const url = client.entryUrl(p.slug);
        const label = url ? `[${title}](${url})` : title;
        lines.push(`- **${label}**`);
        if (p.summary) lines.push(`  ${p.summary}`);
        if (p.source_url) lines.push(`  Source: ${p.source_url}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── canvas_add_entry ──────────────────────────────────────────────
  registerTool(
    "canvas_add_entry",
    "Add ONE known knowledge-base entry to the user's canvas by slug or UUID. Use this when you already have the exact entry the user wants to save. For search + add in one step (the common case when the user says 'save some good options for X to my canvas'), use `canvas_search_and_add` instead — it's a batch operation and much faster than looping through search hits.",
    {
      entry: z.string().describe("Entry slug or UUID from search results or get_setup"),
    },
    async ({ entry }) => {
      const { panel, created } = await client.addCanvasPanel(entry);
      const verb = created ? "Added" : "Already on";
      const title = panel.title || "Untitled";
      const url = client.entryUrl(panel.slug);
      const label = url ? `[${title}](${url})` : title;
      return {
        content: [
          {
            type: "text" as const,
            text: `${verb} canvas: **${label}**`,
          },
        ],
      };
    }
  );

  // ── canvas_remove_entry ───────────────────────────────────────────
  registerTool(
    "canvas_remove_entry",
    "Take an entry off the user's canvas. The entry stays in the knowledge base — only the canvas panel is removed. Use when the user says 'clear this from my canvas', 'I don't need this anymore', or is pruning their workspace. For permanent deletion from the KB, use `delete_entry` instead (destructive, different scope).",
    {
      entry: z.string().describe("Entry slug or UUID to remove from canvas"),
    },
    async ({ entry }) => {
      await client.removeCanvasPanel(entry);
      return {
        content: [
          {
            type: "text" as const,
            text: `Removed entry from your canvas.`,
          },
        ],
      };
    }
  );

  // ── canvas_search_and_add ──────────────────────────────────────────
  registerTool(
    "canvas_search_and_add",
    "Search the KB and add the top N matches to the user's canvas in one round trip. THIS is the default for 'save some good options for X to my canvas' / 'build me a starter canvas about Y' / 'find and bookmark patterns for Z' — much faster than `search_setups` followed by N `canvas_add_entry` calls. For adding a specific known entry by slug, use `canvas_add_entry`.",
    {
      query: z.string().describe("Natural language search query, e.g. 'marketing automations' or 'n8n workflows'"),
      max_results: z.number().optional().describe("Number of results to add (default 5, max 10)"),
    },
    async ({ query, max_results }) => {
      const limit = Math.min(max_results ?? 5, 10);
      const searchResult = await client.searchSetups({
        query,
        max_results: limit,
      });

      if (searchResult.entries.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No results found for "${query}".`,
          }],
        };
      }

      const added: string[] = [];
      const skipped: string[] = [];

      for (const entry of searchResult.entries) {
        const title = entry.title || "Untitled";
        const url = client.entryUrl(entry.slug);
        const label = url ? `[${title}](${url})` : title;
        try {
          const { created } = await client.addCanvasPanel(entry.entry_id);
          if (created) {
            added.push(`- **${label}** (${Math.round(entry.similarity * 100)}% match)`);
          } else {
            skipped.push(`- ${label} (already on canvas)`);
          }
        } catch {
          skipped.push(`- ${label} (failed to add)`);
        }
      }

      const lines: string[] = [];
      if (added.length > 0) {
        lines.push(`## Added to canvas (${added.length})\n`);
        lines.push(...added);
      }
      if (skipped.length > 0) {
        lines.push(`\n## Skipped (${skipped.length})\n`);
        lines.push(...skipped);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── canvas_create_cluster ─────────────────────────────────────────
  registerTool(
    "canvas_create_cluster",
    "Create a new cluster from entries already on the user's canvas. Use when the user says 'group these into a skill', 'make a cluster for X', or when the set of canvas panels has grown to a point where clustering would help. **Creates the cluster only — brain synthesis is YOUR job now; the server does not run it.** The tool response includes the exact next-step chain (get template → synthesize → update brain → sync_skills). For adding a single entry to an existing cluster, use `add_entry_to_cluster`.",
    {
      name: z.string().min(1, "Cluster name cannot be empty").describe("Cluster name, e.g. 'AI Agent Stack'"),
      entries: z
        .array(z.string())
        .min(1, "Must provide at least one entry")
        .describe("Entry slugs or UUIDs to include (must be on your canvas)"),
    },
    async ({ name, entries }) => {
      // Validate entries exist (and resolve slug → UUID where needed) before creating cluster.
      const validationErrors: string[] = [];
      const resolvedIds: string[] = [];
      for (const ref of entries) {
        try {
          const entry = await client.getSetup(ref);
          resolvedIds.push(entry.id);
        } catch {
          validationErrors.push(ref);
        }
      }
      if (validationErrors.length > 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Entries not found: ${validationErrors.join(", ")}. Use \`search_setups\` to find valid entries.`,
          }],
        };
      }

      const result = await client.createCluster(name, resolvedIds);

      // Client-only synthesis: we no longer run the LLM server-side to
      // populate the initial brain. The agent receives explicit next-step
      // instructions and runs synthesis in its own context, then writes
      // the result back via update_cluster_brain.
      const slug = result.slug;
      const lines: string[] = [];
      lines.push(`Created cluster **${result.name}** (slug: \`${slug}\`) with ${result.panel_count ?? resolvedIds.length} entries.`);
      lines.push("");
      lines.push(`The brain is empty — synthesis is your next step. Follow this chain:`);
      lines.push("");
      lines.push(`1. Call \`get_skill_template\` to get the canonical synthesis prompt + expected output structure.`);
      lines.push(`2. Call \`get_cluster("${slug}")\` to pull the member entries' agents.md content (the raw material).`);
      lines.push(`3. Run the synthesis prompt against that content IN YOUR CONTEXT. Produce a brain body in the canonical structure (When to use / Instructions / Step-by-step / Examples / Anti-patterns / References).`);
      lines.push(`4. Call \`update_cluster_brain("${slug}", <your synthesized body>)\` to save it.`);
      lines.push(`5. Call \`sync_skills\` so the thin-pointer \`SKILL.md\` on disk reflects the new brain.`);
      lines.push("");
      lines.push(`Do not skip step 3 — a brain saved without structure will trigger a validation warning and produce a weak skill at invocation time.`);

      return {
        content: [
          {
            type: "text" as const,
            text: lines.join("\n"),
          },
        ],
      };
    }
  );

  return server;
}

/**
 * Build a ClusterSummary from entry data for use in global skill/CLAUDE.md files.
 */
function buildClusterSummary(
  slug: string,
  name: string,
  entries: Array<{ title: string | null; summary: string | null }>,
): ClusterSummary {
  const tools: string[] = [];
  const summaryParts: string[] = [];

  for (const entry of entries) {
    if (entry.title) {
      // Extract tool-like words from titles
      for (const word of entry.title.split(/[\s:—–\-|/,]+/)) {
        const clean = word.trim();
        if (clean.length > 2 && /^[A-Z]/.test(clean)) {
          tools.push(clean);
        }
      }
    }
    if (entry.summary) {
      summaryParts.push(entry.summary.split(/[.!?]/)[0] || "");
    }
  }

  const oneLiner = summaryParts.slice(0, 2).join("; ").slice(0, 120) ||
    `${entries.length} entries`;

  return {
    slug,
    name,
    oneLiner,
    tools: [...new Set(tools)].slice(0, 10),
  };
}

