# M-5 / M-6 / M-10 audit findings

Captured 2026-05-04 after a deep audit of the next three shipped items from `MCP-MULTI-WORKSPACE.md`. Continues the `A-NNN` numbering from `M7-M11-AUDIT-FINDINGS.md`. Severity reflects practical exploitability or user impact, not the audit-agent's initial label — several agent-flagged "criticals" didn't survive direct verification and have been downgraded with rationale.

## Status legend
- **open** — not yet addressed
- **fixed-in-\<sha>** — resolved, commit linked
- **wontfix** — examined and consciously not changing

---

## Critical

### A-023: Private KBs are enumerable via skill picker
- Location: [src/features/skills/server/repository.ts:327-359](src/features/skills/server/repository.ts) (`knowledgeBaseSlugExists` + `listWorkspaceKnowledgeBases`)
- Severity: **critical**
- Description: Both functions use `supabaseAdmin()` (service role, bypasses RLS) and have **no visibility filter**. They return every active KB in the workspace including private ones. Two consumers leak:
  - `listWorkspaceKnowledgeBases` feeds the skill detail-page picker that lists "available KBs to reference." Non-owners see private KBs (slug + name) belonging to other users.
  - `knowledgeBaseSlugExists` feeds the chip resolver in skill bodies — agents reading a skill that references `[label](dopl://kb/private-slug)` will get `available: true` from this check, then fail at read time. Worse, the slug itself is now confirmed to exist.
- Verified directly. The RLS policies on `knowledge_bases` are correct ([migration:81-86](supabase/migrations/20260504030000_visibility_private_resources.sql)) — but they don't help when the application bypasses them with `supabaseAdmin()`.
- Status: open

### A-024: Empty workspace list triggers mass deletion of cluster skill dirs
- Location: [packages/mcp-server/src/orphan-skill-cleanup.ts:54-91](packages/mcp-server/src/orphan-skill-cleanup.ts)
- Severity: **critical** (data-loss risk)
- Description: If `client.listWorkspaces()` succeeds but returns `{ workspaces: [] }` — legitimate (user just got removed from everything), transient (API bug, race with membership migration), or pathological (auth state corruption returning empty list rather than 401) — the `validDirs` set ends up with only `"dopl"` and `"dopl-canvas"`. Every other `dopl-*` directory under `~/.claude/skills/` and `~/.openclaw/workspace/data/dopl/` that has a `.dopl-meta.json` sidecar gets `rm -rf`'d, including dirs the user genuinely owns clusters for in workspaces the API momentarily forgot.
- The error path at lines 57-65 correctly bails on a thrown error. The empty-but-successful case has no guard.
- A naive but cheap protection: refuse to proceed if `workspaces.length === 0` and there are >0 candidate `dopl-*` dirs on disk. That's a "something looks wrong, do nothing" check, not a fix for the underlying race.
- Status: open

### A-025: API key embedded as `--api-key` CLI arg leaks via `ps aux`
- Location: [packages/cli/src/commands/mcp.ts:216, 224](packages/cli/src/commands/mcp.ts) (`buildMcpConfigBlock`)
- Severity: **critical** (key exposure)
- Description: Both the `claudeCodeCli` string and the `mcpJsonShape.dopl.args` array embed the API key as a positional CLI arg: `npx @dopl/mcp-server --api-key sk-dopl-xxx`. When Claude Code launches the MCP server, the key is visible in:
  - `ps aux` / `ps -ef` for any user on the same machine for the lifetime of the MCP server (which Claude Code keeps running across sessions)
  - Any monitoring tool, container inspection, Kubernetes audit log
  - Shell history if the user pastes the `claudeCodeCli` directly
- The MCP server already supports `DOPL_API_KEY` env var ([packages/mcp-server/src/index.ts:19](packages/mcp-server/src/index.ts)). Switching to `env: { DOPL_API_KEY: input.apiKey }` instead of `args: [..., "--api-key", input.apiKey]` is one line. The `claudeCodeCli` would similarly use `-e DOPL_API_KEY=...` instead of the positional flag.
- The `--write` path saves the JSON with `mode: 0o600` ([mcp.ts:302](packages/cli/src/commands/mcp.ts)) so file permissions are fine — the issue is the runtime exposure of the spawned process args.
- Status: open

---

## High

