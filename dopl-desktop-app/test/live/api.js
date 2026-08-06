'use strict';

// LIVE CONTRACT HARNESS — the real wire.
//
// TWO SURFACES, because the feature has two and the seam between them is where the bugs
// were: the REST routes the desktop listener actually calls (`/api/channels/**`), and the
// MCP endpoint an AGENT actually reads through (`/api/mcp`, JSON-RPC over SSE).
//
// EVERY FAILURE CARRIES ITS STATUS AND ITS BODY. A harness that swallows a 400 is worse
// than no harness — the whole point is to see what the server really said.
//
// ── REBUILT FOR THE SESSION MODEL (F-141 rollback) ────────────────────────────────
// The summon/roster wire is GONE with named agents: there is no `POST /agents`, no
// `PATCH /agents/{id}`, and no roster to read. What replaced it is the SESSION — an agent
// session identified by its handle, addressed through the ordinary post path, and read back
// through `read_sessions`. The `/agents` route is still probed here (see `agentsRoute`)
// precisely BECAUSE it should be gone: a residue check that a retired route stays retired.

const { redact } = require('./creds');

class WireError extends Error {
  constructor(what, status, body) {
    super(`${what}: HTTP ${status} ${redact(body).slice(0, 900)}`);
    this.name = 'WireError';
    this.status = status;
    this.body = body;
  }
}

