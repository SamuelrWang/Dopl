"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { CopyButton } from "@/shared/ui/copy-button";
import { EmptyState } from "@/shared/ui/empty-state";
import { FormDialog, PillChoice, UnderlineField } from "@/shared/ui/form-dialog";
import { CreateButton, pillButton } from "@/shared/ui/pill-button";
import { SelectMenu } from "@/shared/ui/select-menu";
import { StatusPill } from "@/shared/ui/status-pill";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABEL,
  canActOn,
  canAssignRole,
  type AssignableRole,
  type PortalRole,
} from "@/features/device-sdk/portal/scope";
import { Card, PageHeader, Table, ov } from "../../_components/ui";
import { errorText, portalCall } from "../../_lib/client-api";

export interface MemberRow {
  userId: string;
  email: string;
  role: PortalRole;
  isOwner: boolean;
  joined: string;
}

export interface InviteRow {
  id: string;
  email: string;
  role: AssignableRole;
  sent: string;
  expires: string;
  expired: boolean;
}

const ROLE_HINT: Record<AssignableRole, string> = {
  admin: "Keys, projects and invites.",
  developer: "Reads logs and keys.",
};

/** Mirrors `portal-admin.ts › cleanName`'s ceiling. */
const NAME_MAX = 120;

type Pending =
  | { kind: "remove"; member: MemberRow }
  | { kind: "leave" }
  | { kind: "revoke-invite"; invite: InviteRow }
  | null;

/**
 * The org page's client half. Every write is a `/api/developers/*` call and the page re-reads
 * after it; the controls shown are the ones the server would allow (`canActOn`, `canAssignRole`),
 * and the server re-checks every one.
 */
