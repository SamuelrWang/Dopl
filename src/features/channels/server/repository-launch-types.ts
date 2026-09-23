/** Row shapes for `channel_launch_directives`. Re-exported by `repository-launch.ts`, which holds
 *  every statement and every `operator_user_id` fence. */

export type LaunchDirectiveRow = {
  id: string;
  kind: string;
  workspace_id: string;
  channel_id: string;
  task_id: string | null;
  operator_user_id: string;
  goal: string | null;
  model: string | null;
  /** SET NULL on delete, and `identity_name` is a snapshot: a null id with a live name means the
   *  identity was deleted, and the desktop must refuse `no-identity`. */
  identity_id: string | null;
  identity_name: string | null;
  color: string | null;
  agent_name: string | null; // null on a non-launch kind, or from an older client
  target_agent_id: string | null;
  /** Non-null iff `kind = 'rename'`; `''` means clear. */
  target_name: string | null;
  /** Requests: `start_*`/`chain` are a launch's, `target_*` a `set_agent_mode`'s. Every `?` column
   *  may be absent from a payload cached against an older PostgREST schema. */
  start_tool_mode?: string | null;
  start_message_mode?: string | null;
  chain?: boolean | null;
  target_tool_mode?: string | null;
  target_message_mode?: string | null;
  /** The machine's report, written only by the decide; null = not reported. */
  applied_tool_mode?: string | null;
  applied_message_mode?: string | null;
  applied_chain?: boolean | null;
  applied_agent_name?: string | null;
  applied_runtime?: string | null;
  applied_model?: string | null;
  /** Retired: every create writes null (the server clamps nothing, resolves no model). */
  resolved_tool_mode?: string | null;
  resolved_message_mode?: string | null;
  resolved_chain?: boolean | null;
  resolved_model?: string | null;
  /** The requested runtime. No `resolved_runtime`: the server holds no runtime roster. */
  runtime?: string | null;
  status: string;
  refusal_reason: string | null;
  agent_id: string | null;
  claimed_at: string | null;
  decided_at: string | null;
  expires_at: string;
  created_at: string;
  client_msg_id?: string | null;
};

/** What a create supplies. `operator_user_id` is absent on purpose: it is a separate argument so
 *  no caller can pass one inside an object built from a request body. */
export type LaunchDirectiveInsert = {
  /** Omitted = `launch`, the column DEFAULT. */
  kind?: "launch" | "end" | "rename" | "set_agent_mode";
  workspace_id: string;
  channel_id: string;
  task_id: string | null;
  goal: string | null;
  model: string | null;
  /** Server-resolved under the caller's visibility, never raw caller input. */
  identity_id: string | null;
  identity_name: string | null;
  /** The server's resolution (the named key or the first free one), never raw caller input. */
  color?: string | null;
  agent_name?: string | null;
  /** Validated as a shape here and as membership on the machine (`no-sdk`); grants nothing. */
  runtime?: string | null;
  target_agent_id?: string | null;
  target_name?: string | null;
  start_tool_mode?: string | null;
  start_message_mode?: string | null;
  chain?: boolean | null;
  target_tool_mode?: string | null;
  target_message_mode?: string | null;
  expires_at: string;
  /** Unique per `(channel_id, operator_user_id)`; absent dedupes nothing (the index is partial). */
  client_msg_id?: string | null;
  /** Retired: `createLaunchDirective` writes all four as `null`. */
  resolved_tool_mode?: string | null;
  resolved_message_mode?: string | null;
  resolved_chain?: boolean | null;
  resolved_model?: string | null;
  // No `applied_*`: only the decide writes the machine's report; a requester cannot confirm itself.
};


export type LaunchDecision = {
  /** `done` is the non-launch kinds' success and carries no agent id. */
  status: "launched" | "done" | "refused";
  agent_id: string | null;
  refusal_reason: string | null;
  /** The decide is the only writer; `null` = not reported (an older desktop), never the request. */
  applied_tool_mode: string | null;
  applied_message_mode: string | null;
  applied_chain: boolean | null;
  applied_agent_name: string | null;
  /** `null` on `done`/`refused`; `applied_model: null` on a launch also means the runtime's own
   *  default model. */
  applied_runtime: string | null;
  applied_model: string | null;
  decided_at: string;
};
