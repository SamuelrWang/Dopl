# Content Seeding Playbook for Dopl

> **Purpose:** This playbook is designed to be handed to an AI agent that will systematically discover and submit hundreds of high-quality URLs to seed the Dopl knowledge base. The agent calls `ingest_url(url)` for each URL found. The Dopl pipeline handles all extraction, classification, README generation, and embedding automatically.
>
> **Scope:** ONLY content relevant to **Claude Code** users and **general AI agent setups** that are compatible with Claude. No n8n, Make.com, Zapier, or other no-code/low-code automation platforms. Everything ingested should be something a Claude Code user would find useful.

---

## How Ingestion Works

- Call `ingest_url` with a single URL string. The system auto-fetches content from Twitter (via FxTwitter), GitHub (via Octokit), Instagram (via Apify), and web pages (Firecrawl/Jina).
- The pipeline follows links recursively (up to depth 3), so a tweet linking to a blog linking to a GitHub repo will capture all three.
- Duplicate URLs are rejected with `"already_exists"` — no harm in re-submitting.
- Processing takes 30-120 seconds per URL (async). Poll `get_setup(entry_id)` to check status.

## What Makes Good Content for Dopl

Posts that describe **replicable AI agent setups, Claude Code workflows, MCP servers, or coding-with-AI patterns**. The content must be relevant to someone who uses Claude Code as their primary AI development tool.

**INGEST:**
- MCP server implementations and integrations
- Claude Code setups, skills, CLAUDE.md patterns, hooks
- AI agent architectures (multi-agent, RAG, browser agents, coding agents)
- Claude API / Anthropic SDK usage patterns
- AI-assisted coding workflows (with Claude, Cursor, or similar)
- Developer tooling that integrates with or complements Claude
- Prompt engineering techniques for code generation
- AI-powered testing, code review, documentation generation