export function OrgView({
  org,
  me,
  canManageProjects,
  canManageMembers,
  canEditMembers,
  projects,
  members,
  invites,
  otherOrgs,
}: {
  org: { id: string; name: string; role: PortalRole };
  me: string;
  canManageProjects: boolean;
  canManageMembers: boolean;
  /** False on an internal org: no role changes there (removing and leaving stay). */
  canEditMembers: boolean;
  projects: Array<{ id: string; name: string; apiVersion: string }>;
  members: MemberRow[];
  invites: InviteRow[];
  otherOrgs: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const orgPath = `/api/developers/orgs/${encodeURIComponent(org.id)}`;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const [projectOpen, setProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);

  const grantable = ASSIGNABLE_ROLES.filter((r) => canAssignRole(org.role, r));
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableRole>("developer");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(errorText(e, `Could not ${what}`));
      throw e;
    }
  };

  const createProject = async () => {
    if (projectBusy || !projectName.trim()) return;
    setProjectBusy(true);
    try {
      await run("create the project", () => portalCall(`${orgPath}/projects`, "POST", { name: projectName }));
      setProjectOpen(false);
      setProjectName("");
    } catch {
      setProjectOpen(false);
    } finally {
      setProjectBusy(false);
    }
  };

  const sendInvite = async () => {
    if (inviteBusy || !inviteEmail.trim()) return;
    setInviteBusy(true);
    try {
      await run("create the invite", async () => {
        const out = await portalCall<{ path: string; invite: { email: string } }>(`${orgPath}/invites`, "POST", {
          email: inviteEmail,
          role: inviteRole,
        });
        setInviteLink({ email: out.invite.email, url: `${window.location.origin}${out.path}` });
      });
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("developer");
    } catch {
      setInviteOpen(false);
    } finally {
      setInviteBusy(false);
    }
  };

  const changeRole = (m: MemberRow, role: AssignableRole) =>
    void run("change the role", () =>
      portalCall(`${orgPath}/members/${encodeURIComponent(m.userId)}`, "PATCH", { role })
    ).catch(() => {});

  const confirmPending = async () => {
    if (!pending) return;
    if (pending.kind === "remove") {
      await run("remove the member", () =>
        portalCall(`${orgPath}/members/${encodeURIComponent(pending.member.userId)}`, "DELETE")
      );
    } else if (pending.kind === "leave") {
      await run("leave the org", () => portalCall(`${orgPath}/members/${encodeURIComponent(me)}`, "DELETE"));
      router.push("/developers/classic/org");
    } else {
      await run("revoke the invite", () =>
        portalCall(`/api/developers/invites/${encodeURIComponent(pending.invite.id)}`, "DELETE")
      );
    }
  };

  const meRow = members.find((m) => m.userId === me);

  return (
    <>
      <PageHeader
        title={org.name}
        action={
          <>
            {otherOrgs.length > 0 && (
              <SelectMenu
                variant="outline"
                ariaLabel="Switch org"
                value={org.id}
                options={[{ value: org.id, label: org.name }, ...otherOrgs.map((o) => ({ value: o.id, label: o.name }))]}
                onChange={(id) => router.push(`/developers/classic/org?org=${encodeURIComponent(id)}`)}
              />
            )}
            <Link href="/developers/new" className={pillButton("outline", "md")}>
              New org
            </Link>
          </>
        }
      />

      {error && (
        <p role="alert" className={ov.note} data-tone="over">
          {error}
        </p>
      )}

      {inviteLink && (
        <Card
          title="Invite link"
          aside={
            <button type="button" className={pillButton("outline", "sm")} onClick={() => setInviteLink(null)}>
              Done
            </button>
          }
        >
          <div className="card-well flex items-center justify-between gap-3 px-3 py-2.5">
            <code className="truncate font-mono text-body text-text-primary">{inviteLink.url}</code>
            <CopyButton text={inviteLink.url} />
          </div>
          <p className={ov.note}>
            Shown once. Send it to {inviteLink.email}. It works only for that email and expires in 7 days.
          </p>
        </Card>
      )}

      <Card
        title="Projects"
        count={projects.length}
        aside={canManageProjects ? <CreateButton onClick={() => setProjectOpen(true)}>New project</CreateButton> : undefined}
      >
        {projects.length === 0 ? (
          <EmptyState variant="outline" title="No projects" />
        ) : (
          <Table columns={["Project", "API version", ""]}>
            {projects.map((p) => (
              <tr key={p.id}>
                <td className="text-text-primary">{p.name}</td>
                <td className="font-mono text-small text-text-muted">{p.apiVersion}</td>
                <td>
                  <span className="flex justify-end">
                    <Link href={`/developers/classic/keys?project=${encodeURIComponent(p.id)}&env=test`} className={pillButton("quiet", "xs")}>
                      Keys
                    </Link>
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card
        title="Members"
        count={members.length}
        aside={
          canManageMembers && grantable.length > 0 ? (
            <CreateButton onClick={() => setInviteOpen(true)}>Invite</CreateButton>
          ) : undefined
        }
      >
        <Table columns={["Email", "Role", "Joined", ""]}>
          {members.map((m) => {
            const editable = !m.isOwner && m.userId !== me && canActOn(org.role, m.role);
            const options = grantable.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
            return (
              <tr key={m.userId}>
                <td className="text-text-primary">
                  {m.email}
                  {m.userId === me && <span className="text-text-muted"> (you)</span>}
                </td>
                <td>
                  {editable && canEditMembers && m.role !== "owner" && options.some((o) => o.value === m.role) ? (
                    <SelectMenu
                      variant="bare"
                      ariaLabel={`Role for ${m.email}`}
                      value={m.role as AssignableRole}
                      options={options}
                      onChange={(role) => role !== m.role && changeRole(m, role)}
                    />
                  ) : (
                    <StatusPill>{ROLE_LABEL[m.role]}</StatusPill>
                  )}
                </td>
                <td className="whitespace-nowrap text-text-muted">{m.joined}</td>
                <td>
                  <span className="flex justify-end">
                    {editable && (
                      <button type="button" className={pillButton("quiet", "xs")} onClick={() => setPending({ kind: "remove", member: m })}>
                        Remove
                      </button>
                    )}
                    {m.userId === me && !m.isOwner && (
                      <button type="button" className={pillButton("quiet", "xs")} onClick={() => setPending({ kind: "leave" })}>
                        Leave
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </Table>
        {meRow?.isOwner && <p className={ov.note}>You own this org. The owner cannot be removed.</p>}
      </Card>

      {canManageMembers && (
        <Card title="Open invites" count={invites.length}>
          {invites.length === 0 ? (
            <EmptyState variant="outline" title="No open invites" />
          ) : (
            <Table columns={["Email", "Role", "Sent", "Status", ""]}>
              {invites.map((i) => (
                <tr key={i.id} className={i.expired ? "opacity-50" : undefined}>
                  <td className="text-text-primary">{i.email}</td>
                  <td>{ROLE_LABEL[i.role]}</td>
                  <td className="whitespace-nowrap text-text-muted">{i.sent}</td>
                  <td className="whitespace-nowrap">
                    <StatusPill tone={i.expired ? undefined : "attention"}>{i.expires}</StatusPill>
                  </td>
                  <td>
                    <span className="flex justify-end">
                      <button
                        type="button"
                        className={pillButton("quiet", "xs")}
                        onClick={() => setPending({ kind: "revoke-invite", invite: i })}
                      >
                        Revoke
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <FormDialog
        open={projectOpen}
        onDiscard={() => {
          setProjectOpen(false);
          setProjectName("");
        }}
        title="New project"
        primary={{
          label: projectBusy ? "Creating" : "Create project",
          onClick: () => void createProject(),
          busy: projectBusy,
          disabled: !projectName.trim(),
          hint: projectName.trim() ? undefined : "Name the project",
        }}
      >
        <UnderlineField
          id="project-name"
          label="Name"
          ariaLabel="Project name"
          value={projectName}
          onChange={setProjectName}
          maxLength={NAME_MAX}
          onEnter={() => void createProject()}
          autoFocus
        />
      </FormDialog>

      <FormDialog
        open={inviteOpen}
        onDiscard={() => {
          setInviteOpen(false);
          setInviteEmail("");
          setInviteRole("developer");
        }}
        title="Invite to org"
        primary={{
          label: inviteBusy ? "Creating" : "Create invite",
          onClick: () => void sendInvite(),
          busy: inviteBusy,
          disabled: !inviteEmail.trim(),
          hint: inviteEmail.trim() ? undefined : "Enter an email",
        }}
      >
        <UnderlineField
          id="invite-email"
          label="Email"
          ariaLabel="Email to invite"
          placeholder="name@company.com"
          value={inviteEmail}
          onChange={setInviteEmail}
          maxLength={320}
          autoFocus
        />
        <PillChoice
          label="Role"
          ariaLabel="Role"
          options={grantable.map((r) => ({ key: r, label: ROLE_LABEL[r], hint: ROLE_HINT[r] }))}
          value={grantable.includes(inviteRole) ? inviteRole : (grantable[0] ?? "developer")}
          onChange={setInviteRole}
        />
        <p className={ov.note}>You get a link to send. It works only for this email.</p>
      </FormDialog>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          pending?.kind === "remove"
            ? "Remove this member?"
            : pending?.kind === "leave"
              ? "Leave this org?"
              : "Revoke this invite?"
        }
        description={
          pending?.kind === "remove"
            ? `${pending.member.email} loses access to ${org.name} and its keys and logs.`
            : pending?.kind === "leave"
              ? `You lose access to ${org.name}. An owner or admin can invite you again.`
              : pending?.kind === "revoke-invite"
                ? `The link sent to ${pending.invite.email} stops working.`
                : undefined
        }
        confirmLabel={pending?.kind === "leave" ? "Leave org" : pending?.kind === "remove" ? "Remove" : "Revoke invite"}
        destructive
        onConfirm={confirmPending}
      />
    </>
  );
}
