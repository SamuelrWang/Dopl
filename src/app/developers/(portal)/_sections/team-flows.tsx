"use client";

/** Team's two popups: a new project, and an invite, which is a link to copy because no email is sent. */
import { AlertTriangle, Code2, Crown, Shield, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { ROLE_LABEL, canAssignRole, type PortalRole } from "@/features/device-sdk/portal/scope";
import { errorText, portalCall } from "../../_lib/client-api";
import { Button, TwoLine } from "../_design/ui";
import { DoneFoot, FlowDialog, Tile, Tiles } from "../_design/ui-overlay";
import { Alert, CopyWell, Grow, Mark, ProblemAlert, Stack, TextField } from "../_design/ui-page";
import { usePortal } from "../_components/portal-store";

export const ROLES: { role: PortalRole; icon: LucideIcon; sub: string }[] = [
  { role: "owner", icon: Crown, sub: "Everything" },
  { role: "admin", icon: Shield, sub: "Keys, webhooks and people below them" },
  { role: "developer", icon: Code2, sub: "Reads logs and keys" },
];
export function NewProjectFlow({ onClose }: { onClose: () => void }) {
  const { project, setProject } = usePortal();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const create = async () => {
    if (busy || name.trim() === "") return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await portalCall<{ projectId: string }>(`/api/developers/orgs/${project.org.id}/projects`, "POST", { name: name.trim() });
      setProject(made.projectId);
      onClose();
    } catch (e) {
      setProblem(errorText(e, "Could not create this project."));
      setBusy(false);
    }
  };
  return (
    <FlowDialog
      label="New project"
      eyebrow={project.org.name}
      title="Name this project"
      onDismiss={onClose}
      foot={
        <>
          <Grow />
          <Button variant="ink" loading={busy} disabled={name.trim() === ""} onClick={() => void create()}>
            Create project
          </Button>
        </>
      }
    >
      <Stack>
        <TextField autoFocus label="Project name" placeholder="Production" value={name} onChange={setName} onEnter={() => void create()} />
        <ProblemAlert problem={problem} />
      </Stack>
    </FlowDialog>
  );
}

export function InviteFlow({ onClose }: { onClose: () => void }) {
  const { project } = usePortal();
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PortalRole | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const valid = /^\S+@\S+\.\S+$/.test(email);
  const invite = async () => {
    if (!role) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await portalCall<{ path: string }>(`/api/developers/orgs/${project.org.id}/invites`, "POST", { email: email.trim(), role });
      setLink(`${window.location.origin}${made.path}`);
    } catch (e) {
      setProblem(errorText(e, "Could not create this invite."));
    } finally {
      setBusy(false);
    }
  };
  if (link) {
    return (
      <FlowDialog
        label="Invite link"
        eyebrow={email}
        title="Copy the invite link"
        onDismiss={null}
        foot={<DoneFoot onDone={onClose} />}
      >
        <Stack>
          <CopyWell value={link} label="Copy link" />
          <Alert tone="warn" icon={AlertTriangle}>
            Shown once. No email is sent.
          </Alert>
        </Stack>
      </FlowDialog>
    );
  }
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
            <Button variant="ink" loading={busy} disabled={!role} onClick={() => void invite()}>
              Create invite
            </Button>
          )}
        </>
      }
    >
      {step === 0 ? (
        <Stack>
          <TextField autoFocus label="Email" placeholder="name@company.com" value={email} onChange={setEmail} onEnter={() => valid && setStep(1)} />
        </Stack>
      ) : (
        <Stack>
          <Tiles>
            {ROLES.filter((r) => canAssignRole(project.role, r.role)).map((r) => (
              <Tile key={r.role} selected={role === r.role} onClick={() => setRole(r.role)}>
                <Mark icon={r.icon} />
                <TwoLine title={ROLE_LABEL[r.role]} sub={r.sub} />
              </Tile>
            ))}
          </Tiles>
          <ProblemAlert problem={problem} />
        </Stack>
      )}
    </FlowDialog>
  );
}
