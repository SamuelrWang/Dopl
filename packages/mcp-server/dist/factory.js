"use strict";
/**
 * factory.ts — ⚠ side-effect-free entry for constructing a Dopl MCP server.
 * Importable by BOTH the stdio binary (`index.ts`) and the web app's HTTP route
 * WITHOUT triggering `main()`, `process.argv` parsing, or a stdio transport.
 * Keep stdio-specific bits (arg parsing, config-file workspace resolution,
 * orphan-skill cleanup) in `index.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.packageVersion = exports.clientIdentifier = exports.buildInstructions = exports.createServer = void 0;
exports.bootServer = bootServer;
const server_js_1 = require("./server.js");
const identity_js_1 = require("./tools/identity.js");
const workspace_directory_js_1 = require("./workspace-directory.js");
const shared_room_js_1 = require("./shared-room.js");
const tool_manifest_js_1 = require("./tool-manifest.js");
var server_js_2 = require("./server.js");
Object.defineProperty(exports, "createServer", { enumerable: true, get: function () { return server_js_2.createServer; } });
Object.defineProperty(exports, "buildInstructions", { enumerable: true, get: function () { return server_js_2.buildInstructions; } });
var version_js_1 = require("./version.js");
Object.defineProperty(exports, "clientIdentifier", { enumerable: true, get: function () { return version_js_1.clientIdentifier; } });
Object.defineProperty(exports, "packageVersion", { enumerable: true, get: function () { return version_js_1.packageVersion; } });
function errText(err) {
    return err instanceof Error ? err.message : String(err);
}
/**
 * Build a fully-registered MCP server for `client`: status-ping handshake
 * (admin flag + liveness), resolve the session default workspace, register all
 * tools. Transport-agnostic — the caller attaches stdio or HTTP afterward.
 */
