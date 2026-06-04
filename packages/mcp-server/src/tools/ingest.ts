/**
 * `dopl_ingest` — the agent-driven ingest pipeline + supporting reads.
 *
 * Consolidates the old `dopl_ingest(op='url')`, `dopl_ingest(op='content')`, `dopl_ingest(op='describe_link')`,
 * `dopl_ingest(op='pending')`, `dopl_ingest(op='submit')`, and (admin-only)
 * `dopl_ingest(op='skeleton')` tools. Follows the canonical pattern in `setups.ts`: one
 * `register(...)` with an `op` enum + a flat schema of all per-op params
 * (optional), a handler that switches on `op`, validates required params via
 * `missingParams`, then calls a lifted op-function. Op bodies are lifted
 * verbatim from the old handlers.
 *
 * The long, instruction-bearing descriptions of the old `dopl_ingest(op='url')` and
 * `dopl_ingest(op='submit')` tools are preserved on the op="url" / op="submit"
 * lines below — they drive the multi-step agent ingest flow and must not be
 * trimmed.
 */

import { z } from "zod";
import type { DoplClient, SubmitIngestedEntryInput } from "@dopl/client";
import { err, missingParams, type RegisterTool, type ToolResponse } from "./respond";

const DESCRIPTION = `Drive the agent-driven ingest pipeline and its supporting reads. Set \`op\` to one of:
- "url" — Ingest a URL (blog post, GitHub repo, tweet, docs page, etc.) into the user's knowledge base. **This is the canonical full-ingest entry point.** The server fetches the URL + follows links and returns the raw content + the exact prompts YOU run in your own Claude context to synthesize the entry. After running the prompts (content_type classify → manifest → README → agents.md → tags, plus vision for any images), call op="submit" with the artifacts to commit. The response includes a complete \`instructions\` field — follow it step-by-step. If the URL was already ingested, status="already_exists" is returned and you can call \`dopl_setups(op='get')\` directly.
- "content" — Retrieve the extracted content for an in-progress ingestion (between op="url" and op="submit"). Returns the aggregated text from all successful sources, or — when \`source_url\` is passed — just that one source. Use this before running each prompt from the op="url" response: substitute the returned \`content\` into the \`{ALL_RAW_CONTENT}\` / \`{POST_TEXT}\` placeholders. Pass \`source_url\` matching a \`sources[].url\` entry from the prepare response to fetch only that source (saves tokens on narrow steps like the content_type classifier that only need the README). Returns \`{ content, chars, truncated }\` — if \`truncated\` is true, the content exceeds the ~60KB per-response cap and you should switch to per-source fetches for the remaining prompts by passing \`source_url\` on each subsequent call. Per-source fetches are also the preferred pattern for large repos regardless of truncation: each prompt step only needs the content relevant to it, so you save tokens by narrowing.
- "describe_link" — Fetch the self-description metadata for a URL — the link's own authoritative one-liner (GitHub repo description, og:description on web pages, arxiv abstract, etc.) — without running a full extraction. Use this during the post-submit \`detected_links\` review flow: after filtering out noise (badges, self-refs, translations) locally, call this per surviving candidate before offering them to the user as separate-entry ingests. The returned \`description\` is the source's authoritative self-description, more reliable than guessing from surrounding README text. Bounded ~1s per URL. Returns \`{ url, type, title, description, metadata, error? }\` — when \`error\` is set, the URL couldn't be fetched (timeout, 404, etc.) and the agent should exclude it from the offer list or note it as "couldn't describe" to the user.
- "pending" — List the URLs the user queued from the Dopl website chat that are waiting to be ingested. Call this when the \`_dopl_status\` footer on a previous tool response showed \`pending_ingestions > 0\` and the user has agreed to process them. Returns one line per pending URL with its queue time. After listing, call op="url" for each — the dedup logic transparently claims the pending skeleton (no special parameter).
- "submit" — Finalize an agent-driven ingest. Submit the artifacts YOU generated after running the prompts returned by op="url". The server validates the shape, runs embeddings (the only AI call still on our side), persists the entries/tags/chunks rows, and marks status='complete'. Returns { entry_id, slug, title, use_case, complexity, content_type }.

Required fields come from the steps in the prepare response's \`instructions\`. Fields are:
  - entry_id: from prepare response
  - content_type: from step 1 (content_type classifier)
  - source_type: from step 1
  - manifest: entire JSON from step 3
  - readme: markdown from step 4
  - agents_md: markdown from step 5 (empty string for content_type='resource')
  - tags: array from step 6 ({ tag_type, tag_value })
  - image_analyses: array from step 7 (omit if no images)
  - content_classification: JSON from step 2 (omit for non-setup/tutorial)

On success the entry is visible at \`<host>/e/<slug>\` and searchable by other agents.
- "skeleton" — ADMIN ONLY. Mass-index a public GitHub repo at skeleton tier — a single Sonnet call produces a task-agnostic descriptor + one embedding, no README/agents.md/manifest. Use this when the admin hands you a list of GitHub URLs to bulk-populate the discovery index. For a regular URL ingest with full generation, use op="url" instead. Poll with \`dopl_setups(op='get')\` — descriptor usually lands in 10–30s.`;

