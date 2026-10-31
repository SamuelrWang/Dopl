"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Call, CallStatus } from "@/features/device-sdk/portal/view";
import { setPortalClock } from "./format";
import { usePortal } from "./portal-store";

const POLL_MS = 3000;
/** A row can land a little after its own timestamp, because the log flushes in batches. */
const LATE_MS = 60_000;
const NEW_ROWS = 100;
const OLDER_ROWS = 300;
const KEPT = 2000;
const MAX_OPEN = 50;
const MOVING: readonly CallStatus[] = ["queued", "retrying"];

type FeedParams = Record<string, string | undefined>;

export async function readFeed(project: string, env: string, params: FeedParams, signal?: AbortSignal): Promise<{ calls: Call[]; now: string } | null> {
  const query = new URLSearchParams({ project, env });
  for (const [k, v] of Object.entries(params)) if (v) query.set(k, v);
  const res = await fetch(`/api/developers/activity?${query}`, { signal }).catch(() => null);
  return res?.ok ? ((await res.json()) as { calls: Call[]; now: string }) : null;
}

/** Keeps `current` itself when nothing changed, so an idle poll renders nothing new. */
function merged(current: Call[], incoming: readonly Call[]): Call[] {
  const byId = new Map(current.map((c) => [c.id, c]));
  let changed = false;
  for (const c of incoming) {
    const had = byId.get(c.id);
    if (had && JSON.stringify(had) === JSON.stringify(c)) continue;
    byId.set(c.id, c);
    changed = true;
  }
  return changed ? [...byId.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, KEPT) : current;
}

/**
 * The feed, kept current cheaply: only rows newer than the newest held and rows still moving, nothing while the tab
 * is hidden. Rows keep their identity and order, so a row in view does not move and a selection holds.
 */
export function useLiveCalls(initial: Call[], source?: "webhooks") {
  const { project, env } = usePortal();
  const [calls, setCalls] = useState(initial);
  const [lastInitial, setLastInitial] = useState(initial);
  if (lastInitial !== initial) {
    setLastInitial(initial);
    setCalls(merged(calls, initial));
  }
  const [more, setMore] = useState(initial.length >= OLDER_ROWS);
  const [loading, setLoading] = useState(false);
  const [, setBeat] = useState(0);
  const held = useRef(calls);
  useEffect(() => {
    held.current = calls;
  }, [calls]);

  useEffect(() => {
    const abort = new AbortController();
    let timer: number | undefined;
    let busy = false;
    const poll = async () => {
      window.clearTimeout(timer);
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      const newest = held.current[0]?.at;
      const body = await readFeed(
        project.id,
        env,
        {
          source,
          limit: String(NEW_ROWS),
          since: newest && new Date(Date.parse(newest) - LATE_MS).toISOString(),
          open: held.current.filter((c) => MOVING.includes(c.status)).slice(0, MAX_OPEN).map((c) => c.id).join(","),
        },
        abort.signal
      ).catch(() => null);
      busy = false;
      if (abort.signal.aborted) return;
      if (body) {
        setPortalClock(body.now);
        setCalls((c) => merged(c, body.calls));
        setBeat((n) => n + 1);
      }
      timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    const wake = () => void poll();
    timer = window.setTimeout(wake, POLL_MS);
    document.addEventListener("visibilitychange", wake);
    return () => {
      abort.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [project.id, env, source]);

  const loadOlder = useCallback(async () => {
    const oldest = held.current.at(-1)?.at;
    if (!oldest) return;
    setLoading(true);
    const body = await readFeed(project.id, env, { source, before: oldest, limit: String(OLDER_ROWS) });
    setLoading(false);
    if (!body) return;
    setCalls((c) => merged(c, body.calls));
    setMore(body.calls.length >= OLDER_ROWS && held.current.length < KEPT);
  }, [project.id, env, source]);

  return { calls, more, loading, loadOlder };
}