async function bootServer(client, opts = {}) {
    const diag = opts.onDiag ?? (() => { });
    // Status ping → admin flag + user id. ⚠ Safe default on failure: non-admin.
    let isAdmin = false;
    let userId = null;
    // ⚠ THE OPERATOR'S HANDLE RIDES THE PING (A1/S48) — no second call, which the
    // docblock above forbids. Null on a failed ping, an older deployment, or a
    // profile with nothing sluggable; the briefing then names no handle at all.
    let operatorHandle = null;
    try {
        const ping = await pingWithRetry(client, opts.pingRetries ?? 0);
        isAdmin = ping.is_admin;
        userId = ping.user_id;
        operatorHandle = ping.handle ?? null;
    }
    catch (err) {
        diag(`[dopl-mcp] status ping failed (continuing as non-admin): ${errText(err)}`);
    }
    // Caller's ACTIVE memberships in ONE call, so boot never hits the header-less
    // `resolveActiveWorkspace` path. Seeds the server's workspace cache, so no
    // re-fetch. ⚠ HTTP boots once per request — do NOT add loopbacks here.
    let directory = [];
    let directoryLoadFailed = false;
    try {
        const result = await client.listWorkspaces();
        directory = result.workspaces;
    }
    catch (err) {
        diag(`[dopl-mcp] workspace directory load failed: ${errText(err)}`);
        directory = [];
        directoryLoadFailed = true;
    }
    // 🔒 **THE CONNECTION'S CONTAINER IS THE `X-Workspace-Id` HEADER AND NOTHING
    // ELSE** (B10/B13). The sole-membership auto-target and the agent's own
    // session pin are DELETED: neither is something the caller said on this call,
    // and the sole-membership rule was a second copy of one the API already
    // applies (`with-workspace-auth.ts › resolveActiveWorkspace`) — so a
    // one-workspace caller resolves identically, one layer down, from one rule.
    // ⚠ NO HEADER ⇒ NO `X-Workspace-Id` ON THE LOOPBACK, which is what lets the
    // server answer with the caller's own container rather than this process
    // guessing at one.
    const pin = client.getWorkspaceId();
    let active = null;
    let source = null;
    if (pin) {
        active = directory.find((w) => (0, workspace_directory_js_1.matchesContainerRef)(w, pin)) ?? null;
        if (active) {
            source = "header pin";
        }
        else {
            // ⚠ Make the drop observable — an X-Workspace-Id naming no active
            // membership is otherwise invisible in logs.
            diag(`[dopl-mcp] X-Workspace-Id pin "${pin}" matched no active membership${directoryLoadFailed ? " (directory load had failed)" : ""}; ignoring it and resolving from memberships`);
        }
    }
    // 🔒 THE CONTAINER LOCK (plan §4.4 B3). A session pinned to a SHARED
    // container — one with a PEER in it — sees and addresses that container
    // ALONE: no `list_workspaces` entry for the operator's other workspaces, no
    // `workspace=` that resolves to one, no instruction table naming any.
    //
    // 🔒 ⚠ **IT ASKS THE MEMBER COUNT AND NOTHING ELSE SINCE 2026-09-17**
    // (Samuel's ruling R-15, on R-08's predicate; F-513). It used to ask
    // `containerKind(active) === "home channel"` FIRST, so a session pinned to a
    // nine-member STANDARD workspace saw the operator's ENTIRE directory — the
    // enumeration leak R-15 names. The argument that bought the lock ("a peer's
    // room must not be a directory oracle") never depended on the kind of room.
    //
    // ⚠ F-564's WARNING IS HONOURED, NOT DROPPED. It was against
    // `!isStandardWorkspace(…)`, whose NEGATIVE spelling armed a peer-shaped lock
    // on every operator's own `personal` container. The member count excludes the
    // personal shelf POSITIVELY — it has exactly one member — so nothing arms on
    // a room with nobody else in it.
    //
    // ⚠ SHARED, NOT SOLO. A one-member container is the operator's own primary
    // agent surface and is deliberately untouched, exactly as the audience ceiling
    // leaves it (`knowledge/server/service-audience.ts`). The lock exists because
    // somebody ELSE is in the room.
    //
    // 🔒 ⚠ AN ABSENT COUNT LOCKS, and the whole argument for that inversion is in
    // `shared-room.ts` rather than restated here.
    //
    // ⚠ AND IT IS A TRIPWIRE. Bash can open a second, unpinned MCP connection or
    // issue the loopback HTTP directly; neither passes through this object. The
    // fences are the container-locked credential and the server-side audience
    // ceiling. Do not describe this line as containment.
    const lockedTo = active && (0, shared_room_js_1.isSharedRoom)(active.memberCount) ? active : null;
    if (lockedTo) {
        diag(`[dopl-mcp] directory LOCKED to shared ${(0, workspace_directory_js_1.containerKind)(lockedTo)} ${lockedTo.slug} (${lockedTo.memberCount ?? "unknown"} active members)`);
    }
    // ⚠ Clear an unresolved constructor pin so loopback calls never carry a bogus
    // X-Workspace-Id.
    client.setWorkspaceId(active ? active.id : null);
    // ⚠ ONE identity for the whole session, and the TRANSPORT's user id wins —
    // it is read off the credential doing the work, not a second loopback that
    // fails independently. Three sources let two tools on ONE connection disagree
    // about who is calling.
    const caller = {
        ...identity_js_1.UNKNOWN_CALLER,
        ...opts.caller,
        userId: opts.caller?.userId ?? userId,
    };
    const toolSet = (0, tool_manifest_js_1.resolveToolSet)(opts.toolSet, (0, identity_js_1.isDesktopRun)(caller));
    const server = (0, server_js_1.createServer)(client, {
        toolSet,
        isAdmin,
        caller,
        // ⚠ Not just diagnostic — `dopl_channel` needs this id to tell a reader a
        // message is addressed to IT rather than to some other member.
        userId: caller.userId,
        directory,
        directoryLoadFailed,
        lockedTo,
        workspace: active,
        role: active?.role ?? null,
        workspaceSource: source,
        scopes: opts.scopes,
        toolProfile: opts.toolProfile,
        liveAgents: opts.liveAgents,
        posture: opts.posture,
        operatorHandle,
    });
    const activeWorkspace = active
        ? {
            id: active.id,
            name: active.name,
            slug: active.slug,
            role: active.role,
        }
        : null;
    return {
        server,
        userId: caller.userId,
        isAdmin,
        activeWorkspace,
        directoryLoadFailed,
        toolSet,
    };
}
async function pingWithRetry(client, retries) {
    const delays = [1000, 2000, 4000].slice(0, Math.max(0, retries));
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
            return await client.pingMcpStatus();
        }
        catch (err) {
            if (attempt === delays.length)
                throw err;
            await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        }
    }
    // Unreachable — the loop either returns or throws on the last attempt.
    return { is_admin: false, user_id: null, handle: null };
}
