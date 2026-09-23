"use client";

/**
 * THE SETTINGS TAB'S AGENT HALF — **THE BRIDGE-BOUND CONTAINER.**
 *
 * ⚠ **ITS OWN FILE SINCE 2026-09-21 (U8), AND THE SEAM IS A REASON TO CHANGE (INVARIANTS §1).**
 * `settings-agent.tsx` is the VIEW: it renders with no window and no bridge, which is why every
 * suite in this family drives it directly (`settings-agent-harness.tsx`). It changes when a ROW
 * changes. THIS file changes when a RECORD changes — which hooks are mounted, what each one is
 * keyed by, how a reply becomes a prop. Those two clocks came apart the day the launch group
 * stopped reading the legacy `{tools, messages, model}` pair and started reading the versioned,
 * runtime-keyed record (U5's contract, consumed through `hooks/use-launch-selection.ts`): that is
 * a change to what is READ, and the view did not move for it.
 * ⚠ The view re-exports {@link ChannelAgentSettings}, so no caller and no suite moved — the idiom
 * `main/runtime/capability.js` sets for `selection-vocabulary.js` and
 * `lib/runtime-capability.ts` for `runtime-registry.ts`.
 *
 * ⚠ **THE VIEW RENDERS WITHOUT A BRIDGE AND THAT IS NOT INCIDENTAL.** It is the property that
 * lets `settings-agent-posture.test.tsx`, `settings-agent-runtime.test.tsx` and
 * `settings-tab.test.tsx` assert what an operator SEES without a desktop. A hook added to the
 * view would take that away from all three at once.
 */

import { useChannelAgentChain } from "../hooks/use-channel-agent-chain";
import { useChannelFolder } from "../hooks/use-channel-folder";
import { useOrchestratorDirect } from "../hooks/use-orchestrator-direct";
import { useOrchestratorLaunch } from "../hooks/use-orchestrator-launch";
import { useLaunchSelection } from "../hooks/use-launch-selection";
import { type PermissionPreset } from "../lib/permission-modes";
import {
  ChannelAgentSettingsView,
} from "./settings-agent";
import type { AgentToolProfile, ChannelMember } from "../types";

export interface ChannelAgentSettingsProps {
  /** The channel's DB UUID — handed to both desktop bridges as-is. */
  channelId: string;
  /** The caller's own tool profile for THIS channel (never a teammate's). */
  profile: AgentToolProfile;
  onSetToolProfile: (profile: AgentToolProfile) => void;
  /** True while the tool-profile write is in flight. */
  toolProfileBusy: boolean;
  /**
   * The channel roster and the caller — the posture warning's third conjunct
   * (`posture-warning.tsx › warrantsPostureWarning`). Read off the roster the
   * host already holds; this surface opens NO read of its own.
   *
   * ⚠ OPTIONAL, AND ABSENT MEANS "THIS MOUNT CANNOT SAY WHO IS HERE" — which
   * warns about nothing, deliberately. A warning naming a peer who might be the
   * operator themselves is what teaches people to click the dialog away. The one
   * production mount (`channel-manage.tsx`) always passes both.
   */
  roster?: readonly ChannelMember[];
  currentUserId?: string | null;
  /**
   * **THE CHANNEL'S OWN MEMBER COUNT** — the FACT behind ruling B7's narrowing
   * (2026-09-13, F-692). `lib/tool-profile-resolve.ts › isSharedChannel` turns it
   * into "is this room shared", and `profileForChannel` then moves a stored `full`
   * to `channel_agent`, which is what the desktop will really launch.
   *
   * ⚠ **NOT THE ROSTER'S LENGTH.** `roster` is optional and defaults to `[]` for a
   * mount that cannot say who is here; using it would make an absent roster look
   * like a nine-member room with a zero count. `channel.memberCount` is the column
   * the desktop's own predicate reads (`targeting-window.js › isSharedChannel`).
   * ⚠ **ABSENT READS AS SHARED**, there and here: the only thing the answer can do
   * is remove the shell from a launch.
   */
  memberCount?: number | null;
}