export function registerIngestTools(
  register: RegisterTool,
  client: DoplClient,
  isAdmin: boolean,
): void {
  register(
    "dopl_ingest",
    DESCRIPTION,
    {
      op: z
        .enum(["url", "content", "describe_link", "pending", "submit", "skeleton"])
        .describe("Operation to perform."),
      // op=url, op=describe_link, op=skeleton all use `url`.
      url: z
        .string()
        .optional()
        .describe(
          "op=url: URL to ingest (blog post, GitHub repo, tweet, docs page, etc.). op=describe_link: URL to describe (typically pulled from `detected_links[]` in an op=url response after local filtering). op=skeleton: public GitHub repo URL (e.g. https://github.com/owner/repo)."
        ),
      text: z
        .string()
        .optional()
        .describe("op=url: optional pre-extracted text content (e.g. from a browser extension that already grabbed the page)."),
      links: z
        .array(z.string())
        .optional()
        .describe("op=url: optional additional URLs to follow and include in the gathered content."),
      images: z
        .array(z.string())
        .optional()
        .describe("op=url: optional base64-encoded images to analyze (max 5, each ≤ 10MB)."),
      // op=content
      entry_id: z
        .string()
        .optional()
        .describe("op=content: entry UUID from the op=url response. op=submit: entry ID (UUID) from the op=url response."),
      source_url: z
        .string()
        .optional()
        .describe(
          "op=content: optional — fetch only the content for one source (must match a `sources[].url` from op=url). Omit to get all sources concatenated."
        ),
      // op=submit
      content_type: z
        .enum([
          "setup",
          "tutorial",
          "knowledge",
          "article",
          "reference",
          "resource",
        ])
        .optional()
        .describe("op=submit: content type you classified in step 1."),
      source_type: z
        .string()
        .optional()
        .describe(
          "op=submit: source type you classified in step 1 (e.g. 'blog_post', 'github_repo', 'news_article')."
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
        .optional()
        .describe("op=submit: full manifest JSON from step 3."),
      readme: z
        .string()
        .min(1)
        .optional()
        .describe("op=submit: markdown README from step 4."),
      agents_md: z
        .string()
        .optional()
        .describe(
          "op=submit: markdown agents.md (or key-insights / reference-guide) from step 5. Empty string if content_type='resource'."
        ),
      tags: z
        .array(
          z.object({
            tag_type: z.string(),
            tag_value: z.string(),
          })
        )
        .optional()
        .describe("op=submit: tags from step 6."),
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
        .describe("op=submit: per-image vision analyses from step 7. Omit if no images."),
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
          "op=submit: section classification from step 2. Only for setup/tutorial content_type."
        ),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "url": {
          const miss = missingParams("url", args, ["url"]);
          if (miss) return miss;
          return opUrl(client, args);
        }
        case "content": {
          const miss = missingParams("content", args, ["entry_id"]);
          if (miss) return miss;
          return opContent(client, args.entry_id as string, args.source_url);
        }
        case "describe_link": {
          const miss = missingParams("describe_link", args, ["url"]);
          if (miss) return miss;
          return opDescribeLink(client, args.url as string);
        }
        case "pending":
          return opPending(client);
        case "submit": {
          const miss = missingParams("submit", args, [
            "entry_id",
            "content_type",
            "source_type",
            "manifest",
            "readme",
            "agents_md",
            "tags",
          ]);
          if (miss) return miss;
          // missingParams guarantees the required submit fields are present;
          // assemble the precisely-typed payload the client expects.
          const input: SubmitIngestedEntryInput = {
            entry_id: args.entry_id as string,
            content_type: args.content_type as SubmitIngestedEntryInput["content_type"],
            source_type: args.source_type as string,
            manifest: args.manifest as SubmitIngestedEntryInput["manifest"],
            readme: args.readme as string,
            agents_md: args.agents_md as string,
            tags: args.tags as SubmitIngestedEntryInput["tags"],
          };
          if (args.image_analyses) {
            input.image_analyses =
              args.image_analyses as SubmitIngestedEntryInput["image_analyses"];
          }
          if (args.content_classification) {
            input.content_classification =
              args.content_classification as SubmitIngestedEntryInput["content_classification"];
          }
          return opSubmit(client, input);
        }
        case "skeleton": {
          if (!isAdmin) return err("skeleton_ingest is admin-only.");
          const miss = missingParams("skeleton", args, ["url"]);
          if (miss) return miss;
          return opSkeleton(client, args.url as string);
        }
      }
    },
  );
}

