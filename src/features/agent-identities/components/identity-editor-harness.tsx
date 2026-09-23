// Identity fixtures and the editor mount for the agent-identities suites. Deliberately not a
// `*.test.tsx` name: vitest imports it and never collects it.

import type { ComponentProps } from "react";
import { vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AgentIdentity } from "../client/types";
import type { IdentityDraft } from "../lib/identity-draft";
import { IdentityEditor } from "./identity-editor";

export const TEAMS = [
  { id: "team-1", name: "Platform" },
  { id: "team-2", name: "Growth" },
];
export const BASES = [
  { id: "kb-1", name: "Runbooks" },
  { id: "kb-2", name: "Specs" },
];
export const CREATE_VERB = "Create";

/** A row with every optional unset. */
export function identity(over: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    id: "id-1",
    workspaceId: "ws-1",
    name: "Release captain",
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

/** A row with the editor's controls filled: prose, a model, one field, one attached base. */
export function filledIdentity(over: Partial<AgentIdentity> = {}): AgentIdentity {
  return identity({
    description: "Runs the checklist",
    instructions: "Be terse.",
    model: "claude-opus-5",
    fields: [{ key: "repo", value: "dopl" }],
    knowledgeBases: [{ id: "kb-1", name: "Runbooks" }],
    knowledge: [{ baseId: "kb-1", baseName: "Runbooks", scope: "base", path: "Runbooks" }],
    ...over,
  });
}

/** Awaited: `ModalShell` mounts its frame a render after `open` flips. */
export async function open(over: Partial<ComponentProps<typeof IdentityEditor>> = {}) {
  const onSave = vi.fn();
  const onDelete = vi.fn();
  render(
    <IdentityEditor
      open
      workspaceId="ws-1"
      session={1}
      identity={null}
      teams={TEAMS}
      knowledgeBases={BASES}
      saving={false}
      deleting={false}
      error={null}
      onClose={vi.fn()}
      onSave={onSave}
      onDelete={onDelete}
      {...over}
    />
  );
  await screen.findByRole("dialog");
  return { onSave, onDelete, draft: () => onSave.mock.calls[0][0] as IdentityDraft };
}

export const field = (selector: string) =>
  document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;

export const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

/** Runtime, Model and Visibility are all `PillChoice` tablists, so a pill lookup is scoped to its row. */
export const row = (name: string) => within(screen.getByRole("tablist", { name }));

export const pick = (rowName: string, label: string) =>
  fireEvent.click(row(rowName).getByRole("tab", { name: label }));

export const tabLabels = (rowName: string) =>
  row(rowName)
    .getAllByRole("tab")
    .map((t) => t.textContent);

/** Fill the first empty field row, pressing "New field" only when none is (a new identity opens on one). */
export function addField(key: string, value: string) {
  const keys = () =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input[aria-label$=" key"]'));
  let at = keys().findIndex((input) => input.value === "");
  if (at === -1) {
    press("New field");
    at = keys().length - 1;
  }
  fireEvent.change(keys()[at], { target: { value: key } });
  fireEvent.change(field(`input[aria-label="Field ${at + 1} value"]`), { target: { value } });
}
