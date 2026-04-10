# Setup Intelligence Engine

## What This Is

A knowledge base that ingests AI/automation setup posts from social media (Twitter/X, Instagram), follows all linked resources (GitHub repos, blogs, YouTube videos, other posts), and generates structured, searchable documentation. Users can then semantically search the knowledge base or compose new solutions from existing setups.

**Core loop:** Paste a URL -> auto-extract everything -> generate artifacts -> make it searchable.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + TypeScript + React 19
- **Database:** Supabase (PostgreSQL + pgvector for vector similarity search)
- **AI:** Anthropic Claude (text generation, vision analysis) + OpenAI (embeddings via text-embedding-3-small, 1536 dimensions)
- **UI:** Tailwind CSS 4 + shadcn/ui components
- **Validation:** Zod 4
- **Content extraction:** FxTwitter API (tweets), Apify (Instagram), Octokit (GitHub), Firecrawl/Jina (web pages), YouTube transcript parsing

## Project Structure

```
src/
  app/                          # Next.js App Router
    api/
      ingest/route.ts           # POST - start ingestion, returns entry ID
      ingest/[id]/stream/route.ts  # GET - SSE progress stream
      ingest/[id]/status/route.ts  # GET - poll status (legacy)
      query/route.ts            # POST - semantic search + LLM synthesis
      build/route.ts            # POST - compose solution from knowledge base
      entries/route.ts          # GET - list entries with filters
      entries/[id]/route.ts     # GET/PATCH/DELETE - single entry
      tags/route.ts             # GET - all tags with counts
      embed/route.ts            # POST - generate embedding for text
    page.tsx                    # Root redirect -> /entries
    ingest/page.tsx             # Ingestion form
    search/page.tsx             # Semantic search
    build/page.tsx              # Composite solution builder
    entries/page.tsx            # Browse entries
    entries/[id]/page.tsx       # Entry detail
  components/
    ingest/                     # IngestChat (chatbot UI), ChatMessage, ArtifactsPanel
    search/                     # SearchInput, SearchResults, SearchFilters
    builder/                    # BriefInput, BuildResults, ConstraintsPanel
    entries/                    # EntryCard, EntryDetail, EntryGrid, EntryTabs, FilterSidebar, RepoFileBrowser
    layout/                     # Header, Sidebar
    ui/                         # shadcn/ui primitives (button, card, input, etc.)
  lib/
    ai.ts                       # Claude + OpenAI client initialization
    supabase.ts                 # Supabase client (server + client-side)
    ingestion/
      pipeline.ts               # Main 12-step ingestion orchestration
      progress.ts               # SSE event emitter for live progress streaming
      embedder.ts               # Content chunking + OpenAI embedding generation
      utils.ts                  # fetchWithTimeout, retryWithBackoff, downloadImageAsBase64
      types.ts                  # IngestInput, ExtractedSource, LinkFollowResult, etc.
      extractors/
        twitter.ts              # FxTwitter API (no auth needed)
        instagram.ts            # Apify instagram-post-scraper (needs APIFY_API_KEY)
        github.ts               # Octokit REST API (needs GITHUB_TOKEN)
        youtube.ts              # YouTube transcript via page scraping
        web.ts                  # Firecrawl -> Jina -> basic fetch fallback chain
        text.ts                 # Claude text analysis
        image.ts                # Claude Vision image analysis
      generators/
        manifest.ts             # Structured JSON: tools, integrations, complexity
        readme.ts               # Human-readable deployment guide
        agents-md.ts            # AI-executable setup instructions
        tags.ts                 # Searchable taxonomy (tools, frameworks, etc.)
        content-classifier.ts   # Labels sections as EXECUTABLE/TACTICAL/CONTEXT
    prompts/                    # All LLM prompt templates
    retrieval/
      search.ts                 # Vector similarity search via pgvector
      builder.ts                # Composite solution generation
      synthesize.ts             # LLM synthesis of search results
  types/
    api.ts                      # Zod schemas for API request/response validation
    entry.ts                    # Entry, ManifestJson, ManifestTool types
    source.ts                   # Source, Chunk types
    manifest.ts                 # Manifest structure types
supabase/
  migrations/
    001_initial_schema.sql      # Core tables: entries, sources, chunks, tags, ingestion_logs
    002_add_instagram_source_type.sql  # Added instagram_post to source_type enum
```

## Database Schema

**entries** — One row per ingested post. Has: source_url, source_platform, thumbnail_url, title, summary, use_case, complexity, readme, agents_md, manifest (JSONB), raw_content (JSONB), status (pending/processing/complete/error).

**sources** — Raw content pieces tied to an entry. Each URL visited, image analyzed, or text extracted becomes a source. Has: source_type (tweet_text, image, code_screenshot, github_repo, instagram_post, etc.), raw_content, extracted_content, depth.

**chunks** — Vectorized text segments for semantic search. Content is split into ~500-word chunks with 50-word overlap. Each chunk has a 1536-dimension embedding (pgvector). HNSW index for fast cosine similarity search.

**tags** — Searchable metadata: tool, platform, language, framework, use_case, pattern, integration, custom.

**ingestion_logs** — Audit trail of each pipeline step with timing data.

**search_entries()** — PostgreSQL RPC function for vector similarity search with optional tag/use_case/complexity filters.

## Ingestion Pipeline (12 Steps)

