"use client";

/**
 * New Agent dialog state. The agent id is minted before the spawn and forwarded on launch; main's
 * reply still wins. Name/description are metadata written after the spawn, never payload.
 */

import { useCallback, useRef, useState } from "react";
import { getSpaBridge } from "@/shared/lib/spa-bridge";
import type { AgentColorKey } from "../types";
import { AGENT_MODEL_DEFAULT } from "../lib/agent-models";

/** One fresh instance id from main, or `null` when this build cannot mint one. Detects
 *  `sessions.mintAgentId`, never `sessions.launch`: every build has launch, and older ones drop
 *  the forwarded id. */
export async function mintAgentId(): Promise<string | null> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.mintAgentId !== "function") return null;
  // A failed mint is "no pre-assigned id" — the launch reply supplies one.
  const res = await sessions.mintAgentId().catch(() => null);
  return typeof res?.agentId === "string" && res.agentId ? res.agentId : null;
}

/** Store what the operator calls this agent. `''` clears it. */
export async function renameAgent(agentId: string, name: string): Promise<boolean> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.rename !== "function") return false;
  return (await sessions.rename(agentId, name))?.ok === true;
}

/** Store what the operator says this agent is for. `''` clears it. */
export async function describeAgent(agentId: string, description: string): Promise<boolean> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.describe !== "function") return false;
  return (await sessions.describe(agentId, description))?.ok === true;
}

/** What an identity prefills — a structural shape, not `AgentIdentity`; the rest rides the id. */
export interface AgentIdentityPrefill {
  id: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
}

export interface AgentLaunchPanel {
  open: boolean;
  /** The pre-assigned address, or `null` on a build that cannot pre-assign. */
  agentId: string | null;
  name: string;
  description: string;
  /** Optional members are absent on hand-built panel literals (`oldPanelState` in the tests). */
  instructions?: string;
  setInstructions?: (next: string) => void;
  /** Last text `applyIdentity` wrote to `instructions`; an override is sent only if they differ. */
  instructionsBaseline?: string;
  /** `null` is a BLANK agent — the identity selector's first option. */
  identityId: string | null;
  /** `AGENT_MODEL_DEFAULT` (`""`) until the operator picks — main's order decides. */
  model: string;
  /** The Runtime row's explicit pick, or `''` — none, so the dialog's preselect chain decides. */
  runtime: string;
  /** `null` = nobody chose (not "no colour"): the payload omits it and the server assigns. */
  color?: AgentColorKey | null;
  setColor?: (next: AgentColorKey) => void;
  /** A rename/describe that main refused AFTER the agent started. Never a launch failure. */
  identityError: string | null;
  setIdentityError: (next: string | null) => void;
  setName: (next: string) => void;
  setDescription: (next: string) => void;
  setIdentityId: (next: string | null) => void;
  setModel: (next: string) => void;
  setRuntime: (next: string) => void;
  /** Select + prefill Name/Description/Instructions; `null` (None) prefills nothing. */
  applyIdentity?: (identity: AgentIdentityPrefill | null) => void;
  /** Open (if shut) and apply — not `toggle`, which would close an open dialog. */
  openWithIdentity?: (identity: AgentIdentityPrefill | null) => void;
  toggle: () => void;
  close: () => void;
  reset: () => void;
}

export function useAgentLaunch(): AgentLaunchPanel {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [name, setNameState] = useState("");
  const [description, setDescriptionState] = useState("");
  const [instructions, setInstructionsState] = useState("");
  const [instructionsBaseline, setInstructionsBaseline] = useState("");
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [model, setModel] = useState<string>(AGENT_MODEL_DEFAULT);
  const [runtime, setRuntime] = useState<string>("");
  const [color, setColor] = useState<AgentColorKey | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  // Fields the operator edited since the last prefill. Only the public setters set it; the hook's
  // own prefill writes use the raw `useState` setters.
  const touched = useRef({ name: false, description: false, instructions: false });

  const setName = useCallback((next: string) => {
    touched.current.name = true;
    setNameState(next);
  }, []);
  const setDescription = useCallback((next: string) => {
    touched.current.description = true;
    setDescriptionState(next);
  }, []);
  const setInstructions = useCallback((next: string) => {
    touched.current.instructions = true;
    setInstructionsState(next);
  }, []);

  const reset = useCallback(() => {
    setOpen(false);
    setAgentId(null);
    setNameState("");
    setDescriptionState("");
    setInstructionsState("");
    setInstructionsBaseline("");
    touched.current = { name: false, description: false, instructions: false };
    setIdentityId(null);
    setModel(AGENT_MODEL_DEFAULT);
    setRuntime("");
    setColor(null);
    setIdentityError(null);
  }, []);

  // The mint must not run inside a `setState` updater (StrictMode double-invokes → two ids).
  const openPanel = useCallback(() => {
    setOpen(true);
    setIdentityError(null);
    void mintAgentId().then((minted) => {
      if (!minted) return;
      setAgentId(minted);
    });
  }, []);

  // Closing is discarding: `toggle`, `close` and the dialog's discard all go through `reset`.
  const toggle = useCallback(() => {
    if (open) {
      reset();
      return;
    }
    openPanel();
  }, [open, openPanel, reset]);

  // Never overwrites a field the operator edited since the last prefill (`touched`). Model is
  // deliberately not prefilled: `panel.model` stays `''` so main's order decides.
  const applyIdentity = useCallback((identity: AgentIdentityPrefill | null) => {
    setIdentityId(identity?.id ?? null);
    if (!identity) return;
    const nextInstructions = identity.instructions ?? "";
    if (!touched.current.name) setNameState(identity.name);
    if (!touched.current.description) setDescriptionState(identity.description ?? "");
    if (!touched.current.instructions) setInstructionsState(nextInstructions);
    // The baseline moves with the identity even when the field did not.
    setInstructionsBaseline(nextInstructions);
  }, []);

  const openWithIdentity = useCallback(
    (identity: AgentIdentityPrefill | null) => {
      if (!open) openPanel();
      applyIdentity(identity);
    },
    [open, openPanel, applyIdentity]
  );

  return {
    open,
    agentId,
    name,
    description,
    instructions,
    instructionsBaseline,
    identityId,
    model,
    runtime,
    color,
    setColor,
    identityError,
    setIdentityError,
    setName,
    setDescription,
    setInstructions,
    setIdentityId,
    setModel,
    setRuntime,
    applyIdentity,
    openWithIdentity,
    toggle,
    // One close path: `reset`, never a bare `setOpen(false)`.
    close: reset,
    reset,
  };
}
