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
 * The SPA binding of the knowledge controller's URL contract
 * (`@/features/knowledge/components/knowledge-v2/routing.ts`).
 *
 * The web app drives that contract with the raw History API on purpose: a
 * base switch must move the address bar WITHOUT unmounting the two-pane view,
 * because the controller owns every open tree, the expansion set and the
 * unsaved editor state. Under the hash router the same requirement holds, so
 * this adapter goes through `navigate()` — which keeps the router's own
 * location honest — and the route table registers `knowledge` and
 * `knowledge/:kbSlug` with the SAME page component, so react-router
 * reconciles the two matches instead of remounting between them.
 *
 * IDENTITY IS STABLE ACROSS LOCATION CHANGES, and that is a contract rather
 * than an optimization: the controller's write effect lists `sync` in its
 * deps, so an adapter rebuilt per location would re-run that effect on every
 * Back/Forward with the PRE-change selection still in state and write the old
 * URL straight back over the one the user just reached — corrupting history
 * and double-navigating. The live location therefore reaches `current`/`read`
 * through a ref refreshed in a LAYOUT effect: every layout effect in the tree
 * runs before any passive effect, so the value is already current when the
 * controller's effects read it one level down.
 *
 * `subscribe` fires on EVERY location change, not just Back/Forward, because
 * that is also how a programmatic move (create-base, delete-base) reaches the
 * controller. The controller filters out the writes it made itself.
 */
export function useKnowledgeUrlSync(workspaceSegment: string): KnowledgeUrlSync {
  const navigate = useNavigate();
  const location = useLocation();

  const navigateRef = useRef<NavigateFunction>(navigate);
  const locationRef = useRef<Location>(location);
  const handlersRef = useRef(new Set<() => void>());
  // A `navigate()` inside an effect only reaches `location` on the next
  // render. Without this, a controller effect that re-runs in between would
  // read the pre-navigation URL and push the same entry twice.
  const pendingRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    navigateRef.current = navigate;
    locationRef.current = location;
    pendingRef.current = null;
  }, [navigate, location]);

  useEffect(() => {
    // Subscribers are the controller's, one level down, so they have already
    // registered by the time this parent effect runs — and the layout effect
    // above has already refreshed what they are about to read.
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
