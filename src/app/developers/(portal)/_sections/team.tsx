"use client";

/**
 * Team: who has access, what each role can do. An internal org's people are managed by hand, so it shows
 * who is there and offers nothing to change. No email is sent: an invite is a link to copy. Removing has
 * no undo, because that would hand access back without an invite.
 */
import { Check, FolderPlus, Minus, Plus, SearchX, Trash2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLE_LABEL, canActOn, canAssignRole, type PortalRole } from "@/features/device-sdk/portal/scope";
import type { InviteView, MemberView } from "@/features/device-sdk/portal/view";
import { errorText, portalCall } from "../../_lib/client-api";
import { Badge, Button, DataCell, DataRow, DataTable, ICON, ICON_SM, Initials, PillMenu, SearchField, Segmented, TwoLine, initialsOf, type Column } from "../_design/ui";
import { FillCard, ScrollArea, SplitLayout } from "../_design/ui-output";
import { ConfirmDialog } from "../_design/ui-overlay";
import { EmptyState, Grow, Mark, Page, PageHeader, PlainButton, Row, TableHead, Text, Toast } from "../_design/ui-page";
import { portalNow, since } from "../_components/format";
import { usePortal } from "../_components/portal-store";
import { useNotice } from "../_components/use-notice";
import { InviteFlow, NewProjectFlow, ROLES } from "./team-flows";

const POWERS: { name: string; roles: PortalRole[] }[] = [
  { name: "View activity, users and usage", roles: ["owner", "admin", "developer"] },
  { name: "Manage API keys and webhooks", roles: ["owner", "admin"] },
  { name: "Create projects", roles: ["owner", "admin"] },
  { name: "Invite and remove members", roles: ["owner", "admin"] },
];
const QUIET_DAYS = 7;
const VIEWS = ["All", "Invited"];
const COLUMNS: Column[] = [
  { key: "name", label: "Member", width: "42%" },
  { key: "role", label: "Role", width: "24%" },
  { key: "active", label: "Last active", width: "17%" },
  { key: "status", label: "Status", width: "17%" },
  { key: "actions", srLabel: "Actions", width: "calc(95 * var(--u))" },
];
const MATRIX: Column[] = [{ key: "power", label: "Permission", width: "52%" }, ...ROLES.map((r) => ({ key: r.role, label: ROLE_LABEL[r.role], width: "16%", align: "center" as const }))];
const quiet = (m: MemberView) => m.lastActiveAt !== null && portalNow() - Date.parse(m.lastActiveAt) > QUIET_DAYS * 86_400_000;

