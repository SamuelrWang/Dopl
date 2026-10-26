"use client";

/**
 * The staging page's network: while installed, every same-origin `/api/**` request is answered
 * by `server/routes.ts` from the in-memory DB, so the PRODUCT knowledge components run unchanged
 * over fake data. Anything else passes through to the real `fetch`. A route staging does not
 * serve answers 404 in the API's error envelope.
 */
import { FakeHttpError } from "./server/http";
import { matchRoute } from "./server/routes";

let realFetch: typeof fetch | null = null;

const LATENCY_MS = 140;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function answer(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
    return realFetch!(input, init);
  }
  const method = (init.method ?? "GET").toUpperCase();
  const route = matchRoute(method, url.pathname);
  if (!route) {
    return json(404, { error: { code: "NOT_FOUND", message: `Staging serves no ${method} ${url.pathname}` } });
  }
  // A short pause, so busy states ("Saving…", spinners, pending rows) are visible.
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  const headers = new Headers(init.headers);
  try {
    const out = route.handler({
      method,
      params: route.params,
      query: url.searchParams,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      workspaceId: headers.get("x-workspace-id") ?? undefined,
    });
    if (out instanceof Response) return out;
    return out === undefined ? new Response(null, { status: 204 }) : json(200, out);
  } catch (err) {
    if (err instanceof FakeHttpError) {
      return json(err.status, { error: { code: err.code, message: err.message } });
    }
    throw err;
  }
}

/** Idempotent; returns the uninstall. */
export function installKnowledgeFetch(): () => void {
  if (!realFetch) {
    realFetch = window.fetch.bind(window);
    window.fetch = answer;
  }
  return () => {
    if (realFetch) {
      window.fetch = realFetch;
      realFetch = null;
    }
  };
}
