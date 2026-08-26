import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/shared/ui/toast";
import { setBaseStar, type KnowledgeBaseList } from "@/features/knowledge/client/api";
import { knowledgeBasesQueryKey } from "@/features/knowledge/client/hooks";
import { BaseCard } from "@/features/knowledge/components/knowledge-v2/home/base-card";
import type { KnowledgeBase } from "@/features/knowledge/types";
import home from "./home.module.css";

/**
 * The Knowledge panels' CARD CELL and the one write it carries.
 *
 * Split from `knowledge-panels.tsx` for the reason
 * `use-knowledge-v2-trees.ts` was split from its controller — to keep both
 * halves clear of the 500-line cap (INVARIANTS §1) with room for the next
 * entry, rather than at it.
 */

/** One grid cell: the shared `BaseCard`, never forked, optionally captioned. */
export function BaseCell({
  base,
  list,
  badge,
  currentUserId,
  onOpen,
  onToggleStar,
}: {
  base: KnowledgeBase;
  /** The list response the card's meta line is folded from; `undefined` while
   *  the other scope's read is in flight. Missing is UNKNOWN, never zero. */
  list: KnowledgeBaseList | undefined;
  /** Caption pill above the card, or `null` for a bare one. */
  badge: string | null;
  currentUserId: string;
  onOpen: (base: KnowledgeBase) => void;
  onToggleStar: StarToggle;
}) {
  // Same three-way answer `knowledge-home.tsx › ownerLabelFor` gives: own and
  // ownerless bases read "You", a peer's base reads their resolved name, and a
  // degraded name lookup reads neutrally rather than claiming the caller wrote
  // it. Scope A can carry a base the PEER created; B and C never can.
  const ownerLabel =
    base.createdBy && base.createdBy !== currentUserId
      ? (list?.ownerNames[base.createdBy] ?? "Someone else")
      : "You";
  return (
    <div className={home.kbCell}>
      {badge && (
        // The `RolePill` shape at its least-privileged face (`channels-v2/
        // bits.tsx › RolePill`'s guest branch), raised because it sits on the
        // section's INSET body (docs/DESIGN-SYSTEM.md § Pills/chips).
        <span className="w-fit shrink-0 rounded-full border border-border-strong bg-bg-elevated px-2 py-px text-micro font-medium text-text-muted">
          {badge}
        </span>
      )}
      <BaseCard
        base={base}
        stats={list?.baseStats[base.id]}
        storageLimit={list?.kbStorageLimit}
        ownerLabel={ownerLabel}
        starred={list?.starredBaseIds.includes(base.id) ?? false}
        onOpen={onOpen}
        onToggleStar={(baseId, starred) => onToggleStar({ baseId, starred })}
      />
    </div>
  );
}

/** A section body with nothing in it. ⚠ Only ever rendered against a RESOLVED
 *  read — see the loading gates in `knowledge-panels.tsx`. */
export function EmptyLine({ children }: { children: string }) {
  return (
    <p className="px-4 py-6 text-center text-caption text-text-muted">
      {children}
    </p>
  );
}

/**
 * Star one base, optimistically, ON A GIVEN CACHE ENTRY.
 *
 * ⚠ NOT `client/hooks.ts › useToggleBaseStar`, and the difference is the KEY,
 * not the behaviour. That hook patches `knowledgeBasesQueryKey(workspaceId)`;
 * the Shared and scope-B sections render from the CHANNEL-SCOPED entry beside
 * it, and INVARIANTS §8 is explicit that a key differing by one element is a
 * SILENT no-op — the toggle would round-trip and the card would never change.
 * Same four rules followed here: cancel only with data (2), MERGE the one field
 * (5), no invalidation because this entry is warm by construction (1), key
 * captured at submit (4). Rollback restores the SNAPSHOT, never the inverse.
 */
export function useStarToggle(
  queryKey: readonly unknown[],
  workspaceId: string | undefined
): StarToggle {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ baseId, starred }: StarVars) =>
      setBaseStar(baseId, starred, workspaceId),
    onMutate: async ({ baseId, starred }: StarVars) => {
      const previous = queryClient.getQueryData<KnowledgeBaseList>(queryKey);
      if (!previous) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<KnowledgeBaseList>(queryKey, (prev) =>
        prev
          ? {
              ...prev,
              starredBaseIds: starred
                ? prev.starredBaseIds.includes(baseId)
                  ? prev.starredBaseIds
                  : [...prev.starredBaseIds, baseId]
                : prev.starredBaseIds.filter((id) => id !== baseId),
            }
          : prev
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast({ title: "Couldn't update bookmark" });
    },
  });
  return mutation.mutate;
}

type StarVars = { baseId: string; starred: boolean };
export type StarToggle = (vars: StarVars) => void;

/**
 * The channel-scoped base list's key — the plain key plus one element, so a
 * writer's `["knowledge", "bases:<ws>"]` prefix still reaches it (§8).
 * ⚠ Built from `knowledgeBasesQueryKey` rather than retyped, so the two can
 * never disagree about the first two elements.
 */
export function channelBasesQueryKey(
  workspaceId: string | undefined,
  channelId: string | undefined
) {
  return [...knowledgeBasesQueryKey(workspaceId), `channel:${channelId}`] as const;
}
