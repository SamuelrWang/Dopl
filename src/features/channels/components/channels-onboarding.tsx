"use client";

import Link from "next/link";
import { Hash, MonitorSmartphone, Plug, UserPlus, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { useMembers } from "@/features/members/hooks/use-members";
import { DOWNLOAD_URL } from "@/features/marketing/constants";

interface Props {
  workspaceSlug: string;
  canCreate: boolean;
  onCreate: () => void;
}

/**
 * First-run explainer for the detail pane when a workspace has no channels.
 * Composes the shared `EmptyState` (same treatment as chats / members /
 * skills) and hangs the setup steps off it as children. Says what channels are
 * for and what responding needs (the desktop app + an MCP-connected agent),
 * each step carrying the link that actually does it. When the caller is alone
 * in the workspace, it points at the real first step: invite teammates, since
 * a channel with one member has no one to collaborate with.
 */
export function ChannelsOnboarding({ workspaceSlug, canCreate, onCreate }: Props) {
  const { members } = useMembers(workspaceSlug);
  // `members` is null until the query settles. Gate on that, otherwise a solo
  // workspace flashes the three-step flow before collapsing to the invite step.
  const settled = members !== null;
  const activeCount = (members ?? []).filter((m) => m.status === "active").length;
  const solo = settled && activeCount <= 1;

  return (
    <EmptyState
      icon={Hash}
      title="Channels connect your agents"
      description="A channel is a shared thread where teammates and their agents work together. Address a request to someone and their agent picks it up, runs it with their approval, and posts back."
    >
      {settled &&
        (solo ? (
          <div className="mt-1.5 w-full max-w-[440px]">
            <StepCard
              icon={UserPlus}
              title="Invite teammates first"
              body="You are the only member of this workspace. Add teammates so their agents can join your channels."
              href={`/${workspaceSlug}/members`}
              action="Go to members"
            />
          </div>
        ) : (
          <>
            <div className="mt-1.5 flex w-full max-w-[440px] flex-col gap-2">
              <StepCard
                icon={MonitorSmartphone}
                title="Install the desktop app"
                body="It runs in the background and listens for requests addressed to you."
                href={DOWNLOAD_URL}
                action="Download for macOS"
                external
              />
              <StepCard
                icon={Plug}
                title="Connect your agent"
                body="Point your MCP-connected agent at Dopl so it can respond in channels."
                href={`/${workspaceSlug}/settings`}
                action="Open connection settings"
              />
              <StepCard
                icon={Users}
                title="Create a channel and add teammates"
                body="Start a thread, invite the people whose agents you want to work with."
                href={`/${workspaceSlug}/members`}
                action="Invite teammates"
              />
            </div>
            {canCreate && (
              <button
                type="button"
                onClick={onCreate}
                className="btn-light mt-1 rounded-[9px] px-4 py-2 text-small font-medium text-text-primary"
              >
                Create a channel
              </button>
            )}
          </>
        ))}
    </EmptyState>
  );
}

function StepCard({
  icon: Icon,
  title,
  body,
  href,
  action,
  external,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  href: string;
  /** Link label for the step's real next action. */
  action: string;
  /** Off-app destination (the desktop build) — plain anchor, new tab. */
  external?: boolean;
}) {
  const linkClass =
    "mt-1 inline-block text-caption font-medium text-text-primary underline decoration-border-strong underline-offset-2 transition-colors hover:decoration-text-primary";

  return (
    <div className="bento flex items-start gap-3 px-3.5 py-2.5 text-left">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-bg-inset text-text-secondary">
        <Icon size={15} />
      </span>
      <span className="min-w-0">
        <span className="block text-body font-medium text-text-primary">
          {title}
        </span>
        <span className="block text-caption leading-relaxed text-text-secondary">
          {body}
        </span>
        {external ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className={linkClass}
          >
            {action}
          </a>
        ) : (
          <Link href={href} className={linkClass}>
            {action}
          </Link>
        )}
      </span>
    </div>
  );
}
