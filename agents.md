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
      "args": ["@dopl/mcp-server", "--api-key", "sk-sie-xxxxx"],
      "env": { "SIE_BASE_URL": "https://your-site.vercel.app" }
    }
  }
}
```

Tools: `search_setups`, `get_setup`, `build_solution`, `list_setups`.

## Design System

The app uses a **liquid glass** design system ported from openclaw-cloud. The aesthetic: deep black body (`#0a0a0f`) with a mosaic SVG grid overlay, frosted translucent panels with backdrop blur, sharp-cornered navigation (`rounded-[3px]`), and meticulously tuned hairline borders (`white/10`).

### Canonical primitives (in `src/components/design/`)

Use these first when building any new page:

- **`GlassCard`** — Frosted translucent panel with three variants:
  - `default`: `backdrop-blur-[20px]` / `bg-white/[0.12]` / `border-white/[0.2]`
  - `elevated`: `backdrop-blur-[30px]` / `bg-white/[0.16]` / `border-white/[0.28]` (for modals)
  - `subtle`: `backdrop-blur-[12px]` / `bg-white/[0.08]` / `border-white/[0.12]` (for nested use)
  - All use `rounded-2xl` and have a top-edge specular highlight gradient
  - Optional `label` prop renders a `MonoLabel` at the top, with optional `accentColor` bar
- **`GlassNavbar`** — Sharp-cornered navigation bar (`rounded-[3px]`, not `rounded-full`). Fixed heights: 48px mobile, 56px desktop. Takes `leading`, `children`, `trailing` slots.
- **`GlassNavLink`** — Nav link with active/inactive states. Active: `text-white/90 font-semibold`. Inactive: `text-white/50 hover:text-white/80`.
- **`StatusDot`** — Square (`rounded-none`) 2x2 status indicator. States: `online` (emerald), `connecting` (amber pulsing), `offline` (red), `neutral` (white/40). Includes optional mono uppercase label.
- **`MonoLabel`** — The repeating label pattern: `font-mono text-[10px] uppercase tracking-wide`. Supports `tone` (default/strong/muted) and optional `accentColor` bar.
- **`GlassDivider`** — Soft gradient horizontal separator for use inside GlassCards.

### Complementary primitives

Use sparingly for hero/brand moments — the glass language is primary:

- **`Orb`** — Glowing cyan logo orb (sm/md/lg/xl, subtle/default/strong glow)
- **`GlowText`** — Heading text with accent glow halo
- **`Surface`** / **`Pill`** / **`PillBar`** — Alternative shape language (rounded-pill)
- **`BackgroundGrid`** — Blueprint-style background (alternative to `.mosaic-bg`)

### Color tokens

**openclaw palette** (exact values in `globals.css`):
- `--paper: #0d0d12` — main surface
- `--forest: #e0e0e0` — primary text
- `--grid-line: #a0a0a0` — secondary text
- `--coral: #FF8C69` — alerts/errors
- `--mint: #9EFFBF` — success
- `--gold: #F4D35E` — warnings
- `--body-bg: #0a0a0f` — body background

Applied to body via `.mosaic-bg` class (in `layout.tsx`), which renders the exact SVG grid pattern from openclaw.

### Typography

- **Display** — Space Grotesk (`var(--font-display)`) — for headings and branding
- **Body** — Geist Sans (`var(--font-geist-sans)`) — default body text
- **Mono** — JetBrains Mono (`var(--font-mono)`) — for labels, status text, code

### UI/UX Pro Max guardrails

The design system is informed by the `ui-ux-pro-max` skill. Key principles enforced:

**Accessibility & Touch (CRITICAL):**
- Touch targets ≥44×44px, 8px+ spacing
- Text contrast ≥4.5:1 (AA); large text ≥3:1
- Visible focus rings, aria-labels on icon-only buttons
- Never convey information with color alone
- Respect `prefers-reduced-motion`

**Motion (MEDIUM):**
- Micro-interactions: 150-300ms
- Complex transitions: ≤400ms
- Exit animations ~60-70% of enter duration
- Only animate `transform` and `opacity`
- `ease-out` for entering, `ease-in` for exiting

**Sharp Edges Discipline:**
- Default: `rounded-none` (especially status dots)
- Navbars, small panels: `rounded-[3px]`
- GlassCards: `rounded-2xl` (the only component with significant rounding)
- Icons: SVG only, never emoji
- Hairline borders: 1px `white/10` standard

### Reference

Visit **`/design`** for the full showcase: all primitives, variants, the exact openclaw palette, and UI/UX Pro Max guardrails documented inline.

**Backward compat:** The shadcn `ui/` components in `src/components/ui/` still work — they're aliased to the design tokens via shadcn variable names. Migrate existing pages to GlassCard incrementally.

## Canvas + Panels (Ingest Page)

The `/ingest` page is now a draggable infinite canvas where each ingestion conversation lives in its own movable panel.

**Files** (all in `src/components/canvas/`):
- `types.ts` — `Panel` discriminated union (currently only `ChatPanelData`), `CanvasState`, action types
- `canvas-store.tsx` — `CanvasProvider` (Context + reducer), `useCanvas` hook, debounced localStorage persistence (key `sie:canvas:state`), helpers `computeNewPanelPosition` / `nextPanelIdString`
- `canvas-grid-sync.tsx` — writes `--canvas-offset-x/y` CSS variables on `<body>` so the body's grid background pans with the camera
- `canvas.tsx` — pannable viewport, pointer-driven camera; renders panels inside a transformed "world" div
- `canvas-panel.tsx` — generic draggable wrapper with header drag handle + close button; routes to per-type body components
- `panels/chat-panel.tsx` — chat conversation body with its own message list + textarea
- `use-panel-ingestion.ts` — `usePanelIngestion(panel)` hook + standalone `startPanelIngestion()` function. Handles SSE lifecycle and reattachment after page reload via the server's event buffer
- `fixed-input-bar.tsx` — bottom-fixed dark glass textarea that spawns a new ChatPanel for each URL

**Coordinate system:** panels store `{ x, y }` in **world coordinates**. The canvas viewport translates the world by `camera.{x, y}` to render. New panels spawn at the camera viewport center.

**Persistence:** The full canvas state (camera, panels, messages) saves to localStorage on every dispatch (debounced 500ms). On reload, panels reappear at their world positions and any in-flight ingestion reconnects to its SSE stream — the server-side `ingestionProgress.subscribe(id)` buffer in `src/lib/ingestion/progress.ts` replays missed events so the panel catches up automatically.

**Adding a new panel type:**
1. Add the type's data interface to `src/components/canvas/types.ts` and add it to the `Panel` union
2. Add a corresponding `CREATE_*_PANEL` reducer case in `canvas-store.tsx`
3. Create `src/components/canvas/panels/<name>-panel.tsx` for the body component
4. Add a `panel.type === "<name>"` branch in `canvas-panel.tsx`'s body section

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
