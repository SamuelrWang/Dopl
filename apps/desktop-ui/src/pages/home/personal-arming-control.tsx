import { useApiQuery } from "@/shared/hooks/use-api-query";
import { useApiMutation } from "@/shared/hooks/use-api-mutation";
import { apiPathKey } from "@/shared/api/query-keys";

/**
 * 🔒 **ARMING THIS ROOM FOR YOUR PERSONAL SHELF** — the app control for task
 * 11's switch (design #1077, approved #1080), over
 * `/api/channels/{id}/personal-arming`.
 *
 * ⚠ **IT IS THE SHIPPING GATE, WHICH IS WHY IT SITS HERE AND NOT IN SETTINGS.**
 * The fence closed every shared room the moment it landed; without a control the
 * change is one people cannot undo. It belongs beside the Personal shelf because
 * that is the thing it opens — a switch filed under settings is a switch nobody
 * connects to the empty list that sent them looking.
 *
 * ⚠ **IT SAYS WHOSE AGENTS AND WHICH ROOM, because both halves are the ruling.**
 * Arming is per (room, owner): it opens YOUR shelf to YOUR OWN agent sessions in
 * THIS channel, and it never lends anything to the other member or to theirs.
 * Copy that said only "allow agents" would read as a peer-facing permission.
 *
 * ⚠ **NO STATE WHILE THE READ IS IN FLIGHT.** An unresolved query rendered as
 * "off" is a claim about a switch nobody has looked at, and it is the claim that
 * would make somebody press it twice.
 *
 * ⚠ **A PERSON ONLY.** The server refuses `source === "agent"` outright — an
 * agent may not open its own reach — so this control exists for the operator and
 * there is no agent-facing equivalent to build later.
 */
export function PersonalArmingControl({
  channelId,
  workspaceId,
}: {
  channelId: string;
  /** The CHANNEL'S container, not the home workspace: the row is keyed by
   *  channel and the request must carry the tenancy the channel lives in. */
  workspaceId: string;
}) {
  const path = `/api/channels/${encodeURIComponent(channelId)}/personal-arming`;
  const state = useApiQuery<{ armed: boolean }>(path, { workspaceId });
  const armed = state.data?.armed;

  const flip = useApiMutation<boolean, { armed: boolean }>({
    request: (next) => ({
      path,
      // ⚠ TWO VERBS, ONE CONTROL: PUT arms, DELETE disarms. The server's delete
      // is the one direction that can never refuse, so a stuck "on" is always
      // closable — see the route's docblock.
      method: next ? "PUT" : "DELETE",
      workspaceId,
    }),
    invalidate: () => [apiPathKey(path)],
  });

  // Nothing to say until the read lands.
  if (armed === undefined) return null;

  return (
    <button
      type="button"
      className="text-micro font-medium text-link disabled:opacity-50"
      disabled={flip.pending}
      onClick={() => flip.mutate(!armed)}
      // ⚠ THE ONE EXPLAINER, and it is in the tooltip rather than the pane: the
      // label carries the state, the title carries the consequence.
      title={
        armed
          ? "Your agent sessions in this channel can reach your personal shelf. Turn it off and they cannot."
          : "Your agent sessions in this channel cannot reach your personal shelf until you turn this on."
      }
    >
      {armed
        ? "Your agents here can reach this shelf"
        : "Let your agents here reach this shelf"}
    </button>
  );
}
