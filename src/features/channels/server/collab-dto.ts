import type {
  AgentTrustRule,
  ChannelConsentRequest,
  ConsentKind,
  ConsentStatus,
} from "../types";
import type { ProfileRef } from "./dto";

/**
 * DB row shapes + mappers for the v1.2 collaboration tables
 * (`channel_consent_requests`, `agent_trust_rules`, `agent_presence`).
 * Hand-written rather than pulled from the generated `Database` type — the
 * same cast-at-the-boundary pattern the rest of the channels feature uses,
 * since the repository talks to the untyped `supabaseAdmin()` client.
 */

export type ConsentRequestRow = {
  id: string;
  channel_id: string;
  workspace_id: string;
  operator_user_id: string;
  requester_user_id: string | null;
  kind: string;
  message_seq: number | string | null;
  summary: string;
  body_preview: string;
  proposed_reply: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  expires_at: string | null;
};

export type TrustRuleRow = {
  id: string;
  operator_user_id: string;
  trusted_user_id: string;
  workspace_id: string;
  created_at: string;
};

export type PresenceRow = {
  user_id: string;
  workspace_id: string;
  last_seen_at: string;
  status: string;
};

export function mapConsentRow(
  row: ConsentRequestRow,
  requester: ProfileRef | undefined
): ChannelConsentRequest {
  return {
    id: row.id,
    channelId: row.channel_id,
    workspaceId: row.workspace_id,
    operatorUserId: row.operator_user_id,
    requesterUserId: row.requester_user_id,
    kind: row.kind as ConsentKind,
    messageSeq: row.message_seq === null ? null : Number(row.message_seq),
    summary: row.summary,
    bodyPreview: row.body_preview,
    proposedReply: row.proposed_reply,
    status: row.status as ConsentStatus,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    requesterName: requester?.display_name || requester?.email || null,
    requesterAvatarUrl: requester?.avatar_url ?? null,
  };
}

export function mapTrustRow(
  row: TrustRuleRow,
  trusted: ProfileRef | undefined
): AgentTrustRule {
  return {
    id: row.id,
    operatorUserId: row.operator_user_id,
    trustedUserId: row.trusted_user_id,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
    trustedName: trusted?.display_name || trusted?.email || null,
    trustedEmail: trusted?.email ?? null,
    trustedAvatarUrl: trusted?.avatar_url ?? null,
  };
}