1. Create entry record (status=processing)
2. **Auto-fetch from source** — If URL is a tweet or Instagram post and no text provided, fetch via FxTwitter/Apify
3. **Text extraction** — Claude analyzes text for tools, architecture, links
4. **Image processing** — Claude Vision analyzes each image (code screenshots, diagrams, etc.) — parallelized
5. **Link following** — Recursively follow URLs (max depth 3, max 30 links total):
   - Tweet URLs -> FxTwitter
   - Instagram URLs -> Apify
   - GitHub URLs -> Octokit (README, configs, file tree)
   - YouTube URLs -> transcript extraction
   - Other URLs -> Firecrawl/Jina/fetch
6. **Gather all content** — Concatenate sources (capped at 100K chars for Claude)
7. **Content classification** — Label sections as EXECUTABLE/TACTICAL/CONTEXT
8. **Manifest generation** — Structured JSON with tools, integrations, complexity
9. **README generation** — Human-readable deployment guide
10. **agents.md generation** — AI-executable setup instructions (preserves EXECUTABLE sections verbatim)
11. **Tag generation** — Extract searchable tags
12. **Chunk + embed** — Split into chunks, generate OpenAI embeddings, store in pgvector

Progress is streamed live to the frontend via SSE at `/api/ingest/{id}/stream`.

## Key Architecture Decisions

- **Background processing** — Ingestion runs async. The POST returns the entry ID immediately. Client connects to SSE for progress.
- **Modular extractors** — Each platform (Twitter, Instagram, GitHub, etc.) has its own extractor that returns a normalized `LinkFollowResult`. New platforms can be added by creating a new extractor and adding URL detection in `followAndStore()`.
- **Fallback chains** — Web scraping: Firecrawl -> Jina -> basic fetch. Each extractor handles its own errors gracefully.
- **Content budget** — Link following capped at 30 URLs per entry. Content truncated to 100K chars before Claude. Images capped at 20 per entry.
- **Timeouts everywhere** — All fetch calls use `fetchWithTimeout()` (15-30s). Pipeline has a 5-minute hard timeout. Apify has 120s actor timeout.
- **Retry with backoff** — External API calls retry 3x with exponential backoff on transient errors (timeouts, 5xx, 429).

## Environment Variables

**Required:**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key (client-side)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (server-side)
- `ANTHROPIC_API_KEY` — Claude API key
- `OPENAI_API_KEY` — OpenAI API key (for embeddings)

**Content extraction (need at least one web scraper):**
- `FIRECRAWL_API_KEY` — Firecrawl web scraping
- `JINA_API_KEY` — Jina web scraping (fallback)
- `GITHUB_TOKEN` — GitHub PAT for repo extraction
- `APIFY_API_KEY` — Apify for Instagram scraping

**Configurable (all have defaults):**
- `LLM_MODEL` — Default: claude-sonnet-4-20250514
- `EMBEDDING_MODEL` — Default: text-embedding-3-small
- `MAX_LINK_DEPTH` — Default: 3
- `CHUNK_SIZE` — Default: 500 (words)
- `CHUNK_OVERLAP` — Default: 50 (words)
- `MAX_CHUNKS_PER_ENTRY` — Default: 50

## API Authentication

External API consumers (MCP clients, third-party apps) authenticate with API keys:
- Keys are prefixed with `sk-sie-` and stored as SHA-256 hashes in the `api_keys` table
- Pass via `Authorization: Bearer sk-sie-...` header
- Rate limited per key (default 60 req/min)
- The web frontend's own requests (same-origin) pass through without auth

**Admin key management** (requires `ADMIN_SECRET` env var):
- `POST /api/admin/keys` — create key (returns plaintext once)
- `GET /api/admin/keys` — list keys (prefix/name/dates only)
- `DELETE /api/admin/keys/{id}` — revoke key

**Protected routes** (require API key for external access):
- `POST /api/query`, `POST /api/build`, `POST /api/ingest`, `GET /api/entries/{id}/download`

**Public routes** (no auth needed):
- `GET /api/entries`, `GET /api/entries/{id}`, `GET /api/tags`, `GET /api/github/contents`

## MCP Server

The `packages/mcp-server/` directory contains an MCP server that wraps the SIE API. Install it in Claude Code:

```json
{
  "mcpServers": {
    "setup-intelligence": {
      "command": "npx",
      "args": ["@sie/mcp-server", "--api-key", "sk-sie-xxxxx"],
      "env": { "SIE_BASE_URL": "https://your-site.vercel.app" }
    }
  }
}
```

Tools: `search_setups`, `get_setup`, `build_solution`, `list_setups`.

## Common Tasks

**Add a new social media platform extractor:**
1. Create `src/lib/ingestion/extractors/{platform}.ts` — export `extract{Platform}Content()` returning `LinkFollowResult | null`, and `is{Platform}Url()` for URL detection
2. Add the new type to `LinkFollowResult.type` union in `src/lib/ingestion/types.ts`
3. Add source type to `ExtractedSource.sourceType` union in same file
4. Add type mapping in `linkTypeToSourceType` in `src/lib/ingestion/extractors/web.ts`
5. Wire into `followAndStore()` and auto-fetch block in `src/lib/ingestion/pipeline.ts`
6. Add platform detection in `detectPlatform()` in pipeline.ts
7. Update the `source_type` CHECK constraint in Supabase (new migration)
8. Update the ingest form hint in `src/components/ingest/ingest-form.tsx`

**Add a new generator:**
1. Create prompt in `src/lib/prompts/{name}.ts`
2. Create generator in `src/lib/ingestion/generators/{name}.ts` using `callClaude()`
3. Wire into pipeline between step 7-11
4. Add progress emissions

**Modify search behavior:**
- Vector search: `src/lib/retrieval/search.ts`
- LLM synthesis of results: `src/lib/retrieval/synthesize.ts`
- Composite builder: `src/lib/retrieval/builder.ts`
- Search thresholds/limits in the respective route files