### A-026: Workspace-scoped API keys aren't blocked from private items at the RLS boundary
- Location: [supabase/migrations/20260504030000_visibility_private_resources.sql:81-86](supabase/migrations/20260504030000_visibility_private_resources.sql)
- Severity: **high**
- Description: Per the M-10 spec: "private items reachable only via user-scoped API keys; workspace-scoped keys must NOT see private items." The RLS policy filters by `auth.uid() = created_by` for private rows. But `auth.uid()` is the user, not the API key — when a workspace-scoped key is in use by user A, `auth.uid()` is still user A, so user A's own private items are visible *through* a workspace-scoped key.
- Practical effect: a teammate who shares a workspace-scoped API key with their service account / CI script accidentally gives the script access to their *personal* private items in that workspace. Defeats the spec's "workspace-scoped keys are for service accounts; should never see anyone's private stuff" principle.
- The application layer needs to check whether the auth context is a workspace-scoped key (`api_keys.workspace_id IS NOT NULL`) and add a query filter when it is. RLS alone can't enforce this without a session-set GUC indicating the auth class.
- Status: open

### A-027: M-10 application code uses `supabaseAdmin()` which bypasses RLS, and several paths lack a manual visibility filter
- Location: multiple — see A-023 for `listWorkspaceKnowledgeBases` / `knowledgeBaseSlugExists`. Also [src/features/clusters/server/attachments.ts](src/features/clusters/server/attachments.ts) (`listAttachedKnowledgeBasesById`, `readClusterKnowledgeEntry`) per the audit agent.
- Severity: **high**
- Description: The M-10 migration adds correct RLS policies, but the application is full of `supabaseAdmin()` calls (service role, ignores RLS). Every such caller becomes the security boundary for visibility. The audit agent flagged `listAttachedKnowledgeBasesById` (lines 236-374) and `readClusterKnowledgeEntry` (lines 446-539) in attachments.ts as missing the visibility filter. Cluster member sees private KBs attached to clusters they share. I haven't directly verified those line numbers but the pattern is consistent with what I confirmed in repository.ts.
- Bigger picture: M-10's spec says "RLS policies are the boundary, not application-layer filtering." The implementation is the opposite — RLS is decorative, application code is the boundary. Either rewrite the code paths to use the user-scoped Supabase client (and lean on RLS) or audit every `supabaseAdmin()` call against `knowledge_bases` / `skills` for an explicit visibility filter.
- Status: open

### A-028: No guard against flipping public→private when resource is attached to cluster or canvas
- Location: [src/features/knowledge/server/service.ts](src/features/knowledge/server/service.ts) (`updateBase`), [src/features/skills/server/service.ts](src/features/skills/server/service.ts) (`updateSkill`)
- Severity: **high** (broken state, silent leak / orphan)
- Description: M-10's spec says "once public, public forever — no make_private path." The migration comment confirms this ([migration:17-18](supabase/migrations/20260504030000_visibility_private_resources.sql)). But that's a one-way invariant the *server* must enforce. If the server-side update accepts `visibility: "private"` on an existing public row at all (even just on first transition), it can be exploited by any client.
- More immediately: even within the spec, there's no guard against making a cluster-attached or canvas-pinned KB/skill private. If the owner flips visibility *while attached*, other cluster members would either see a broken reference or (if RLS hides the row but the junction table still points at it) a silently empty entry. The canvas-add guard handles the *forward* direction (adding a private item to a cluster); not the *backward* direction (private-ing an already-attached item).
- Verify the actual behavior: does `updateBase` reject `visibility: "private"` outright (matching "once public, public forever")? Or does it allow it but leave the canvas/cluster broken? Either is fixable but the current behavior should be documented.
- Status: open

### A-029: Cluster `readClusterKnowledgeEntry` doesn't filter by visibility
- Location: [src/features/clusters/server/attachments.ts:446-539](src/features/clusters/server/attachments.ts) (per audit agent)
- Severity: **high**
- Description: Reads a KB entry through the cluster interface without checking `knowledge_bases.visibility`. If a private KB is attached to a cluster (via the visibility-flip-after-attach path in A-028, or via a future bug), a workspace-scoped key reading the cluster gets the private KB's content. Compounds with A-026 (workspace-scoped keys not blocked from private) and A-027 (admin client bypasses RLS).
- Status: open (line numbers from agent — verify before fixing)

