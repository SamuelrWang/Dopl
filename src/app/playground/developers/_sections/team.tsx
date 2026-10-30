"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { CreateButton, pillButton } from "@/shared/ui/pill-button";
import { SelectMenu } from "@/shared/ui/select-menu";
import { DialogActions, StandardDialog } from "@/shared/ui/standard-dialog";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { minsAgo, type Member } from "../_data/company";
import { usePortal } from "../_components/portal-store";
import { PortalPage, RowList, UserFace, ov, since } from "../_components/ui";

const ROLES: Member["role"][] = ["Owner", "Admin", "Developer", "Viewer"];

export function TeamSection() {
  const { state, update } = usePortal();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const invite = () => {
    const name = email.split("@")[0];
    update((s) => ({ ...s, members: [...s.members, { id: `mem_${s.members.length + 1}`, name, email, role: "Developer", lastActive: minsAgo(0) }] }));
    setOpen(false);
    setEmail("");
  };
  return (
    <PortalPage title="Team" meta={<span>{state.members.length} members</span>} actions={<CreateButton onClick={() => setOpen(true)}>Invite member</CreateButton>}>
      <RowList>
        {state.members.map((m) => (
          <li key={m.id} className={cn(ov.row, "border-t border-border-default first:border-t-0")}>
            <UserFace name={m.name} />
            <span className={ov.rowMain}>
              <span className={ov.rowTitle}>{m.name}</span>
              <span className={ov.rowMeta}>{m.email}</span>
            </span>
            <span className={ov.rowAside}>Active {since(m.lastActive)}</span>
            <SelectMenu
              variant="outline"
              ariaLabel={`Role for ${m.name}`}
              value={m.role}
              options={ROLES.map((r) => ({ value: r, label: r }))}
              onChange={(role) => update((s) => ({ ...s, members: s.members.map((x) => (x.id === m.id ? { ...x, role } : x)) }))}
            />
          </li>
        ))}
      </RowList>
      <StandardDialog open={open} onClose={() => setOpen(false)} title="Invite member">
        <input aria-label="Email" placeholder="name@larkfield.example" value={email} onChange={(e) => setEmail(e.target.value)} className={cn(RAISED_INPUT, "h-8 px-3")} />
        <DialogActions>
          <button type="button" className={pillButton("quiet", "md")} onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button" disabled={!email.includes("@")} className={cn(pillButton("ink", "md"), "disabled:opacity-60")} onClick={invite}>
            Send invite
          </button>
        </DialogActions>
      </StandardDialog>
    </PortalPage>
  );
}
