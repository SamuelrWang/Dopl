export type GlassesKind = "notify" | "show" | "ask";
export type GlassesStatus = "pending" | "delivered" | "answered" | "dismissed" | "expired";

export interface NotifyPayload {
  title: string;
  body: string;
}
export interface ShowPayload {
  title: string;
  lines: string[];
}
export interface AskPayload {
  question: string;
  options: string[];
}
export type GlassesPayload = NotifyPayload | ShowPayload | AskPayload;

export interface GlassesAnswer {
  choice: string;
  index: number;
  at: string;
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
}

/** Every DB operation the feature needs, scoped to one user. The real
 *  implementation is `repository.ts`; tests pass an in-memory fake. */
export interface GlassesStore {
  insert(userId: string, row: NewGlassesMessage): Promise<GlassesMessage>;
  get(userId: string, id: string): Promise<GlassesMessage | null>;
  /** Active = pending|delivered and not past expires_at. */
  findActiveCard(userId: string, cardId: string, now: string): Promise<GlassesMessage | null>;
  /** Re-deliver an existing card: new payload, status pending, bumped updated_at. */
  refreshCard(
    userId: string,
    id: string,
    payload: GlassesPayload,
    expiresAt: string,
    now: string,
  ): Promise<GlassesMessage>;
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
  /** pending|delivered, unexpired, updated_at > after (if given), updated_at asc. */
  listInbox(userId: string, now: string, after: string | null): Promise<GlassesMessage[]>;
  /** pending -> delivered WITHOUT touching updated_at (the inbox cursor). */
  markDelivered(userId: string, ids: string[]): Promise<void>;
  countActive(userId: string, now: string): Promise<number>;
  touchDevice(userId: string, now: string): Promise<void>;
  lastSeen(userId: string): Promise<string | null>;
}
