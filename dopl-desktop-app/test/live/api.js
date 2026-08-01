'use strict';

// LIVE CONTRACT HARNESS — the real wire.
//
// TWO SURFACES, because the feature has two and the seam between them is where the bugs
// were: the REST routes the desktop listener actually calls (`/api/channels/**`), and the
// MCP endpoint an AGENT actually reads through (`/api/mcp`, JSON-RPC over SSE).
//
// EVERY FAILURE CARRIES ITS STATUS AND ITS BODY. A harness that swallows a 400 is worse
// than no harness — the whole point is to see what the server really said.

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

  addMember(channelId, userId) {
    return this.request('POST', `/api/channels/${channelId}/members`, { userId });
  }

  summonAgent(channelId, name) {
    return this.request('POST', `/api/channels/${channelId}/agents`, { name });
  }

  setAgentStatus(channelId, agentId, status) {
    return this.request('PATCH', `/api/channels/${channelId}/agents/${agentId}`, {
      op: 'set_status',
      status,
    });
  }

  /** The roster read `channel-roster.fetchRoster` performs, byte for byte. */
  async roster(channelId) {
    const data = await this.must(
      'GET',
      `/api/channels/${channelId}/agents`,
      undefined,
      `GET /api/channels/${channelId}/agents`
    );
    return (data && data.agents) || [];
  }

  post(channelId, payload) {
    return this.request('POST', `/api/channels/${channelId}/messages`, payload);
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

  createThread(channelId, payload) {
    return this.request('POST', `/api/channels/${channelId}/tasks`, payload);
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

  // ── the surface an AGENT reads through ────────────────────────────────────────

  /**
   * One `tools/call` against the real MCP endpoint. The route is STATELESS and streams
   * (SSE), so the response is `event: message` frames carrying JSON-RPC — parsed here
   * rather than assumed, because a transport change is exactly the kind of drift this
   * lane is supposed to notice.
   */
  async mcp(toolName, args, opts) {
    this.calls += 1;
    const res = await fetch(`${this.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: this.headers({ Accept: 'application/json, text/event-stream' }),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.calls,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
      signal: AbortSignal.timeout((opts && opts.timeoutMs) || 60000),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, text, rendered: '' };
    const payload = parseRpc(text);
    if (!payload) return { ok: false, status: res.status, text, rendered: '' };
    if (payload.error) {
      return { ok: false, status: res.status, text, rendered: '', rpcError: payload.error };
    }
    const content = (payload.result && payload.result.content) || [];
    const rendered = content
      .filter((c) => c && c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    return { ok: true, status: res.status, text, rendered, isError: !!(payload.result && payload.result.isError) };
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
