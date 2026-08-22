import { useState } from "react";
import { useNavigate } from "react-router";
import { Search } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CreateWorkspaceDialogCore } from "@/features/workspaces/components/create-workspace-dialog-core";
import { workspaceSegment } from "@/features/workspaces/url";
import type { WorkspaceLike } from "@/shared/layout/app-shell/workspace-types";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { AccountRail } from "#/components/app-shell";
import { HOME_CHANNELS } from "./mock";
import { RelationshipList } from "./relationship-list";
import { ChannelView } from "./channel-view";
import { NewLinkPopover } from "./new-link-popover";

/**
 * /home — the ACCOUNT surface (Samuel, 2026-08-21). Personal, cross-org
 * channels: the level workspaces sit on top of, reached from the account
 * rail's pinned tile. Like /onboarding it lives OUTSIDE `/:workspaceSegment`
 * and cannot mount under the workspace shell — there is no workspace here.
 *
 * ⚠ The channel data is HARDCODED (./mock.ts) — this page is the design
 * target for account-owned channels; only the rail + workspace create are
 * live. Deliberately NOT the workspace channels layout: one flat list of
 * relationships, a ledger-style record, one mint-a-link action.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const [createWsOpen, setCreateWsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(HOME_CHANNELS[0].id);
  const [query, setQuery] = useState("");
  const workspacesQuery = useApiQuery<
    { workspaces?: WorkspaceLike[] },
    WorkspaceLike[]
  >("/api/workspaces", { select: (body) => body.workspaces ?? [] });

  if (workspacesQuery.isPending) {
    return (
      <div className="flex h-screen w-screen flex-col">
        <PageLoading label="Opening home" />
      </div>
    );
  }
  if (isUnauthorized(workspacesQuery.error)) return <SignedOutScreen />;
  if (workspacesQuery.error) {
    return (
      <div className="flex h-screen w-screen flex-col">
        <PageError
          error={workspacesQuery.error}
          onRetry={() => void workspacesQuery.refetch()}
        />
      </div>
    );
  }

  const selected =
    HOME_CHANNELS.find((c) => c.id === selectedId) ?? HOME_CHANNELS[0];

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
                    spellCheck={false}
                    className="h-9 min-w-0 flex-1 bg-transparent text-body text-text-primary outline-none placeholder:text-text-muted"
                  />
                </div>
                <NewLinkPopover />
              </div>
            </div>
            <div className="flex min-h-0 flex-1">
              <RelationshipList
                channels={HOME_CHANNELS}
                selectedId={selected.id}
                onSelect={setSelectedId}
                query={query}
              />
              <div className="bento mb-3 mr-3 flex min-w-0 flex-1 overflow-hidden rounded-[14px] bg-bg-elevated">
                <ChannelView key={selected.id} channel={selected} />
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