export function TeamSection({ members, invites }: { members: MemberView[]; invites: InviteView[] }) {
  const router = useRouter();
  const { project, canInvite, canManage } = usePortal();
  const internal = project.org.internal;
  const myRole = project.role;
  const orgId = project.org.id;
  const [adding, setAdding] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [removing, setRemoving] = useState<MemberView | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState(0);
  const { notice, say } = useNotice();
  const act = async (run: () => Promise<unknown>, done: string, fallback: string) => {
    try {
      await run();
      say(done);
      router.refresh();
    } catch (e) {
      say(errorText(e, fallback));
    }
  };

  const needle = q.toLowerCase();
  const shown = view === 0 ? members.filter((m) => `${m.email ?? ""} ${m.role}`.toLowerCase().includes(needle)) : [];
  const pending = invites.filter((i) => i.email.includes(needle));
  const setRole = (m: MemberView, role: string) => act(() => portalCall(`/api/developers/orgs/${orgId}/members/${m.userId}`, "PATCH", { role }), "Role changed", "Could not change this role.");

  return (
    <Page
      fit
      overlays={
        <>
          {adding && (
            <InviteFlow
              onClose={() => {
                setAdding(false);
                router.refresh();
              }}
            />
          )}
          {newProject && <NewProjectFlow onClose={() => setNewProject(false)} />}
          {removing && (
            <ConfirmDialog
              label={`Remove ${removing.email ?? "member"}`}
              mark={<Mark icon={Trash2} tone="danger" />}
              title={`Remove ${removing.email ?? "this member"}?`}
              sub={`${ROLE_LABEL[removing.role]}. Keys they made keep working.`}
              onCancel={() => setRemoving(null)}
              action={
                <Button
                  full
                  variant="dangerFlat"
                  onClick={() => {
                    const gone = removing;
                    setRemoving(null);
                    void act(() => portalCall(`/api/developers/orgs/${orgId}/members/${gone.userId}`, "DELETE"), "Member removed", "Could not remove this member.");
                  }}
                >
                  Remove
                </Button>
              }
            />
          )}
          {notice && <Toast>{notice}</Toast>}
        </>
      }
    >
      <PageHeader
        title="Team"
        action={
          !internal && (
            <Row>
              {canManage && (
                <Button onClick={() => setNewProject(true)}>
                  <FolderPlus {...ICON} aria-hidden="true" />
                  New project
                </Button>
              )}
              {canInvite && (
                <Button variant="ink" onClick={() => setAdding(true)}>
                  <Plus {...ICON} aria-hidden="true" />
                  Invite member
                </Button>
              )}
            </Row>
          )
        }
      />

      <SplitLayout
        lead
        left={
          <FillCard flush>
            <TableHead>
              <SearchField hug value={q} placeholder="Search members" onChange={setQ} />
              {!internal && <Segmented label="Member views" options={VIEWS} value={view} onChange={setView} />}
            </TableHead>
            {shown.length === 0 && pending.length === 0 ? (
              <EmptyState icon={SearchX} title={view === 1 && q === "" ? "No pending invites" : "No members match"} action={<Button onClick={() => { setQ(""); setView(0); }}>Show all members</Button>} />
            ) : (
              <ScrollArea>
                <DataTable columns={COLUMNS}>
                  {shown.map((m) => {
                    const manageable = !internal && !m.isOwner && canActOn(myRole, m.role);
                    const grants = ROLES.filter((r) => canAssignRole(myRole, r.role));
                    const name = m.email ?? m.userId;
                    return (
                      <DataRow key={m.userId}>
                        <DataCell>
                          <Initials text={initialsOf(name)} />
                          <TwoLine title={name} sub={m.isYou ? "You" : undefined} />
                        </DataCell>
                        <DataCell open>
                          {manageable && grants.length > 1 ? <PillMenu stable label={ROLE_LABEL[m.role]} value={m.role} options={grants.map((r) => ({ value: r.role, label: ROLE_LABEL[r.role] }))} onChange={(role) => void setRole(m, role)} /> : <Text>{ROLE_LABEL[m.role]}</Text>}
                        </DataCell>
                        <DataCell>
                          <Text nowrap>{since(m.lastActiveAt)}</Text>
                        </DataCell>
                        <DataCell>{quiet(m) ? <Badge>Inactive</Badge> : <Badge tone="ok" dot>Active</Badge>}</DataCell>
                        <DataCell align="end">
                          {(manageable || (m.isYou && !m.isOwner)) && (
                            <PlainButton label={`Remove ${name}`} onClick={() => setRemoving(m)}>
                              <Trash2 {...ICON} aria-hidden="true" />
                            </PlainButton>
                          )}
                        </DataCell>
                      </DataRow>
                    );
                  })}
                  {pending.map((i) => (
                    <DataRow key={i.id}>
                      <DataCell>
                        <Mark icon={UserRound} />
                        <TwoLine title={i.email} sub={i.expired ? "Invite expired" : "Invited"} />
                      </DataCell>
                      <DataCell>
                        <Text>{ROLE_LABEL[i.role as PortalRole] ?? i.role}</Text>
                      </DataCell>
                      <DataCell>
                        <Text kind="faint">Never</Text>
                      </DataCell>
                      <DataCell>
                        <Badge tone="warn">{i.expired ? "Expired" : "Invited"}</Badge>
                      </DataCell>
                      <DataCell align="end">
                        <PlainButton label={`Revoke invite to ${i.email}`} onClick={() => void act(() => portalCall(`/api/developers/invites/${i.id}`, "DELETE"), "Invite revoked", "Could not revoke this invite.")}>
                          <Trash2 {...ICON} aria-hidden="true" />
                        </PlainButton>
                      </DataCell>
                    </DataRow>
                  ))}
                </DataTable>
              </ScrollArea>
            )}
          </FillCard>
        }
        right={
          <FillCard flush>
            <TableHead>
              <Text kind="h3">What each role can do</Text>
              <Grow />
            </TableHead>
            <ScrollArea>
              <DataTable columns={MATRIX}>
                {POWERS.map((p) => (
                  <DataRow key={p.name}>
                    <DataCell>
                      <Text>{p.name}</Text>
                    </DataCell>
                    {ROLES.map((r) => (
                      <DataCell key={r.role} align="center">
                        {p.roles.includes(r.role) ? <Check {...ICON_SM} aria-label="Allowed" /> : <Minus {...ICON_SM} aria-label="Not allowed" opacity={0.3} />}
                      </DataCell>
                    ))}
                  </DataRow>
                ))}
              </DataTable>
            </ScrollArea>
          </FillCard>
        }
      />
    </Page>
  );
}