/**
 * The bridge-bound half. Split from the view on the rule the deleted
 * `RequestPermissionRow` / `request-folder-row.tsx` pair also followed — they went
 * with the arm (2026-08-20), the rule did not: the view renders (and is asserted
 * on) with no window and no bridge, and this wrapper is the only thing needing one.
 */
/** ONE MAPPING FOR BOTH PER-MACHINE CONSENTS — bridge-state to row-prop. ⚠ The two
 *  hooks return the same shape and must map the same way; written out twice when the
 *  second consent landed (2026-09-16), which is two places for "an absent bridge
 *  renders NO ROW" to be got right and one of them to later be got wrong. */
function consentRow(state: {
  bridge: unknown; enabled: boolean; busy: boolean; update: (next: boolean) => Promise<void>;
}) {
  return state.bridge
    ? { on: state.enabled, busy: state.busy, onToggle: (n: boolean) => void state.update(n) }
    : null;
}

export function ChannelAgentSettings(props: ChannelAgentSettingsProps) {
  // ⚠ **THE VERSIONED, RUNTIME-KEYED RECORD SINCE 2026-09-21 (U8), NOT THE LEGACY PAIR.**
  // `useChannelLaunchPosture` reads `{tools, messages}` — the SELECTED runtime's pair — which
  // cannot express the one thing this tab is now about: Claude's and Codex's
  // settings sitting side by side, untranslated (Decisions #1 and #2). It also rewrote the whole
  // pair on every write, so a runtime switch re-sent the OLD runtime's `accept_edits` under the
  // NEW runtime and `patchRejections` refused the write with nothing on screen saying why.
  // ⚠ THAT HOOK IS NOT DELETED — four read-only surfaces still mount it for a descriptor.
  const launchSelection = useLaunchSelection({ kind: "channel", channelId: props.channelId });
  const folder = useChannelFolder(props.channelId);
  // ⚠ PER CHANNEL, unlike the machine-wide toggle below it (Samuel, 2026-08-31).
  const agentChain = useChannelAgentChain(props.channelId);
  // ⚠ NO `channelId` — this one is per-MACHINE (`use-orchestrator-launch.ts`).
  const orchestrator = useOrchestratorLaunch();
  // ⚠ ALSO PER-MACHINE, and a DIFFERENT record from the one above.
  const orchestratorDirect = useOrchestratorDirect();

  return (
    <ChannelAgentSettingsView
      profile={props.profile}
      onSetToolProfile={props.onSetToolProfile}
      toolProfileBusy={props.toolProfileBusy}
      roster={props.roster}
      currentUserId={props.currentUserId}
      memberCount={props.memberCount}
      // ⚠ THE PAIR IS DERIVED FROM THE ONE RECORD, never read a second time. It exists for the
      // WARNING's `messageMode` conjunct and for the "is there a bridge" gate; every control
      // below reads `selection` directly.
      posture={
        launchSelection.bridge
          ? {
              tools: (launchSelection.record.tools ?? "manual") as PermissionPreset["tools"],
              messages: launchSelection.messages as PermissionPreset["messages"],
            }
          : null
      }
      postureBusy={launchSelection.busy}
      // ⚠ NO `model` TO MAP SINCE 2026-09-23 — the patch is the pair (and runtime), passed
      // through own-key.
      onChangePosture={(patch) => void launchSelection.update(patch)}
      selection={launchSelection}
      folder={
        folder.bridge
          ? {
              label: folder.label,
              custom: folder.custom,
              busy: folder.busy,
              onChoose: () => void folder.choose(),
              onClear: () => void folder.clear(),
            }
          : null
      }
      agentChain={
        agentChain.bridge
          ? {
              on: agentChain.on,
              busy: agentChain.busy,
              onToggle: (next) => void agentChain.update(next),
            }
          : null
      }
      orchestrator={consentRow(orchestrator)}
      orchestratorDirect={consentRow(orchestratorDirect)}
    />
  );
}


