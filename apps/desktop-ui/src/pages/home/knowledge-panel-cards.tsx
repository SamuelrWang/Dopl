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
  // 🔒 ⚠ §8 STALE-CACHE, AND `?.` DOES NOT COVER IT. `list?.ownerNames[…]` guards
  // `list`, NOT the sibling KEY — a payload cached by a bundle that predates a
  // field arrives as a live object whose `ownerNames` / `baseStats` /
  // `starredBaseIds` is `undefined`, and indexing or `.includes()` on that
  // THROWS, blanking the whole pane. That is §8's named failure, and every one
  // of these keys is younger than some cache entry in the wild
  // (`starredBaseIds` arrived with `20260812075637_knowledge_base_stars`,
  // `channelGrants` with this wave). `fetchBaseList` normalises on the WIRE;
  // nothing normalises on the way OUT of the cache, which is the path that
  // matters here. So the fallback is spelled per key, inline, at the read.
  const ownerNames = list?.ownerNames ?? EMPTY_OWNER_NAMES;
  const baseStats = list?.baseStats ?? EMPTY_BASE_STATS;
  const starredBaseIds = list?.starredBaseIds ?? EMPTY_STARRED;
  // Same three-way answer `knowledge-home.tsx › ownerLabelFor` gives: own and
  // ownerless bases read "You", a peer's base reads their resolved name, and a
  // degraded name lookup reads neutrally rather than claiming the caller wrote
  // it. Scope A can carry a base the PEER created; B and C never can.
  const ownerLabel =
    base.createdBy && base.createdBy !== currentUserId
      ? (ownerNames[base.createdBy] ?? "Someone else")
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
        stats={baseStats[base.id]}
        storageLimit={list?.kbStorageLimit}
        ownerLabel={ownerLabel}
        starred={starredBaseIds.includes(base.id)}
        onOpen={onOpen}
        onToggleStar={(baseId, starred) => onToggleStar({ baseId, starred })}
      />
    </div>
  );
}

/** Frozen module-level empties, so a degraded read does not mint a new object
 *  per render and re-run every downstream memo. ⚠ MISSING is UNKNOWN, and each
 *  of these renders as the honest unknown: no name (→ "Someone else"), no stats
 *  line, not starred. */
const EMPTY_OWNER_NAMES: Readonly<Record<string, string>> = Object.freeze({});
const EMPTY_BASE_STATS: Readonly<
  Record<string, KnowledgeBaseList["baseStats"][string]>
> = Object.freeze({});
const EMPTY_STARRED: readonly string[] = Object.freeze([]);

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
 * The channel-scoped base list's key.
 *
 * 🔒 ⚠ IT IS `knowledgeBasesQueryKey(ws, channelId)` AND NOTHING ELSE, AND IT
 * WAS A DIFFERENT SHAPE UNTIL 2026-08-26. This built an ARRAY-EXTENDED key —
 * `[...knowledgeBasesQueryKey(ws), \`channel:${id}\`]`, i.e.
 * `["knowledge", "bases:W", "channel:C"]` — while the grant WRITE patches by
 * matching `key[1]` against the STRING-EXTENDED segment
 * `knowledgeBasesCacheSegment(ws, channelId)` = `"bases:W:channel:C"`
 * (`hooks-channel-grants.ts › patchChannelGrantInCache`). On this key `key[1]`
 * is `"bases:W"`, so the patch matched NOTHING THE PANE HAD MOUNTED: granting a
 * base from the settings modal left it in the wrong section until a cold
 * refetch. The suite did not catch it because it seeded the WRITER's shape,
 * which no surface ever mounts — **a test that builds its own key proves the
 * patcher works and says nothing about whether anybody is listening.**
 *
 * ⚠ SO THE MINTER IS SHARED, not mirrored. `knowledgeBasesQueryKey` is the one
 * place either shape can be decided, and the writer's prefix match
 * (`segment === target || segment.startsWith(\`${target}:\`)`) still reaches any
 * surface that extends the SEGMENT further. This wrapper survives only as the
 * NAME the pane reads by; it adds nothing.
 */
export function channelBasesQueryKey(
  workspaceId: string | undefined,
  channelId: string | undefined
) {
  return knowledgeBasesQueryKey(workspaceId, channelId);
}
