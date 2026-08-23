import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Link2, Search } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CreateWorkspaceDialogCore } from "@/features/workspaces/components/create-workspace-dialog-core";
import { isStandardWorkspace } from "@/features/workspaces/types";
import { workspaceSegment } from "@/features/workspaces/url";
import { EmptyState } from "@/shared/ui/empty-state";
import type { WorkspaceLike } from "@/shared/layout/app-shell/workspace-types";
import type { HomeRelationshipsPayload } from "@/features/home/types";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { bootQueryKey, fetchBoot } from "#/pages/boot/use-boot-state";
import { AccountRail } from "#/components/app-shell";
import { RelationshipList } from "./relationship-list";
import { RelationshipRecord } from "./relationship-record";
import { PendingLinkCard } from "./pending-link-card";
import { NewLinkPopover } from "./new-link-popover";
import {
  HOME_RELATIONSHIPS_PATH,
  homeRows,
  visibleRows,
  type HomeFilter,
} from "./home-rows";

/**
 * /home — the ACCOUNT surface (Samuel, 2026-08-21). Personal, cross-org
 * channels: the level workspaces sit on top of, reached from the account
 * rail's pinned tile. Like /onboarding it lives OUTSIDE `/:workspaceSegment`
 * and cannot mount under the workspace shell — there is no workspace here.
 *
 * ⚠ THE RAIL IS FILTERED (2026-08-23). `GET /api/workspaces` is deliberately
 * unfiltered and now returns `kind='link'` CONTAINERS beside real workspaces —
 * one per relationship — so every desktop list runs it through
 * `isStandardWorkspace`. A container is a relationship's plumbing; it is not a
 * place anybody navigates to.
 *
 * ⚠ THE CALLER'S ID COMES FROM `POST /api/boot`, on the SAME cache key the boot
 * page seeds (`bootQueryKey(null)`) — so arriving here from the rail costs no
 * request and there is no second identity endpoint. Modelled as a query for the
 * reason boot's own docblock gives: idempotent, read-shaped, retry = refetch.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const [createWsOpen, setCreateWsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HomeFilter>("all");

  const workspacesQuery = useApiQuery<
    { workspaces?: WorkspaceLike[] },
    WorkspaceLike[]
  >("/api/workspaces", { select: selectStandardWorkspaces });
  const relationshipsQuery =
    useApiQuery<HomeRelationshipsPayload>(HOME_RELATIONSHIPS_PATH);
  const identity = useQuery({
    queryKey: bootQueryKey(null),
    queryFn: ({ signal }) => fetchBoot(null, signal),
  });

  const rows = useMemo(
    () => (relationshipsQuery.data ? homeRows(relationshipsQuery.data) : []),
    [relationshipsQuery.data]
  );
  // ⚠ THE FILTER LIVES HERE, not in the list. The record pane falls back to the
  // first row when nothing is selected, and it has to be the first row the
  // reader can SEE — with the filter private to the list, typing into search
  // left the pane on a person the list had already dropped.
  const visible = useMemo(
    () => visibleRows(rows, filter, query),
    [rows, filter, query]
  );
  const linkCount = rows.filter((row) => row.kind === "link").length;

  const error =
    relationshipsQuery.error ?? workspacesQuery.error ?? identity.error;
  const pending =
    relationshipsQuery.isPending || workspacesQuery.isPending || identity.isPending;

  if (pending) {
    return (
      <div className="flex h-screen w-screen flex-col">
        <PageLoading label="Opening home" />
      </div>
    );
  }
  if (isUnauthorized(error)) return <SignedOutScreen />;
  if (error || !identity.data) {
    return (
      <div className="flex h-screen w-screen flex-col">
        <PageError
          error={error ?? new Error("Could not open home")}
          onRetry={() => {
            void relationshipsQuery.refetch();
            void workspacesQuery.refetch();
            void identity.refetch();
          }}
        />
      </div>
    );
  }

  const selected =
    visible.find((row) => row.id === selectedId) ?? visible[0] ?? null;

  return (
    // `!bg-surface-invert` (×2): Home's frame is the rail's dark ink, so the
    // rail reads as part of one dark frame and the base panel floats on it.
    // `!` because the shell module's own fill is the same one-class specificity
    // and stylesheet order between module CSS and utilities is not guaranteed.
    <div className={cn(shell.root, "!bg-surface-invert")}>
      <div className={shell.body}>
        <AccountRail
          workspaces={workspacesQuery.data ?? []}
          activeWorkspacePublicId={null}
          onNavigate={(path) => navigate(path)}
          onCreateWorkspace={() => setCreateWsOpen(true)}
        />
        <div className={cn(shell.surface, "!bg-surface-invert")}>
          {/* Layered panels: the BASE panel (darker, `bg-bg-inset`) carries the
              header + relationship list; the record floats on it as a raised
              card. `bg-bg-inset` outranks `.page-float`'s own fill (utility
              layer > kit layer) — the float keeps radius/margins/shadow. */}
          <main className="page-float flex flex-1 flex-col overflow-hidden bg-bg-inset">
            <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3.5">
              <h1 className="text-display font-semibold text-text-primary">
                Home
              </h1>
              <div className="flex items-center gap-2.5">
                {/* Elevated search, sized to the CTA beside it. */}
                <div className="bento flex w-[260px] items-center gap-2 rounded-[9px] bg-white px-3">
                  <Search size={14} className="shrink-0 text-text-muted" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search people"
                    aria-label="Search people"
                    spellCheck={false}
                    className="h-9 min-w-0 flex-1 bg-transparent text-body text-text-primary outline-none placeholder:text-text-muted"
                  />
                </div>
                <NewLinkPopover />
              </div>
            </div>
            <div className="flex min-h-0 flex-1">
              <RelationshipList
                rows={visible}
                linkCount={linkCount}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
                filter={filter}
                onFilterChange={setFilter}
              />
              <div className="bento mb-3 mr-3 flex min-w-0 flex-1 overflow-hidden rounded-[14px] bg-bg-elevated">
                {selected === null ? (
                  // ⚠ Two reasons for an empty pane, and they are not the same
                  // sentence: nothing to show, or nothing MATCHING to show.
                  rows.length > 0 ? (
                    <EmptyState icon={Search} title="No matches" />
                  ) : (
                    <EmptyState
                      icon={Link2}
                      title="No relationships yet"
                      description="Mint a link and send it to somebody — the channel opens when they claim it."
                    />
                  )
                ) : selected.kind === "link" ? (
                  <PendingLinkCard key={selected.id} link={selected.link} />
                ) : (
                  <RelationshipRecord
                    key={selected.id}
                    relationship={selected.relationship}
                    currentUserId={identity.data.userId}
                    onDeleted={() => {
                      setSelectedId(null);
                      void relationshipsQuery.refetch();
                    }}
                  />
                )}
              </div>
            </div>
          </main>
        </div>
      </div>

      <CreateWorkspaceDialogCore
        open={createWsOpen}
        onOpenChange={setCreateWsOpen}
        onCreated={(created) => {
          void workspacesQuery.refetch();
          navigate(`/${workspaceSegment(created)}`);
        }}
      />
    </div>
  );
}

/** ⚠ Link CONTAINERS never appear in the rail — see the file docblock. */
const selectStandardWorkspaces = (body: { workspaces?: WorkspaceLike[] }) =>
  (body.workspaces ?? []).filter(isStandardWorkspace);
