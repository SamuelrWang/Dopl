import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
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
 * `subscribe` fires on EVERY location change, not just Back/Forward, because
 * that is also how a programmatic move (create-base, delete-base) reaches the
 * controller. The controller filters out the writes it made itself.
 */
export function useKnowledgeUrlSync(workspaceSegment: string): KnowledgeUrlSync {
  const navigate = useNavigate();
  const location = useLocation();

  const handlersRef = useRef(new Set<() => void>());
  // A `navigate()` inside an effect only reaches `location` on the next
  // render. Without this, a controller effect that re-runs in between would
  // read the pre-navigation URL and push the same entry twice.
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    pendingRef.current = null;
    // Subscribers are the controller's, one level down, so they have already
    // registered by the time this parent effect runs.
    for (const handler of [...handlersRef.current]) handler();
  }, [location]);

  // Rebuilt per location so `current`/`read` close over the live one — a ref
  // would still hold the previous value when the controller's effects run
  // (child effects fire before this component's).
  return useMemo<KnowledgeUrlSync>(() => {
    const root = `/${workspaceSegment}/knowledge`;
    const urlFor = ({ baseSegment, entryId }: KnowledgeUrlLocation) => {
      if (!baseSegment) return root;
      const path = `${root}/${baseSegment}`;
      return entryId ? `${path}?entryId=${entryId}` : path;
    };
    return {
      urlFor,
      current: () => pendingRef.current ?? location.pathname + location.search,
      write: (url, mode) => {
        pendingRef.current = url;
        navigate(url, { replace: mode === "replace" });
      },
      read: () => {
        const parts = location.pathname.split("/").filter(Boolean);
        // /{ws}/knowledge/{seg?}
        const baseSegment = parts[1] === "knowledge" ? (parts[2] ?? null) : null;
        return {
          baseSegment,
          entryId: new URLSearchParams(location.search).get("entryId"),
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
  }, [workspaceSegment, location, navigate]);
}