### A-030: `dopl mcp config --write` unconditionally overwrites the master skill, destroying user customizations
- Location: [packages/cli/src/commands/mcp.ts:319-335](packages/cli/src/commands/mcp.ts) (`installMasterSkill`)
- Severity: **high** (silent data loss)
- Description: Per spec: "subsequent runs overwrite if the bundled version is newer than what's on disk." The implementation reads the source and writes it to the target without any version check, modification-time comparison, or content diff. If the user adds notes, fixes a typo, or extends the skill at `~/.claude/skills/dopl/SKILL.md`, the next `dopl mcp config --write` silently obliterates their changes. No backup, no warning, no confirmation prompt.
- The fix is straightforward: stamp a version comment in the bundled file (e.g., `<!-- dopl-skill-version: 1 -->`), read the target's version on overwrite, and skip if equal-or-newer. Or write a `.version` sidecar.
- Status: open

### A-031: `dopl mcp config --write` is not atomic — Ctrl-C corrupts `~/.claude/mcp.json`
- Location: [packages/cli/src/commands/mcp.ts:300-302](packages/cli/src/commands/mcp.ts) (`installMcpConfig`)
- Severity: **high** (data corruption of shared config)
- Description: The write is `await writeFile(path, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 })`. SIGINT, SIGTERM, OOM, or a power loss between the open-and-truncate and the buffer flush leaves `~/.claude/mcp.json` partially written or empty. Since this file holds *all* the user's MCP server configs (Slack, Calendar, GitHub, Linear, etc.), one corruption breaks every MCP integration the user has, not just Dopl.
- Standard fix: write to `~/.claude/mcp.json.tmp` first, then `rename()` (atomic on POSIX). Add a `.bak` of the prior file in the same step.
- Status: open

---

## Medium

### A-032: Cleanup runs concurrently with skill-writer at boot
- Location: [packages/mcp-server/src/index.ts:162-174](packages/mcp-server/src/index.ts) (fire-and-forget invocation), [packages/mcp-server/src/orphan-skill-cleanup.ts](packages/mcp-server/src/orphan-skill-cleanup.ts), [packages/mcp-server/src/skill-writer.ts](packages/mcp-server/src/skill-writer.ts)
- Severity: **medium**
- Description: Cleanup is invoked as `void cleanupOrphanSkills(client).catch(...)` — fire-and-forget. The transport connects (line 163) and tools register before cleanup completes. If the agent calls `sync_skills` during the window, skill-writer's `mkdir + writeFile` race with cleanup's `rm -rf`. Possible outcomes: skill-writer's atomic `.tmp + rename` lands inside a half-deleted dir (no harm — the rename creates the file fresh); or cleanup's `rm -rf` deletes a dir skill-writer just populated.
- Real-world likelihood is low (agent rarely calls `sync_skills` in the first 200ms of a session) but bug surface is real. Either await cleanup before transport.connect(), or add a per-dir lock file.
- Status: open

### A-033: `rm` with `force: true` silently swallows EACCES errors
- Location: [packages/mcp-server/src/orphan-skill-cleanup.ts:134](packages/mcp-server/src/orphan-skill-cleanup.ts)
- Severity: **medium** (silent observability gap)
- Description: `force: true` causes `rm` to succeed (exit 0) on permission-denied errors. If a `dopl-*` dir is owned by a different user (rare but possible — `sudo` accident, container user mapping), cleanup logs nothing and the orphan dir lingers. The user can't tell why `dopl-foo/` isn't being cleaned up. The `try/catch` at lines 139-145 catches errors that DO throw, but `force: true` prevents the throw on EACCES.
- Switch to `force: false` and let the `try/catch` log the actual error, OR keep `force: true` and add an explicit `access(childPath, fs.constants.W_OK)` precheck.
- Status: open

