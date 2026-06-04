"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIngestTools = registerIngestTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
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
function registerIngestTools(register, client, isAdmin) {
    register("dopl_ingest", DESCRIPTION, {
        op: zod_1.z
            .enum(["url", "content", "describe_link", "pending", "submit", "skeleton"])
            .describe("Operation to perform."),
        // op=url, op=describe_link, op=skeleton all use `url`.
        url: zod_1.z
            .string()
            .optional()
            .describe("op=url: URL to ingest (blog post, GitHub repo, tweet, docs page, etc.). op=describe_link: URL to describe (typically pulled from `detected_links[]` in an op=url response after local filtering). op=skeleton: public GitHub repo URL (e.g. https://github.com/owner/repo)."),
        text: zod_1.z
            .string()
            .optional()
            .describe("op=url: optional pre-extracted text content (e.g. from a browser extension that already grabbed the page)."),
        links: zod_1.z
            .array(zod_1.z.string())
            .optional()
            .describe("op=url: optional additional URLs to follow and include in the gathered content."),
        images: zod_1.z
            .array(zod_1.z.string())
            .optional()
            .describe("op=url: optional base64-encoded images to analyze (max 5, each ≤ 10MB)."),
        // op=content
        entry_id: zod_1.z
            .string()
            .optional()
            .describe("op=content: entry UUID from the op=url response. op=submit: entry ID (UUID) from the op=url response."),
        source_url: zod_1.z
            .string()
            .optional()
            .describe("op=content: optional — fetch only the content for one source (must match a `sources[].url` from op=url). Omit to get all sources concatenated."),
        // op=submit
        content_type: zod_1.z
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
        source_type: zod_1.z
            .string()
            .optional()
            .describe("op=submit: source type you classified in step 1 (e.g. 'blog_post', 'github_repo', 'news_article')."),
        manifest: zod_1.z
            .object({
            title: zod_1.z
                .string()
                .min(1)
                .describe("Descriptive title (non-empty, required)."),
            description: zod_1.z.string().describe("One-paragraph description (required)."),
            use_case: zod_1.z
                .object({
                primary: zod_1.z
                    .string()
                    .min(1)
                    .describe("Main category (e.g. 'agent_system', 'data_pipeline')."),
                secondary: zod_1.z.array(zod_1.z.string()).optional(),
            })
                .passthrough(),
            complexity: zod_1.z
                .enum(["simple", "moderate", "complex", "advanced"])
                .describe("Overall complexity (required)."),
        })
            .passthrough()
            .optional()
            .describe("op=submit: full manifest JSON from step 3."),
        readme: zod_1.z
            .string()
            .min(1)
            .optional()
            .describe("op=submit: markdown README from step 4."),
        agents_md: zod_1.z
            .string()
            .optional()
            .describe("op=submit: markdown agents.md (or key-insights / reference-guide) from step 5. Empty string if content_type='resource'."),
        tags: zod_1.z
            .array(zod_1.z.object({
            tag_type: zod_1.z.string(),
            tag_value: zod_1.z.string(),
        }))
            .optional()
            .describe("op=submit: tags from step 6."),
        image_analyses: zod_1.z
            .array(zod_1.z.object({
            image_id: zod_1.z.string().optional(),
            source_type: zod_1.z.enum([
                "code_screenshot",
                "architecture_diagram",
                "image",
                "other",
            ]),
            raw_content: zod_1.z.string(),
            extracted_content: zod_1.z.string(),
            metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
        }))
            .optional()
            .describe("op=submit: per-image vision analyses from step 7. Omit if no images."),
        content_classification: zod_1.z
            .object({
            sections: zod_1.z
                .array(zod_1.z
                .object({
                title: zod_1.z.string(),
                classification: zod_1.z.enum([
                    "EXECUTABLE",
                    "TACTICAL",
                    "CONTEXT",
                    "SKIP",
                ]),
                reason: zod_1.z.string(),
                content_preview: zod_1.z.string(),
            })
                .passthrough())
                .optional(),
            stats: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
            preservation_notes: zod_1.z.array(zod_1.z.string()).optional(),
        })
            .passthrough()
            .optional()
            .describe("op=submit: section classification from step 2. Only for setup/tutorial content_type."),
    }, async (args) => {
        switch (args.op) {
            case "url": {
                const miss = (0, respond_1.missingParams)("url", args, ["url"]);
                if (miss)
                    return miss;
                return opUrl(client, args);
            }
            case "content": {
                const miss = (0, respond_1.missingParams)("content", args, ["entry_id"]);
                if (miss)
                    return miss;
                return opContent(client, args.entry_id, args.source_url);
            }
            case "describe_link": {
                const miss = (0, respond_1.missingParams)("describe_link", args, ["url"]);
                if (miss)
                    return miss;
                return opDescribeLink(client, args.url);
            }
            case "pending":
                return opPending(client);
            case "submit": {
                const miss = (0, respond_1.missingParams)("submit", args, [
                    "entry_id",
                    "content_type",
                    "source_type",
                    "manifest",
                    "readme",
                    "agents_md",
                    "tags",
                ]);
                if (miss)
                    return miss;
                // missingParams guarantees the required submit fields are present;
                // assemble the precisely-typed payload the client expects.
                const input = {
                    entry_id: args.entry_id,
                    content_type: args.content_type,
                    source_type: args.source_type,
                    manifest: args.manifest,
                    readme: args.readme,
                    agents_md: args.agents_md,
                    tags: args.tags,
                };
                if (args.image_analyses) {
                    input.image_analyses =
                        args.image_analyses;
                }
                if (args.content_classification) {
                    input.content_classification =
                        args.content_classification;
                }
                return opSubmit(client, input);
            }
            case "skeleton": {
                if (!isAdmin)
                    return (0, respond_1.err)("skeleton_ingest is admin-only.");
                const miss = (0, respond_1.missingParams)("skeleton", args, ["url"]);
                if (miss)
                    return miss;
                return opSkeleton(client, args.url);
            }
        }
    });
}
async function opUrl(client, { url, text, links, images }) {
    const content = {};
    if (text)
        content.text = text;
    if (links)
        content.links = links;
    if (images)
        content.images = images;
    const result = await client.prepareIngest(url, Object.keys(content).length > 0 ? content : undefined);
    if (result.status === "already_exists") {
        const title = result.title || "Untitled";
        const entryUrl = client.entryUrl(result.slug);
        const label = entryUrl ? `[${title}](${entryUrl})` : title;
        const ref = result.slug ?? result.entry_id;
        return {
            content: [
                {
                    type: "text",
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
                type: "text",
                text: JSON.stringify(result, null, 2),
            },
        ],
    };
}
async function opContent(client, entry_id, source_url) {
    const result = await client.getIngestContent(entry_id, source_url);
    const suffix = result.truncated
        ? `\n\n---\n_Truncated: total ${result.chars.toLocaleString()} chars, returned first ${result.content.length.toLocaleString()}. Narrow via \`source_url\` to fetch specific sources._`
        : "";
    return {
        content: [
            {
                type: "text",
                text: `${result.content}${suffix}`,
            },
        ],
    };
}
async function opDescribeLink(client, url) {
    const result = await client.describeLink(url);
    const lines = [];
    lines.push(`**${result.title ?? url}**`);
    if (result.type !== "unknown")
        lines.push(`_Type: ${result.type}_`);
    if (result.description) {
        lines.push("");
        lines.push(result.description);
    }
    if (result.metadata && Object.keys(result.metadata).length > 0) {
        const metaBits = [];
        if (typeof result.metadata.stars === "number")
            metaBits.push(`${result.metadata.stars.toLocaleString()} ★`);
        if (typeof result.metadata.language === "string")
            metaBits.push(result.metadata.language);
        if (typeof result.metadata.license === "string")
            metaBits.push(result.metadata.license);
        if (typeof result.metadata.site_name === "string")
            metaBits.push(result.metadata.site_name);
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
        content: [{ type: "text", text: lines.join("\n") }],
    };
}
async function opPending(client) {
    // Always bypass the cache so the list reflects the DB right now.
    client.invalidatePendingCache();
    const status = await client.getPendingStatus();
    if (status.pending_ingestions === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: "No pending ingestions. The user has nothing queued from the Dopl website chat.",
                },
            ],
        };
    }
    const lines = [];
    lines.push(`## Pending ingestions (${status.pending_ingestions})\n`);
    const now = Date.now();
    for (const item of status.recent) {
        const ageMs = now - new Date(item.queued_at).getTime();
        const mins = Math.max(1, Math.round(ageMs / 60_000));
        const ageLabel = mins < 60
            ? `${mins}m ago`
            : mins < 1440
                ? `${Math.round(mins / 60)}h ago`
                : `${Math.round(mins / 1440)}d ago`;
        lines.push(`- ${item.url} — queued ${ageLabel}`);
    }
    lines.push(`\nCall \`dopl_ingest({ op: "url", url })\` with any of these to claim and process them.`);
    return {
        content: [{ type: "text", text: lines.join("\n") }],
    };
}
async function opSubmit(client, input) {
    const result = await client.submitIngestedEntry(input);
    const entryUrl = client.entryUrl(result.slug);
    const label = entryUrl
        ? `[${result.title}](${entryUrl})`
        : result.title;
    return {
        content: [
            {
                type: "text",
                text: `Ingestion complete. Entry: **${label}**\n\nType: ${result.content_type}\nUse case: ${result.use_case}\nComplexity: ${result.complexity}\n\nUse \`dopl_setups({ op: "get", entry: "${result.slug}" })\` to retrieve, or \`dopl_canvas({ op: "add_entry", entry: "${result.slug}" })\` to pin it to the user's canvas.`,
            },
        ],
    };
}
async function opSkeleton(client, url) {
    const result = await client.skeletonIngest(url);
    const entryUrl = client.entryUrl(result.slug);
    const label = entryUrl
        ? `[${result.title ?? result.slug ?? result.entry_id}](${entryUrl})`
        : result.title ?? result.slug ?? result.entry_id;
    const ref = result.slug ?? result.entry_id;
    if (result.status === "already_exists") {
        return {
            content: [{
                    type: "text",
                    text: `Skeleton entry already exists: **${label}** (tier: ${result.tier ?? "unknown"})\nUse \`dopl_setups({ op: "get", entry: "${ref}" })\` to view it.`,
                }],
        };
    }
    return {
        content: [{
                type: "text",
                text: `Skeleton ingestion started for ${url}\nEntry ID: \`${result.entry_id}\`\nStatus: ${result.status}\n\nPoll with \`dopl_setups({ op: "get", entry: "${ref}" })\` — the descriptor usually lands in 10–30s.`,
            }],
    };
}
