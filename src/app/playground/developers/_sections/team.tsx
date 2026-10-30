"use client";

/** Team: who has access, what each role can do, and who needs a look. */
import { Check, Minus, Plus, RotateCcw, SearchX, Shield, Trash2, UserRound, Code2, Eye, Crown } from "lucide-react";
import { useState } from "react";
import { Badge, Button, DataCell, DataRow, DataTable, ICON, ICON_SM, Initials, PillMenu, SearchField, Segmented, TwoLine, initialsOf, type Column } from "../_design/ui";
import { FillCard, ScrollArea, SplitLayout } from "../_design/ui-output";
import { ConfirmDialog, EmptyState, FlowDialog, Grow, Mark, Page, PageHeader, PlainButton, Row, Stack, TableHead, Text, TextField, Tile, Tiles, Toast } from "../_design/ui-page";
import { minsAgo, type Member } from "../_data/company";
import { usePortal } from "../_components/portal-store";
import { since } from "../_components/ui";

type Role = Member["role"];
const ROLES: { role: Role; icon: typeof Crown; sub: string }[] = [
  { role: "Owner", icon: Crown, sub: "Everything, including billing" },
  { role: "Admin", icon: Shield, sub: "Everything except billing" },
  { role: "Developer", icon: Code2, sub: "Build and test" },
  { role: "Viewer", icon: Eye, sub: "Read only" },
];
const INVITABLE = ROLES.filter((r) => r.role !== "Owner");
const POWERS: { name: string; roles: Role[] }[] = [
  { name: "View activity and usage", roles: ["Owner", "Admin", "Developer", "Viewer"] },
  { name: "Send test deliveries", roles: ["Owner", "Admin", "Developer"] },
  { name: "Manage devices and rules", roles: ["Owner", "Admin", "Developer"] },
  { name: "Manage API keys and webhooks", roles: ["Owner", "Admin"] },
  { name: "Invite and remove members", roles: ["Owner", "Admin"] },
  { name: "Change plan and billing", roles: ["Owner"] },
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
const MATRIX: Column[] = [{ key: "power", label: "Permission", width: "44%" }, ...ROLES.map((r) => ({ key: r.role, label: r.role, width: "14%", align: "center" as const }))];

interface Invite {
  id: string;
  email: string;
  role: Role;
  sentAt: string;
}
const SEED_INVITES: Invite[] = [{ id: "inv_1", email: "sana@larkfield.example", role: "Developer", sentAt: minsAgo(4320) }];
const quiet = (m: Member) => Date.parse(minsAgo(0)) - Date.parse(m.lastActive) > QUIET_DAYS * 86_400_000;

export function TeamSection() {
  const { state, update } = usePortal();
  const [invites, setInvites] = useState(SEED_INVITES);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const say = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((now) => (now === text ? null : now)), 3200);
  };

  const needle = q.toLowerCase();
  const members = view === 0 ? state.members.filter((m) => `${m.name} ${m.email} ${m.role}`.toLowerCase().includes(needle)) : [];
  const pending = invites.filter((i) => i.email.includes(needle));
  const keysBy = (name: string) => state.keys.filter((k) => k.createdBy === name && !k.revoked).length;
  const owners = state.members.filter((m) => m.role === "Owner").length;
  const setRole = (id: string, role: Role) => update((s) => ({ ...s, members: s.members.map((m) => (m.id === id ? { ...m, role } : m)) }));

  return (
    <Page
      fit
      overlays={
        <>
          {adding && (
            <InviteFlow
              onClose={() => setAdding(false)}
              onInvite={(email, role) => {
                setInvites((all) => [...all, { id: `inv_${email}`, email, role, sentAt: minsAgo(0) }]);
                say(`Invite sent to ${email}`);
              }}
            />
          )}
          {removing && (
            <ConfirmDialog
              label={`Remove ${removing.name}`}
              mark={<Mark icon={Trash2} tone="danger" />}
              title={`Remove ${removing.name}?`}
              sub={`${removing.role}, ${keysBy(removing.name)} API keys keep working`}
              onCancel={() => setRemoving(null)}
              action={
                <Button
                  full
                  variant="dangerFlat"
                  onClick={() => {
                    update((s) => ({ ...s, members: s.members.filter((m) => m.id !== removing.id) }));
                    say(`${removing.name} removed`);
                    setRemoving(null);
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
          <Button variant="ink" onClick={() => setAdding(true)}>
            <Plus {...ICON} aria-hidden="true" />
            Invite member
          </Button>
        }
      />

      <SplitLayout
        lead
        left={
          <FillCard flush>
            <TableHead>
              <SearchField hug value={q} placeholder="Search members" onChange={setQ} />
              <Segmented label="Member views" options={VIEWS} value={view} onChange={setView} />
            </TableHead>
            {members.length === 0 && pending.length === 0 ? (
              <EmptyState icon={SearchX} title={view === 1 && q === "" ? "No pending invites" : "No members match"} action={<Button onClick={() => { setQ(""); setView(0); }}>Show all members</Button>} />
            ) : (
              <ScrollArea>
          <DataTable columns={COLUMNS}>
            {members.map((m) => (
              <DataRow key={m.id}>
                <DataCell>
                  <Initials text={initialsOf(m.name)} />
                  <TwoLine title={m.name} sub={m.email} />
                </DataCell>
                <DataCell open>
                  {m.role === "Owner" && owners === 1 ? <Text>Owner</Text> : <PillMenu stable label={m.role} value={m.role} options={ROLES.map((r) => ({ value: r.role, label: r.role }))} onChange={(role) => setRole(m.id, role as Role)} />}
                </DataCell>
                <DataCell>
                  <Text nowrap>{since(m.lastActive)}</Text>
                </DataCell>
                <DataCell>
                  {quiet(m) ? <Badge>Inactive</Badge> : <Badge tone="ok" dot>Active</Badge>}
                </DataCell>
                <DataCell align="end">
                  {!(m.role === "Owner" && owners === 1) && (
                    <PlainButton label={`Remove ${m.name}`} onClick={() => setRemoving(m)}>
                      <Trash2 {...ICON} aria-hidden="true" />
                    </PlainButton>
                  )}
                </DataCell>
              </DataRow>
            ))}
            {pending.map((i) => (
              <DataRow key={i.id}>
                <DataCell>
                  <Mark icon={UserRound} />
                  <TwoLine title={i.email} sub="Invited" />
                </DataCell>
                <DataCell>
                  <Text>{i.role}</Text>
                </DataCell>
                <DataCell>
                  <Text kind="faint">Never</Text>
                </DataCell>
                <DataCell>
                  <Badge tone="warn">Invited</Badge>
                </DataCell>
                <DataCell align="end">
                  <Row>
                    <PlainButton label={`Resend to ${i.email}`} onClick={() => say(`Invite resent to ${i.email}`)}>
                      <RotateCcw {...ICON} aria-hidden="true" />
                    </PlainButton>
                    <PlainButton label={`Revoke invite to ${i.email}`} onClick={() => setInvites((all) => all.filter((x) => x.id !== i.id))}>
                      <Trash2 {...ICON} aria-hidden="true" />
                    </PlainButton>
                  </Row>
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

function InviteFlow({ onClose, onInvite }: { onClose: () => void; onInvite: (email: string, role: Role) => void }) {
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const valid = /^\S+@\S+\.\S+$/.test(email);
  const send = () => {
    if (!role) return;
    onInvite(email.trim(), role);
    onClose();
  };
  return (
    <FlowDialog
      label="Invite member"
      eyebrow={`Step ${step + 1} of 2`}
      title={step === 0 ? "Who are you inviting?" : "Choose a role"}
      progress={{ step, of: 2 }}
      onDismiss={onClose}
      foot={
        <>
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep(0)}>
              Back
            </Button>
          )}
          <Grow />
          {step === 0 ? (
            <Button variant="ink" disabled={!valid} onClick={() => setStep(1)}>
              Continue
            </Button>
          ) : (
            <Button variant="ink" disabled={!role} onClick={send}>
              Send invite
            </Button>
          )}
        </>
      }
    >
      {step === 0 ? (
        <Stack>
          <TextField autoFocus label="Email" placeholder="name@larkfield.example" value={email} onChange={setEmail} onEnter={() => valid && setStep(1)} />
        </Stack>
      ) : (
        <Tiles>
          {INVITABLE.map((r) => (
            <Tile key={r.role} selected={role === r.role} onClick={() => setRole(r.role)}>
              <Mark icon={r.icon} />
              <TwoLine title={r.role} sub={r.sub} />
            </Tile>
          ))}
        </Tiles>
      )}
    </FlowDialog>
  );
}
