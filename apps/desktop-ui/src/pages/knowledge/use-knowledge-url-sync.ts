import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  useLocation,
  useNavigate,
  type Location,
  type NavigateFunction,
} from "react-router";
import type {
  KnowledgeUrlLocation,
  KnowledgeUrlSync,
} from "@/features/knowledge/components/knowledge-v2/routing";

/**
 * SPA binding of the knowledge controller's URL contract
 * (`@/features/knowledge/components/knowledge-v2/routing.ts`).
 *
 * ⚠ A base switch must move the address bar WITHOUT unmounting the two-pane
 * view — the controller owns every open tree, the expansion set and unsaved
 * editor state. Hence `navigate()` (keeps the router's location honest) plus a
 * route table registering `knowledge` and `knowledge/:kbSlug` on the SAME page
 * component, so react-router reconciles instead of remounting.
 *
 * ⚠ IDENTITY MUST STAY STABLE ACROSS LOCATION CHANGES — contract, not
 * optimization. Controller's write effect lists `sync` in its deps, so an
 * adapter rebuilt per location re-runs it on every Back/Forward with the
 * PRE-change selection still in state and writes the old URL back over the one
 * just reached (corrupt history + double navigation). Live location therefore
 * reaches `current`/`read` via a ref refreshed in a LAYOUT effect: all layout
 * effects run before any passive effect, so it is current when the controller's
 * effects read it one level down.
 *
 * `subscribe` fires on EVERY location change, not just Back/Forward — that is
 * also how a programmatic move (create/delete base) reaches the controller,
 * which filters out its own writes.
 */
export function useKnowledgeUrlSync(workspaceSegment: string): KnowledgeUrlSync {
  const navigate = useNavigate();
  const location = useLocation();

  const navigateRef = useRef<NavigateFunction>(navigate);
  const locationRef = useRef<Location>(location);
  const handlersRef = useRef(new Set<() => void>());
  // ⚠ `navigate()` inside an effect only reaches `location` next render.
  // Without this a controller effect re-running in between reads the
  // pre-navigation URL and pushes the same entry twice.
  const pendingRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    navigateRef.current = navigate;
    locationRef.current = location;
    pendingRef.current = null;
  }, [navigate, location]);

  useEffect(() => {
    // Subscribers are the controller's, one level down: already registered when
    // this parent effect runs, and the layout effect above already refreshed
    // what they read.
    for (const handler of [...handlersRef.current]) handler();
  }, [location]);

  return useMemo<KnowledgeUrlSync>(() => {
    const root = `/${workspaceSegment}/knowledge`;
    const urlFor = ({ baseSegment, entryId }: KnowledgeUrlLocation) => {
      if (!baseSegment) return root;
      const path = `${root}/${baseSegment}`;
      return entryId ? `${path}?entryId=${entryId}` : path;
    };
    return {
      urlFor,
      current: () =>
        pendingRef.current ??
        locationRef.current.pathname + locationRef.current.search,
      write: (url, mode) => {
        pendingRef.current = url;
        navigateRef.current(url, { replace: mode === "replace" });
      },
      read: () => {
        const parts = locationRef.current.pathname.split("/").filter(Boolean);
        // /{ws}/knowledge/{seg?}
        const baseSegment = parts[1] === "knowledge" ? (parts[2] ?? null) : null;
        return {
          baseSegment,
          entryId: new URLSearchParams(locationRef.current.search).get("entryId"),
        };
      },
      subscribe: (handler) => {
        const handlers = handlersRef.current;
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
    };
  }, [workspaceSegment]);
}