class Api {
  constructor({ baseUrl, token, workspaceId }) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.workspaceId = workspaceId;
    this.calls = 0;
  }

  headers(extra) {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'X-Workspace-Id': this.workspaceId,
      ...(extra || {}),
    };
  }

  /**
   * One REST call. NEVER throws on a non-2xx — it returns the status and the parsed body,
   * so a check can assert on a refusal as readily as on a success. `must()` is the
   * throwing wrapper, used only for harness SETUP where a failure means "no run".
   */
  async request(method, pathname, body, opts) {
    this.calls += 1;
    const res = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: this.headers(opts && opts.headers),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout((opts && opts.timeoutMs) || 30000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text, pathname, method };
  }

  async must(method, pathname, body, what, opts) {
    const res = await this.request(method, pathname, body, opts);
    if (!res.ok) throw new WireError(what || `${method} ${pathname}`, res.status, res.text);
    return res.json;
  }

  // ── the routes the desktop listener itself calls ──────────────────────────────

  whoami() {
    return this.must('GET', '/api/workspaces/me', undefined, 'GET /api/workspaces/me');
  }

  listChannels() {
    return this.request('GET', '/api/channels');
  }

  createChannel(name, topic) {
    return this.must(
      'POST',
      '/api/channels',
      { name, topic, visibility: 'private' },
      'POST /api/channels'
    );
  }

  deleteChannel(id) {
    return this.request('DELETE', `/api/channels/${id}`);
  }

  getChannel(id) {
    return this.must('GET', `/api/channels/${id}`, undefined, `GET /api/channels/${id}`);
  }

  members(channelId) {
    return this.request('GET', `/api/channels/${channelId}/members`);
  }

  addMember(channelId, userId) {
    return this.request('POST', `/api/channels/${channelId}/members`, { userId });
  }

  /**
   * THE RETIRED ROUTE, probed on purpose. F-141 removed named agents; this asks the live
   * server whether the roster endpoint went with them. A 404/410 is the PASS.
   */
  agentsRoute(channelId) {
    return this.request('GET', `/api/channels/${channelId}/agents`);
  }

  /**
   * `opts` IS LOAD-BEARING and was missing from this signature for the whole first live
   * run: check 6 passes `{ headers: { 'X-Dopl-Runtime': … } }` here, and a two-parameter
   * `post` dropped it silently. The header never left the harness, the server correctly
   * stamped nothing, and the check reported a product defect that did not exist. A
   * forwarded-options parameter that is quietly discarded produces exactly this — a
   * confident failure about somebody else's code.
   */
  post(channelId, payload, opts) {
    return this.request('POST', `/api/channels/${channelId}/messages`, payload, opts);
  }

  async messages(channelId, since) {
    const q = `?since=${Number(since) || 0}&limit=200`;
    const data = await this.must(
      'GET',
      `/api/channels/${channelId}/messages${q}`,
      undefined,
      `GET /api/channels/${channelId}/messages`
    );
    return (data && data.messages) || [];
  }

  awaitRoute(channelId, sinceSeq) {
    const q = `?since=${Number(sinceSeq) || 0}&timeoutMs=1000`;
    return this.request('GET', `/api/channels/${channelId}/await${q}`);
  }

  createThread(channelId, payload) {
    return this.request('POST', `/api/channels/${channelId}/tasks`, payload);
  }

  listThreads(channelId) {
    return this.request('GET', `/api/channels/${channelId}/tasks`);
  }

  /** The participant read `channel-threads.fetchParticipants` performs. */
  thread(channelId, threadId) {
    return this.request('GET', `/api/channels/${channelId}/tasks/${threadId}`);
  }

  closeThread(channelId, threadId) {
    return this.request('PATCH', `/api/channels/${channelId}/tasks/${threadId}`, {
      op: 'close',
      outcome: 'completed',
      summary: 'live contract harness teardown',
    });
  }

  // ── the session surface that replaced the roster (F-142 / F-144 / F-147) ──────

  /** The state writer's read side. `channel` is an OPTIONAL filter, per the op's schema. */
  sessions(channelId) {
    const q = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
    return this.request('GET', `/api/channels/sessions${q}`);
  }

  pushSessionState(payload) {
    return this.request('POST', '/api/channels/sessions', payload);
  }

  consent(channelId) {
    const q = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
    return this.request('GET', `/api/channels/consent${q}`);
  }

  /** POST-only: presence is a HEARTBEAT, not a read. A GET answers 405 by design. */
  presence(channelId) {
    return this.request('POST', '/api/channels/presence', { channelId });
  }

  trust() {
    return this.request('GET', '/api/channels/trust');
  }

  // ── the surface an AGENT reads through ────────────────────────────────────────

  /**
   * RAW JSON-RPC against the real MCP endpoint — the transport itself, not a tool.
   * `body` goes on the wire verbatim, so a check can send a malformed envelope, an
   * unknown method, or a bad id and assert on what the transport does with it. This is
   * the tier `mcp()` below sits on top of, and the one that had no test at all.
   */
  async rpc(body, opts) {
    this.calls += 1;
    let res;
    try {
      res = await fetch(`${this.baseUrl}/api/mcp`, {
        method: 'POST',
        headers: this.headers({
          Accept: 'application/json, text/event-stream',
          ...((opts && opts.headers) || {}),
        }),
        body: typeof body === 'string' ? body : JSON.stringify(body),
        signal: AbortSignal.timeout((opts && opts.timeoutMs) || 60000),
      });
    } catch (err) {
      return { ok: false, status: 0, text: String((err && err.message) || err), payload: null };
    }
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      text,
      contentType: res.headers.get('content-type') || '',
      payload: parseRpc(text),
    };
  }

  /**
   * One `tools/call` against the real MCP endpoint. The route is STATELESS and streams
   * (SSE), so the response is `event: message` frames carrying JSON-RPC — parsed here
   * rather than assumed, because a transport change is exactly the kind of drift this
   * lane is supposed to notice.
   */
  async mcp(toolName, args, opts) {
    const res = await this.rpc(
      {
        jsonrpc: '2.0',
        id: this.calls,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      },
      opts
    );
    if (!res.ok || !res.payload) {
      return { ok: false, status: res.status, text: res.text, rendered: '' };
    }
    if (res.payload.error) {
      return { ok: false, status: res.status, text: res.text, rendered: '', rpcError: res.payload.error };
    }
    const content = (res.payload.result && res.payload.result.content) || [];
    const rendered = content
      .filter((c) => c && c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    return {
      ok: true,
      status: res.status,
      text: res.text,
      rendered,
      isError: !!(res.payload.result && res.payload.result.isError),
    };
  }

  /** `dopl_channel` with an op — the one tool every channels check drives. */
  channelOp(op, args, opts) {
    return this.mcp('dopl_channel', { op, ...(args || {}) }, opts);
  }
}

/**
 * JSON-RPC out of either an SSE stream or a plain JSON body. The SDK picks per-request,
 * so both shapes are handled rather than one being assumed.
 */
function parseRpc(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return null;
    }
  }
  let last = null;
  for (const line of trimmed.split('\n')) {
    const l = line.trim();
    if (!l.startsWith('data:')) continue;
    try {
      const obj = JSON.parse(l.slice(5).trim());
      if (obj && (obj.result || obj.error)) last = obj;
    } catch (_) {
      /* a keep-alive frame is not JSON; ignore */
    }
  }
  return last;
}

module.exports = { Api, WireError, parseRpc };