**DO NOT INGEST:**
- n8n workflows, Make.com scenarios, Zapier automations
- No-code/low-code automation platforms
- Pure marketing/sales automation (unless it's built with code + Claude)
- Content that has no relevance to a developer using Claude Code

---

## 1. Category Taxonomy

### Domain 1: Claude Code & MCP (Highest Priority — 35% of effort)
| # | Sub-Category | Search Keywords |
|---|-------------|----------------|
| 1 | MCP Servers | "MCP server", "Model Context Protocol", "MCP tool", "MCP integration", "MCP typescript", "MCP python" |
| 2 | MCP Server Collections & Registries | "awesome MCP", "MCP server list", "MCP registry", "MCP directory" |
| 3 | Claude Code Setups | "Claude Code setup", "Claude Code workflow", "Claude Code configuration", "claude code tips" |
| 4 | Claude Code Skills | "Claude Code skill", "claude code slash command", "custom skill claude" |
| 5 | CLAUDE.md Patterns | "CLAUDE.md", "claude md file", "claude code project config", "claude code memory" |
| 6 | Claude Code Hooks | "claude code hook", "claude code pre-commit", "claude code automation" |
| 7 | Claude Code + IDE Integration | "claude code vscode", "claude code jetbrains", "claude code terminal" |
| 8 | Claude Agent SDK | "claude agent sdk", "anthropic agent", "agent sdk claude", "agentic claude" |

### Domain 2: AI Agent Architectures (25% of effort)
| # | Sub-Category | Search Keywords |
|---|-------------|----------------|
| 9 | Multi-Agent Systems | "multi-agent", "agent orchestration", "agent swarm", "agent collaboration", "CrewAI", "AutoGen", "LangGraph multi-agent" |
| 10 | RAG Pipelines | "RAG pipeline", "RAG setup", "retrieval augmented generation", "vector database setup", "embedding pipeline", "knowledge base AI" |
| 11 | Browser Agents | "browser agent", "Playwright AI", "Browser Use", "Stagehand", "web agent", "browser automation AI" |
| 12 | Coding Agents | "coding agent", "AI code generation", "autonomous coding", "AI pair programming", "agentic coding" |
| 13 | Tool-Using Agents | "tool use AI", "function calling", "AI tool integration", "agent tools", "structured output agent" |
| 14 | Agent Frameworks & Libraries | "LangChain agent", "LangGraph", "LlamaIndex agent", "Pydantic AI", "instructor", "agent framework" |
| 15 | Voice AI Agents | "voice AI agent", "conversational AI", "real-time voice AI", "speech-to-speech", "Vapi", "LiveKit agent" |
| 16 | Autonomous Agents | "autonomous agent", "self-improving agent", "agent loop", "ReAct agent", "planning agent" |

### Domain 3: AI-Assisted Development (20% of effort)
| # | Sub-Category | Search Keywords |
|---|-------------|----------------|
| 17 | AI Coding Assistants | "Cursor setup", "Windsurf", "Copilot workflow", "Aider", "AI coding workflow", "AI IDE" |
| 18 | AI Code Review | "AI code review", "automated PR review", "AI pull request", "code review agent" |
| 19 | AI Testing | "AI test generation", "AI QA", "AI testing framework", "test generation Claude" |
| 20 | AI Documentation | "AI documentation", "auto-generated docs", "AI changelog", "AI API docs", "docstring generation" |
| 21 | Prompt Engineering for Code | "prompt engineering code", "system prompt coding", "prompt template developer", "code generation prompt" |
| 22 | AI CLI Tools | "AI CLI", "terminal AI", "shell AI", "command line AI tool", "AI terminal assistant" |
| 23 | AI Debugging | "AI debugging", "AI error fixing", "AI stack trace", "debug with AI", "AI log analysis" |
| 24 | AI Refactoring | "AI refactoring", "code migration AI", "AI codemod", "automated refactoring" |

### Domain 4: Claude API & SDK Patterns (10% of effort)
| # | Sub-Category | Search Keywords |
|---|-------------|----------------|
| 25 | Claude API Patterns | "Claude API", "Anthropic API", "claude-3", "claude sonnet", "claude opus", "claude haiku" |
| 26 | Anthropic SDK Usage | "anthropic sdk", "anthropic python", "anthropic typescript", "@anthropic-ai/sdk" |
| 27 | Structured Output | "structured output claude", "tool use claude", "function calling anthropic", "JSON mode claude" |
| 28 | Streaming & Real-Time | "claude streaming", "SSE claude", "real-time claude", "anthropic streaming" |
| 29 | Vision & Multimodal | "claude vision", "multimodal claude", "image analysis claude", "PDF claude" |
| 30 | Cost Optimization | "claude cost", "token optimization", "prompt caching anthropic", "batch API claude" |

### Domain 5: Infrastructure & Data for Agents (10% of effort)
| # | Sub-Category | Search Keywords |
|---|-------------|----------------|
| 31 | Vector Databases | "Pinecone setup", "Weaviate", "Qdrant", "ChromaDB", "pgvector setup", "vector database" |
| 32 | AI Data Extraction | "AI web scraping", "Firecrawl", "structured extraction", "AI data extraction", "web scraping claude" |
| 33 | Local LLM Setups | "Ollama setup", "llama.cpp", "vLLM", "local LLM", "self-hosted LLM" |
| 34 | AI Observability | "AI monitoring", "LLM observability", "Langfuse", "LangSmith", "prompt tracing" |
| 35 | Deployment & Hosting | "deploy AI agent", "agent hosting", "serverless AI", "AI on Vercel", "AI on Railway" |

---

## 2. Platform Search Strategies

### 2A. Twitter / X (Primary Source — Target ~50% of URLs)

**High-Value Accounts to Search (check their last 6 weeks):**

Claude & Anthropic Ecosystem:
- @AnthropicAI, @alexalbert__ (Claude, MCP, official announcements)
- @sdrzn (Claude Code, developer relations)
- @aaborochkin (Anthropic engineering)

MCP Ecosystem:
- @modelcontextprotocol (official MCP)
- Builders who post MCP servers regularly (discover via MCP search queries below)

AI Agent Builders:
- @LangChainAI (LangChain, LangGraph)
- @CrewAIInc (multi-agent)
- @jxnlco (structured extraction, instructor)
- @swyx (AI engineering)
- @skirano (AI app building)
- @mckaywrigley (AI dev workflows)
- @nickscamara_ (Firecrawl)

AI Coding Tool Makers:
- @cursor_ai (Cursor IDE)
- @aaborochkin (Aider)
- @continuedev (Continue)

**Twitter Search Queries (copy-paste these):**

Claude Code & MCP (top priority):
```
"MCP server" min_faves:20 since:2026-03-03
"claude code" setup OR workflow OR skill OR hook min_faves:20 since:2026-03-03
"CLAUDE.md" min_faves:10 since:2026-03-03
"model context protocol" min_faves:15 since:2026-03-03
"claude code" tips OR tricks min_faves:20 since:2026-03-03
"MCP" server OR tool built min_faves:20 since:2026-03-03
"claude agent sdk" min_faves:10 since:2026-03-03
"anthropic sdk" setup OR tutorial min_faves:15 since:2026-03-03
"built with claude" min_faves:30 since:2026-03-03
"claude" "agent" setup OR built OR workflow min_faves:30 since:2026-03-03
```

AI Agents (general, Claude-compatible):
```
"AI agent" setup OR built OR architecture min_faves:50 since:2026-03-03
"coding agent" min_faves:20 since:2026-03-03
langchain OR langgraph agent min_faves:50 since:2026-03-03
"browser agent" playwright OR puppeteer min_faves:30 since:2026-03-03
"RAG pipeline" OR "RAG setup" min_faves:30 since:2026-03-03
"multi-agent" setup OR architecture min_faves:30 since:2026-03-03
"tool use" agent OR claude min_faves:20 since:2026-03-03
"function calling" claude OR anthropic min_faves:20 since:2026-03-03
"voice agent" vapi OR livekit min_faves:30 since:2026-03-03
"autonomous agent" min_faves:30 since:2026-03-03
```

AI-Assisted Development:
```
"cursor" OR "windsurf" setup OR workflow OR rules min_faves:50 since:2026-03-03
"AI code review" min_faves:20 since:2026-03-03
"AI testing" generation OR framework min_faves:20 since:2026-03-03
"prompt engineering" code OR developer min_faves:30 since:2026-03-03
"AI CLI" tool min_faves:15 since:2026-03-03
"aider" setup OR workflow min_faves:20 since:2026-03-03
"AI pair programming" min_faves:20 since:2026-03-03
```

Infrastructure for Agents:
```
"vector database" setup min_faves:20 since:2026-03-03
"Firecrawl" OR "web scraping AI" min_faves:20 since:2026-03-03
"local LLM" ollama OR llama setup min_faves:30 since:2026-03-03
"LLM observability" OR "Langfuse" OR "LangSmith" min_faves:15 since:2026-03-03
```

Broad Claude-related discovery:
```
"here's how I built" claude min_faves:30 since:2026-03-03
"anthropic" agent OR tool OR setup min_faves:30 since:2026-03-03
"claude" tutorial OR guide min_faves:50 since:2026-03-03
"here's a thread" claude OR MCP min_faves:30 since:2026-03-03
```

**Hashtags to check:** #ClaudeCode #MCP #AIagents #buildinpublic #LangChain #CursorAI #AItools #RAG #anthropic

### 2B. GitHub (Target ~35% of URLs)

**Awesome Lists to Mine:**
```
awesome-mcp-servers
awesome-claude
awesome-claude-code
awesome-ai-agents
awesome-llm-apps
awesome-rag
awesome-langchain
awesome-prompt-engineering
```

**GitHub Search Queries:**

MCP & Claude (top priority):
```
"MCP server" in:readme stars:>10 pushed:>2026-03-03
"MCP" in:readme topic:mcp-server sort:stars
"claude code" in:readme stars:>5 pushed:>2026-03-03
"CLAUDE.md" in:readme stars:>5
"claude agent sdk" in:readme stars:>5
"anthropic" agent in:readme stars:>20 pushed:>2026-03-03
topic:mcp-server created:>2026-03-03 sort:stars
topic:mcp-server sort:stars
topic:claude sort:stars
topic:claude-code sort:stars
topic:anthropic sort:stars
```

AI Agents:
```
"AI agent" in:readme stars:>50 created:>2026-03-03
"coding agent" in:readme stars:>20 pushed:>2026-03-03
"browser agent" in:readme stars:>20 pushed:>2026-03-03
"RAG pipeline" in:readme stars:>20 pushed:>2026-03-03
"multi-agent" in:readme stars:>30 pushed:>2026-03-03
"voice agent" in:readme stars:>20 created:>2026-03-03
topic:ai-agent created:>2026-03-03 sort:stars
topic:llm-app created:>2026-03-03 sort:stars
topic:langchain created:>2026-03-03 sort:stars
topic:rag sort:stars
topic:browser-automation sort:stars
```

AI Dev Tools:
```
"AI code review" in:readme stars:>15 pushed:>2026-03-03
"AI testing" in:readme stars:>15 pushed:>2026-03-03
"prompt engineering" in:readme stars:>50
"AI CLI" in:readme stars:>15 pushed:>2026-03-03
"local LLM" in:readme stars:>30 pushed:>2026-03-03
topic:prompt-engineering sort:stars
```

### 2C. Blogs & Newsletters (Target ~15% of URLs)

**High-Value Blogs:**
```
docs.anthropic.com/en/docs — Claude/MCP official documentation
modelcontextprotocol.io — MCP specification and guides
simonwillison.net — AI tooling analysis (frequently covers Claude)
blog.langchain.dev — LangChain/LangGraph tutorials
www.latent.space — AI engineering deep dives
hamel.dev — LLM evaluation, fine-tuning
```

**Newsletter Aggregators (browse recent editions for Claude/agent links):**
```
TLDR AI (tldr.tech/ai)
Ben's Bites (bensbites.beehiiv.com)
The Neuron (theneurondaily.com)
```

**Google Search Queries:**
```
"claude code" setup OR tutorial OR workflow 2026
"MCP server" tutorial OR guide 2026
"claude agent" tutorial OR guide 2026
site:dev.to "claude" agent OR MCP 2026
site:medium.com "claude code" OR "MCP server" 2026
"anthropic" agent setup tutorial 2026
"how I built" "claude" agent 2026
"CLAUDE.md" guide OR tutorial 2026
"claude code" skill OR hook 2026
```

---

## 3. Parameterized Search Query Templates

Use these templates to systematically generate searches. Substitute `{keyword}` from the sub-category keywords in Section 1.

### Twitter Templates
```
T1: "{keyword}" setup OR workflow min_faves:20 since:2026-03-03
T2: "{keyword}" tutorial OR guide min_faves:30 since:2026-03-03
T3: "here's how" "{keyword}" min_faves:20 since:2026-03-03
T4: "I built" "{keyword}" min_faves:20 since:2026-03-03
T5: "claude" "{keyword}" min_faves:15 since:2026-03-03
```

### GitHub Templates
```
G1: "{keyword}" in:readme stars:>10 pushed:>2026-03-03
G2: topic:{topic-slug} created:>2026-03-03 sort:stars
G3: "{keyword}" "claude" OR "anthropic" in:readme stars:>5
G4: "awesome-{topic}" in:name
```

### Blog Templates
```
B1: site:{blog_domain} "{keyword}" 2026
B2: "claude" "{keyword}" guide OR tutorial 2026
B3: "MCP" "{keyword}" setup OR tutorial 2026
```

### Variable Lists

**Tools (Claude ecosystem):** claude, claude-code, anthropic, MCP, cursor, windsurf, aider, continue, langchain, langgraph, llamaindex, pydantic-ai, instructor, playwright, puppeteer, firecrawl, stagehand, browserbase

**Infrastructure:** supabase, pinecone, weaviate, qdrant, chromadb, pgvector, ollama, vllm, langfuse, langsmith, vercel, railway

**Integrations (MCP-relevant):** slack, github, linear, jira, notion, postgres, sqlite, filesystem, git, docker, kubernetes

---

## 4. Prioritization & Scoring

### Engagement Thresholds

| Platform | Minimum | Strong | Viral |
|----------|---------|--------|-------|
| Twitter likes | 20 | 150 | 500+ |
| Twitter retweets | 3 | 30 | 100+ |
| GitHub stars | 5 | 50 | 500+ |
| GitHub forks | 2 | 20 | 50+ |

**Note:** Thresholds are lower than general AI content because the Claude Code / MCP niche is smaller. A tweet about an MCP server with 30 likes is relatively high-signal.

**Exception:** If content is from Anthropic, a known MCP builder, or clearly describes a novel Claude Code setup, ingest it even below these thresholds.

### Recency Multipliers

| Post Age | Multiplier | Notes |
|----------|-----------|-------|
| 0-7 days | 3.0x | Hot, trending now |
| 8-14 days | 2.5x | Very recent |
| 15-21 days | 2.0x | Recent |
| 22-42 days | 1.0x | Baseline window |
| 43-90 days | 0.5x | Only if very high engagement |
| 90+ days | 0.25x | Only canonical/foundational resources |

### Quality Signals

**Positive (ingest):**
- Post includes code, commands, or config files
- Post links to a GitHub repo
- Post is specifically about Claude Code, MCP, or Claude API
- Post describes an agent architecture with implementation details
- Post includes step-by-step instructions
- Post is a thread (3+ tweets) indicating depth
- Author is from Anthropic or a known Claude ecosystem builder

**Negative (skip):**
- Content is about n8n, Make.com, Zapier, or other no-code platforms
- Primarily promotional ("Sign up for my course")
- Listicle without depth ("10 AI tools you need")
- No links and no specifics (pure opinion/hype)
- Not relevant to a developer using Claude Code
- Behind a paywall with no publicly accessible content

### Decision Framework

```
IF about Claude Code / MCP / Claude API → INGEST (almost always, even low engagement)
IF about general AI agents AND has code/repo → INGEST if engagement >= minimum
IF about general AI agents AND no code → SKIP unless engagement is strong+
IF about n8n / Make / Zapier / no-code → SKIP always
IF about non-Claude coding assistant AND no transferable patterns → SKIP
IF engagement < minimum AND not Claude-specific → SKIP
```

---

## 5. Deduplication Strategy

### URL Normalization (do this BEFORE calling ingest_url)

- Strip tracking parameters: `?utm_source=...`, `?ref=...`, `?s=...`, `?t=...`, `?si=...`
- Normalize Twitter: `twitter.com` → `x.com`
- Remove trailing slashes
- Remove `www.` prefix
- GitHub: normalize to `https://github.com/{owner}/{repo}` (strip `/tree/main`, `/blob/...` unless pointing to a specific important file)

### Content-Level Deduplication

Keep a local set of `(author, primary_tool)` tuples. If the same author posts about the same MCP server or setup multiple times, only ingest the one with the highest engagement.

### Cross-Platform Deduplication

The Dopl pipeline follows links recursively, so prefer ingesting the "root" source:
1. Tweet links to blog post → ingest the tweet (it follows the link)
2. Blog post links to GitHub repo → ingest the blog post
3. GitHub repo is standalone → ingest the repo directly
If you find the same setup on multiple platforms, ingest just one (prefer the most complete version).

### Runtime Tracking

Maintain a local tracking structure:
```json
{
  "ingested_urls": [],
  "normalized_url_set": {},
  "author_tool_combos": {},
  "failed_urls": [],
  "stats": {
    "total_found": 0,
    "total_ingested": 0,
    "total_skipped_duplicate": 0,
    "total_skipped_quality": 0,
    "total_skipped_offtopic": 0,
    "total_failed": 0,
    "by_platform": { "twitter": 0, "github": 0, "blog": 0 },
    "by_domain": { "claude_code_mcp": 0, "agent_architectures": 0, "ai_dev_tools": 0, "claude_api_sdk": 0, "infra_data": 0 }
  }
}
```

---

## 6. Execution Plan

### Priority Order

| Priority | Domain | % of Effort | Why |
|----------|--------|-------------|-----|
| 1 | Claude Code & MCP | 35% | Core product focus — MCP servers, Claude Code setups, skills, hooks |
| 2 | AI Agent Architectures | 25% | General agent patterns usable with Claude — multi-agent, RAG, browser, coding agents |
| 3 | AI-Assisted Development | 20% | Dev workflows — coding assistants, AI testing, code review, prompt engineering |
| 4 | Claude API & SDK | 10% | API usage patterns, structured output, streaming, vision |
| 5 | Infrastructure & Data | 10% | Vector DBs, data extraction, local LLMs, observability, deployment |

### Within Each Domain

1. **Twitter first** — highest volume of setup posts, fastest to search
2. **GitHub second** — highest quality repos, most structured content
3. **Blogs last** — supplement with newsletter aggregator links

### Per Session

- Target: **50-100 URLs per session** (1-2 hours of active searching)
- Rate limit: **1 `ingest_url` call per 5 seconds**
- After every 20 ingestions, poll `get_setup` for 3-5 recent entries to verify they completed successfully
- If more than 3 consecutive ingestions fail, stop and report the error pattern
- Log every URL found with its score and decision (INGEST / SKIP / DUPLICATE / OFFTOPIC)

### Session Flow

```
1. Pick a domain from the priority list
2. For each sub-category in that domain:
   a. Run Twitter searches (2-3 queries per sub-category)
   b. Run GitHub searches (1-2 queries)
   c. Check blogs if relevant
3. For each discovered URL, check: "Would a Claude Code user find this useful?"
   - If YES → score and potentially ingest
   - If NO → mark as OFFTOPIC and skip
4. Ingest URLs that pass the quality/engagement threshold
5. Log results
6. Move to next domain
7. At end of session, produce a batch summary with coverage gaps
```

### Batch Summary Format

After each session, produce:
```json
{
  "session_id": "2026-04-14-batch-01",
  "queries_executed": 45,
  "urls_discovered": 200,
  "urls_ingested": 120,
  "urls_skipped_duplicate": 25,
  "urls_skipped_quality": 20,
  "urls_skipped_offtopic": 35,
  "urls_failed": 0,
  "top_categories": [
    { "category": "mcp_servers", "count": 35 },
    { "category": "claude_code_setups", "count": 22 },
    { "category": "agent_architectures", "count": 18 }
  ],
  "coverage_gaps": [
    "Claude Code Hooks — only 2 entries found",
    "AI Observability — 0 entries found"
  ],
  "next_session_focus": "Fill coverage gaps in Claude Code Hooks and Observability"
}
```

---

## Quick Reference: Search Date Anchors

As of 2026-04-14:
- **6 weeks ago:** 2026-03-03
- **3 weeks ago:** 2026-03-24
- **2 weeks ago:** 2026-03-31
- **1 week ago:** 2026-04-07

Update these dates when executing in a future session.