### A-034: `rm` follows symlinks
- Location: [packages/mcp-server/src/orphan-skill-cleanup.ts:134](packages/mcp-server/src/orphan-skill-cleanup.ts)
- Severity: **medium** (low likelihood, high blast radius)
- Description: `await rm(childPath, { recursive: true, force: true })` follows symlinks. If `~/.claude/skills/dopl-evil/` is a symlink to (say) `/etc` and `/etc` happens to contain a `.dopl-meta.json` (it won't, in practice — but the assumption is unsafe), the cleanup would `rm -rf /etc`. This requires the user to plant the symlink themselves, so it's self-pwn territory rather than a remote vulnerability — but if a malicious npm package or a misbehaving sync tool ever creates one, the consequences are catastrophic and unrecoverable.
- Cheap fix: `await fs.lstat(childPath)` and skip if `isSymbolicLink()`. The expected on-disk shape is always a real directory.
- Status: open

### A-035: `--write` doesn't back up existing `~/.claude/mcp.json`
- Location: [packages/cli/src/commands/mcp.ts:268-303](packages/cli/src/commands/mcp.ts) (`installMcpConfig`)
- Severity: **medium**
- Description: Even with the atomic-write fix from A-031, a logic bug in the merge code could write a syntactically valid but semantically wrong JSON (e.g., dropping the user's other `mcpServers` entries because of a typo in the spread). No `.bak` exists for recovery. Standard practice is to copy the prior file to `~/.claude/mcp.json.bak` (overwriting the previous backup, single-level) before writing.
- Status: open

### A-036: User-scoped and workspace-scoped configs both use server name `"dopl"` — only one can be active
- Location: [packages/cli/src/commands/mcp.ts:220-229](packages/cli/src/commands/mcp.ts)
- Severity: **medium**
- Description: `dopl mcp config --write` (personal) and `dopl mcp config --write --workspace prod` both produce `mcpServers.dopl.{...}`. The second overwrites the first. A user who wants one personal connection AND one CI-bound workspace connection on the same machine cannot have both — the names collide.
- Tied to M-1 (the multi-instance / multi-workspace shape). Either rename the entry based on scope (`dopl-personal` vs `dopl-prod`), or document that the `--write` flow is one-active-config-only and require manual edits for multi-instance.
- Status: open

### A-037: No realtime subscription for visibility flips
- Location: [src/shared/ui/visibility-pill.tsx](src/shared/ui/visibility-pill.tsx) (and the lists that consume KB/skill data)
- Severity: **medium**
- Description: When an owner flips a KB or skill from public → private (the only legal transition), other workspace members keep seeing it in their sidebar / lists / search results until they refresh the page. The KB/skill realtime subscriptions (`useKnowledgeRealtime`, `useSkillsRealtime`) fire on row updates, but the consuming UIs need to either re-evaluate visibility client-side or refetch when the visibility column changes. Verify whether the realtime payload includes `visibility` and whether the client filters or just shows whatever the server sent.
- Status: open

### A-038: CLI workspace lookup matches by slug OR id with no ambiguity warning
- Location: [packages/cli/src/commands/mcp.ts:71-85](packages/cli/src/commands/mcp.ts)
- Severity: **medium** (low likelihood)
- Description: `workspaces.find(w => w.slug === input || w.id === input)` is convenient but if a workspace's slug happens to equal another workspace's UUID prefix, the user could silently target the wrong workspace. UUIDs are unlikely to collide with hand-chosen slugs, but it's a code smell — split into two explicit attempts (slug-first, id-fallback) and warn or fail when both match.
- Status: open

---

## Low

### A-039: Cleanup is fire-and-forget; tools register before it finishes
- Location: [packages/mcp-server/src/index.ts:162-174](packages/mcp-server/src/index.ts)
- Severity: **low** (UX, not correctness)
- Description: See also A-032. A consequence of the same fire-and-forget pattern: the agent sees orphan skill dirs in `~/.claude/skills/dopl-*/` for the brief window between server-ready and cleanup-finished. If the agent's first action depends on the skill list, it gets stale entries. Window is small.
- Status: open

### A-040: Master skill written without explicit file mode
- Location: [packages/cli/src/commands/mcp.ts:333](packages/cli/src/commands/mcp.ts)
- Severity: **low**
- Description: `writeFile(targetPath, body)` uses default permissions (0644 on most umasks). The skill content isn't a secret, so this isn't a real security issue — but the inconsistency with `mcp.json` (which is correctly 0600) is worth flagging.
- Status: open

### A-041: Visibility default duplicated in service ("private") and repository ("public")
- Location: [src/features/knowledge/server/service.ts:202](src/features/knowledge/server/service.ts) (`createBase` defaults to `"private"`) vs [src/features/knowledge/server/repository.ts](src/features/knowledge/server/repository.ts) (`insertBase` defaults to whatever the DB column default is, which is `"public"`)
- Severity: **low** (code smell, enabled the agent's confusion)
- Description: Service-layer creates default to private (per M-10 spec, intentional). Repository-layer inserts default to public (matches DB column default). Direct repository callers — like the workspace seeder if any path skips the service — silently get public. Currently no known callers do this, but the divergence is an architectural smell. Pick one default and enforce it at one layer.
- Status: open

### A-042: `force: true` on `rm` masks any future bugs in the cleanup logic
- Location: [packages/mcp-server/src/orphan-skill-cleanup.ts:134](packages/mcp-server/src/orphan-skill-cleanup.ts)
- Severity: **low** (related to A-033)
- Description: Same flag, different lens. `force: true` also masks ENOENT (file doesn't exist), which means a cleanup-deleted-it-mid-pass race won't surface. The next cleanup run would just succeed on the same path. Mostly fine but worth flagging alongside A-033.
- Status: open

---

## Bonus finding (worth surfacing separately)

### A-043: M-10 migration silently fixed a pre-existing RLS bug
- Location: [supabase/migrations/20260504030000_visibility_private_resources.sql:20-65](supabase/migrations/20260504030000_visibility_private_resources.sql)
- Severity: **medium** (the underlying bug, now fixed — flagging the historical exposure)
- Description: The migration's `is_workspace_member` redefinition includes a fix-up: the prior migration ([20260502130000](supabase/migrations/20260502130000_*.sql) — the editor → member rename) updated the `workspace_members.role` enum but missed the `is_workspace_member` SECURITY DEFINER function, which still hard-coded `'editor'` in its rank table. From May 2 to May 4, every RLS policy that called `is_workspace_member(_, _, 'editor')` returned false for member-role users — i.e., regular members were silently denied write access to anything RLS-protected.
- The visibility migration's comment confirms it was caught by the M-10 author. Worth a postmortem note: how did the editor → member rename pass review without anyone noticing the function broke? An audit hook on schema changes that test a representative member-role user against RLS-gated tables would have caught this.
- Status: fixed-in this migration (A-043 is the historical record, not an open task)

---

## Agent claims that didn't survive verification

- **"Path traversal via malicious workspace slug" (alleged CRITICAL in M-5).** The agent reasoned that workspace slugs are interpolated into directory names (`dopl-${wsSlug}`). True, but those interpolated names go into `validDirs` — a *whitelist* used to *protect* matching dirs from deletion. The actual deletion target comes from `readdir(root)` (line 109), which returns real filesystem entries. Filesystems don't allow `..` in directory names, so there's no path-traversal vector. Not a bug.
- **"Ambiguous slug matching causes false-positive deletes" (alleged HIGH in M-5).** The audit agent flipped this — the code is *permissive*: it adds BOTH `dopl-{cluster}` and `dopl-{ws}-{cluster}` to `validDirs` ([cleanup:99-100](packages/mcp-server/src/orphan-skill-cleanup.ts)). If either interpretation matches a live cluster, the dir is preserved. The risk is keeping an orphan dir that should have been deleted (which is a *safe* failure mode), not deleting a dir that should have been kept. Working as designed.
- **"Seed bases/skills default to public, contradicting spec" (alleged CRITICAL in M-10).** The audit agent assumed the spec wants new items default-private. The spec ([migration:10-12](supabase/migrations/20260504030000_visibility_private_resources.sql)) explicitly says "Default for the column is `'public'`, so the migration leaves all existing data untouched." New items DO default to private at the service layer ([service.ts:202](src/features/knowledge/server/service.ts), `?? "private"`). The agent confused the column default (public — for backfill) with the new-item default (private — set by service layer). Code is correct; the *seeder*, if it bypasses the service, would default to public — but I haven't found evidence that's happening in practice (see A-041 for the architectural smell that *enables* this confusion).

---

## Suggested triage order (informational)

1. **A-025** — API key in `ps aux` is the easiest user-facing security issue to fix (one-line change to use `env` instead of `args`).
2. **A-024** — Empty-workspace-list mass-deletion is the highest-blast-radius bug; one defensive check and it's gone.
3. **A-031** — Atomic write for `mcp.json` is also one cheap change (`writeFile` → `tmp + rename`) and protects against corrupting the user's other MCP integrations.
4. **A-023** + **A-027** — Plug the `supabaseAdmin()` visibility leaks. Not just one site — the whole pattern needs auditing.
5. **A-026** — The workspace-scoped-API-key vs private boundary is the spec's stated security boundary; it's not enforced today. Bigger architectural fix.
6. **A-030** — Skill versioning before users actually customize their installed skill (race the user, not the bug).
7. **A-028** + **A-029** — Visibility-flip-after-attach edge cases. Less urgent because nobody hits them yet.
8. The mediums (A-032 to A-038) and lows can roll into normal cleanup PRs.
