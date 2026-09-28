export type GlassesKind = "notify" | "show" | "ask" | "screen";
export type GlassesStatus = "pending" | "delivered" | "answered" | "dismissed" | "expired";

interface NotifyPayload {
  title: string;
  body: string;
}
export interface ShowPayload {
  title: string;
  lines: string[];
  /** Mirrored agent replies only (`reply-<id>` cards): the source channel, so the plugin can fold
   *  the reply inline in Read / Conversation for that channel. */
  channel_id?: string;
  /** Mirrored replies only: the agent that wrote it, when known. */
  agent_session_id?: string;
}
interface AskPayload {
  question: string;
  options: string[];
}
/** One positioned, sanitized container on the wire (docs/glasses-mcp.md). */
export interface ScreenContainer {
  block_id: string;
  kind: "text" | "list";
  x: number;
  y: number;
  w: number;
  h: number;
  content?: string;
  items?: string[];
  brightness?: number;
  border?: boolean;
  capture: boolean;
}
export interface ScreenPayload {
  screen_id: string;
  spec_version: 1;
  containers: ScreenContainer[];
  /** The band the plugin fills with its context back button; blocks never enter it. */
  nav_footer?: { x: number; y: number; w: number; h: number };
}
export type GlassesPayload = NotifyPayload | ShowPayload | AskPayload | ScreenPayload;

export interface GlassesAnswer {
  choice: string;
  index: number;
  at: string;
  /** Screens only: which container the input came from. */
  block_id?: string | null;
}

/** A saved `glasses_templates` row. */
export interface GlassesTemplate {
  name: string;
  spec: unknown;
  created_at: string;
  updated_at: string;
}

/** A `glasses_messages` row, exactly as the device API returns it (minus user_id). */
export interface GlassesMessage {
  id: string;
  kind: GlassesKind;
  card_id: string | null;
  payload: GlassesPayload;
  status: GlassesStatus;
  answer: GlassesAnswer | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface NewGlassesMessage {
  kind: GlassesKind;
  card_id: string | null;
  payload: GlassesPayload;
  expires_at: string;
  now: string;
  /** Screens only: the agent's original spec, for `glasses_update`. */
  spec?: unknown;
}

/** Every DB operation the feature needs, scoped to one user. The real
 *  implementation is `repository.ts`; tests pass an in-memory fake. */
export interface GlassesStore {
  insert(userId: string, row: NewGlassesMessage): Promise<GlassesMessage>;
  get(userId: string, id: string): Promise<GlassesMessage | null>;
  /** Newest unexpired row of `kind` with this card_id whose status is in `statuses`
   *  (default pending|delivered). */
  findActiveCard(
    userId: string,
    cardId: string,
    now: string,
    kind?: GlassesKind,
    statuses?: GlassesStatus[],
  ): Promise<GlassesMessage | null>;
  /** Re-deliver an existing card: new payload (+spec), status pending, answer cleared,
   *  bumped updated_at. */
  refreshCard(
    userId: string,
    id: string,
    payload: GlassesPayload,
    expiresAt: string,
    now: string,
    spec?: unknown,
  ): Promise<GlassesMessage>;
  /** The stored agent spec of a screen row. */
  getSpec(userId: string, id: string): Promise<unknown>;
  /** Insert unless a row with the same (user, card_id) exists; null when it did. */
  insertIfAbsent(userId: string, row: NewGlassesMessage): Promise<GlassesMessage | null>;
  saveTemplate(userId: string, name: string, spec: unknown, now: string): Promise<GlassesTemplate>;
  listTemplates(userId: string): Promise<GlassesTemplate[]>;
  getTemplate(userId: string, name: string): Promise<GlassesTemplate | null>;
  /** Conditional status move; returns the updated row or null when `from` did not match. */
  transition(
    userId: string,
    id: string,
    from: GlassesStatus[],
    to: GlassesStatus,
    now: string,
    answer?: GlassesAnswer,
  ): Promise<GlassesMessage | null>;
  /** Mark pending|delivered rows past expires_at as expired. */
  expireStale(userId: string, now: string): Promise<void>;
  /** With `since`: every row with updated_at > since, any status. Without: pending|delivered and
   *  unexpired. Ordered by updated_at asc. */
  listInbox(userId: string, now: string, since: string | null): Promise<GlassesMessage[]>;
  /** pending -> delivered WITHOUT touching updated_at (the inbox cursor). */
  markDelivered(userId: string, ids: string[]): Promise<void>;
  countActive(userId: string, now: string): Promise<number>;
}
