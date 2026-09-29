/**
 * `POST /api/displays` (docs/specs/unified-display.md §4, contract C4): show a display — `dopl_show`
 * and every glasses shortcut. Blocks are the v2 vocabulary, validated server-side. Its own module
 * for `escalation-types.ts`'s reason: `channel-types.ts` is at the 500-line cap.
 */
export interface ShowDisplayInput {
  channel?: string;
  thread?: string;
  target?: "auto" | "channel" | "glasses";
  blocks?: Record<string, unknown>[];
  display_id?: string;
  mention?: string;
  wait?: boolean;
  timeout_sec?: number;
  template?: string;
  data?: Record<string, unknown>;
  save_as?: string;
  validate_only?: boolean;
  client_msg_id?: string;
  /** Internal to the app's glasses shortcuts; `dopl_show` never sends these. */
  layout?: "stack" | "absolute";
  origin?: "dopl_show" | "glasses_render" | "glasses_ask" | "glasses_use_template" | "glasses_update";
  ttl_sec?: number;
  shortcut?: "render" | "ask";
}

export interface DisplayAnswerStamp {
  block_id: string;
  index: number;
  choice: string;
  at: string;
  via: string;
  by?: string;
  message_id?: string;
}

export interface ShowDisplayResult {
  display_id: string;
  message_id?: string;
  channel_id?: string;
  channel_name?: string;
  /** "shown" | "skipped:<reason>" | "off" (validate_only: fits | degraded(...) | errors:[...]) */
  glasses: string;
  glasses_message_id?: string;
  replaced?: "in-place" | "new";
  decision?: boolean;
  /** `resolved/named` mention handles. */
  tags?: string;
  /** With `wait`: answered | timeout | dismissed | pending. Else the lens row's status. */
  status?: string;
  answer?: DisplayAnswerStamp | null;
  preview?: string;
  compiled?: unknown;
}