async function opUrl(
  client: DoplClient,
  { url, text, links, images }: { url?: string; text?: string; links?: string[]; images?: string[] },
): Promise<ToolResponse> {
  const content: { text?: string; links?: string[]; images?: string[] } = {};
  if (text) content.text = text;
  if (links) content.links = links;
  if (images) content.images = images;

  const result = await client.prepareIngest(
    url as string,
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
          text: `Already ingested: **${label}**\n\nUse \`dopl_setups({ op: "get", entry: "${ref}" })\` to view. No prepare needed.`,
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

async function opContent(
  client: DoplClient,
  entry_id: string,
  source_url?: string,
): Promise<ToolResponse> {
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

async function opDescribeLink(client: DoplClient, url: string): Promise<ToolResponse> {
  const result = await client.describeLink(url);
  const lines: string[] = [];
  lines.push(`**${result.title ?? url}**`);
  if (result.type !== "unknown") lines.push(`_Type: ${result.type}_`);
  if (result.description) {
    lines.push("");
    lines.push(result.description);
  }
  if (result.metadata && Object.keys(result.metadata).length > 0) {
    const metaBits: string[] = [];
    if (typeof result.metadata.stars === "number") metaBits.push(`${result.metadata.stars.toLocaleString()} ★`);
    if (typeof result.metadata.language === "string") metaBits.push(result.metadata.language);
    if (typeof result.metadata.license === "string") metaBits.push(result.metadata.license);
    if (typeof result.metadata.site_name === "string") metaBits.push(result.metadata.site_name);
    if (metaBits.length > 0) {
      lines.push("");
      lines.push(`_${metaBits.join(" · ")}_`);
    }
  }
  if (result.error) {
    lines.push("");
    lines.push(`_(couldn't describe: ${result.error})_`);
  }
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}

async function opPending(client: DoplClient): Promise<ToolResponse> {
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
    `\nCall \`dopl_ingest({ op: "url", url })\` with any of these to claim and process them.`
  );

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}

async function opSubmit(
  client: DoplClient,
  input: SubmitIngestedEntryInput,
): Promise<ToolResponse> {
  const result = await client.submitIngestedEntry(input);
  const entryUrl = client.entryUrl(result.slug);
  const label = entryUrl
    ? `[${result.title}](${entryUrl})`
    : result.title;
  return {
    content: [
      {
        type: "text" as const,
        text: `Ingestion complete. Entry: **${label}**\n\nType: ${result.content_type}\nUse case: ${result.use_case}\nComplexity: ${result.complexity}\n\nUse \`dopl_setups({ op: "get", entry: "${result.slug}" })\` to retrieve, or \`dopl_canvas({ op: "add_entry", entry: "${result.slug}" })\` to pin it to the user's canvas.`,
      },
    ],
  };
}

async function opSkeleton(client: DoplClient, url: string): Promise<ToolResponse> {
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
        text: `Skeleton entry already exists: **${label}** (tier: ${result.tier ?? "unknown"})\nUse \`dopl_setups({ op: "get", entry: "${ref}" })\` to view it.`,
      }],
    };
  }

  return {
    content: [{
      type: "text" as const,
      text: `Skeleton ingestion started for ${url}\nEntry ID: \`${result.entry_id}\`\nStatus: ${result.status}\n\nPoll with \`dopl_setups({ op: "get", entry: "${ref}" })\` — the descriptor usually lands in 10–30s.`,
    }],
  };
}
