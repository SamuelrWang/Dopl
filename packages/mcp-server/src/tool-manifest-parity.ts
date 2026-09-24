/**
 * DMP-003's parity manifest, the half `tool-manifest.ts`'s bindings cannot say: product actions
 * (`METHOD[,METHOD] route` under `src/app/api/`) that no granular tool runs, each with its class and
 * reason. Every other action is `covered` by a binding there. `gap` marks an action an agent should
 * have and does not yet — a later wave's backlog, never a ruling.
 */
export type ParityClass =
  | "human-only"
  | "app-only-destructive"
  | "machine-local-security"
  | "not-user-facing"
  | "gap";

const DELETE_APP_ONLY = "deletion is app-only (delete-policy.ts)";
const DASHBOARD = "dashboard read for a person; agents orient with dopl_get_status / dopl_get_map";
const EXPORT = "file download for a person; agents read the content itself";
const MEMBERSHIP = "membership and roles are the operator's act, never an agent's";
const BILLING = "payment and plan changes stay with the paying person";
const DESKTOP = "the desktop executes it on the operator's machine; agents request, never claim";
const ACCEPT = "accepting is the invitee's own act";
const HEARTBEAT = "client heartbeat or session push";
const OAUTH = "OAuth flow or metadata";

export const UNCOVERED_ACTIONS: ReadonlyArray<readonly [action: string, cls: ParityClass, reason: string]> = [
  ["DELETE agent-identities/[identityId]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE channels/[channelId]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE channels/[channelId]/members", "app-only-destructive", "removing a member is a departure, the operator's act"],
  ["DELETE channels/[channelId]/tasks/[taskId]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE chats/[chatId]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE chats/folders/[folderId]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE home/links/[linkId]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE knowledge/bases/[baseId]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE knowledge/bases/[baseId]/folders-by-path", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE knowledge/entries/[entryId]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE knowledge/folders/[folderId]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE ontology/ontologies/[ontologyId]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE ontology/ontologies/[ontologyId]/shares", "app-only-destructive", "revoking a lend removes access others rely on"],
  ["DELETE ontology/objects/[objectId]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE skills/[skillSlug]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE user/delete", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE workspaces/[workspaceSlug]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE workspaces/[workspaceSlug]/icon", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE workspaces/[workspaceSlug]/invitations/[id]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE workspaces/[workspaceSlug]/members/[userId]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE workspaces/[workspaceSlug]/teams/[teamId]", "app-only-destructive", DELETE_APP_ONLY],
  ["DELETE workspaces/[workspaceSlug]/teams/[teamId]/members/[userId]", "app-only-destructive", DELETE_APP_ONLY],
  ["POST,DELETE auth/mcp-device-token", "machine-local-security", "mints the credential agents run on"],
  ["POST,DELETE auth/mcp-container-token", "machine-local-security", "mints the credential agents run on"],
  ["GET oauth/grants", "machine-local-security", "which clients hold the user's OAuth grants"],
  ["DELETE oauth/grants/[id]", "machine-local-security", "revoking a client's credential"],
  ["PATCH channels/[channelId]/members", "machine-local-security", "agentToolProfile is containment (sessionOnly)"],
  ["GET,POST channels/consent", "machine-local-security", "outbound review is the operator's check on agents"],
  ["GET,PATCH channels/consent/[id]", "machine-local-security", "outbound review is the operator's check on agents"],
  ["POST channels/agent-directions/claim", "machine-local-security", DESKTOP],
  ["POST channels/agent-directions/decide", "machine-local-security", DESKTOP],
  ["POST channels/launch-directives/claim", "machine-local-security", DESKTOP],
  ["POST channels/launch-directives/decide", "machine-local-security", DESKTOP],
  ["POST workspaces", "human-only", "a standard workspace carries a plan; agents create home channels"],
  ["PATCH workspaces/[workspaceSlug]", "human-only", "workspace settings"],
  ["POST workspaces/[workspaceSlug]/icon", "human-only", "image upload"],
  ["PATCH workspaces/[workspaceSlug]/members/[userId]", "human-only", MEMBERSHIP],
  ["PUT workspaces/[workspaceSlug]/access-matrix", "human-only", MEMBERSHIP],
  ["POST workspaces/[workspaceSlug]/teams", "human-only", MEMBERSHIP],
  ["PATCH workspaces/[workspaceSlug]/teams/[teamId]", "human-only", MEMBERSHIP],
  ["POST workspaces/[workspaceSlug]/teams/[teamId]/members", "human-only", MEMBERSHIP],
  ["PUT workspaces/[workspaceSlug]/teams/[teamId]/access", "human-only", MEMBERSHIP],
  ["POST workspaces/[workspaceSlug]/invitations", "human-only", MEMBERSHIP],
  ["POST workspaces/[workspaceSlug]/join-link", "human-only", MEMBERSHIP],
  ["PATCH workspaces/[workspaceSlug]/join-requests/[requestId]", "human-only", MEMBERSHIP],
  ["POST workspaces/invitations/[token]/accept", "human-only", ACCEPT],
  ["POST join/[token]", "human-only", ACCEPT],
  ["POST home/link/[token]/claim", "human-only", ACCEPT],
  ["POST home/links", "human-only", "share links invite people"],
  ["POST billing/checkout", "human-only", BILLING],
  ["POST billing/cancel", "human-only", BILLING],
  ["POST billing/portal", "human-only", BILLING],
  ["POST billing/upgrade-to-team", "human-only", BILLING],
  ["GET billing/invoices", "human-only", BILLING],
  ["GET billing/payment-method", "human-only", BILLING],
  ["GET billing/status", "human-only", BILLING],
  ["POST onboarding/complete", "human-only", "the person's own onboarding"],
  ["POST onboarding/survey", "human-only", "the person's own onboarding"],
  ["PATCH user/profile", "human-only", "the person's own profile"],
  ["PUT,DELETE knowledge/bases/[baseId]/star", "human-only", "a per-person favourite, not content"],
  ["GET knowledge/bases/[baseId]/export", "human-only", EXPORT],
  ["GET knowledge/entries/[entryId]/export", "human-only", EXPORT],
  ["GET knowledge/folders/[folderId]/export", "human-only", EXPORT],
  ["GET skills/[skillSlug]/export", "human-only", EXPORT],
  ["GET home/overview", "human-only", DASHBOARD],
  ["GET home/overview-series", "human-only", DASHBOARD],
  ["GET home/token-spend", "human-only", DASHBOARD],
  ["GET workspaces/[workspaceSlug]/overview", "human-only", DASHBOARD],
  ["GET workspaces/[workspaceSlug]/overview-series", "human-only", DASHBOARD],
  ["GET workspaces/[workspaceSlug]/token-spend", "human-only", DASHBOARD],
  ["GET workspaces/[workspaceSlug]/members/[userId]/activity", "human-only", DASHBOARD],
  ["POST skills/[skillSlug]/duplicate", "gap", "dopl_create_skill's duplicate slot"],
  ["GET,PUT ontology/ontologies/[ontologyId]/shares", "gap", "lend an ontology into a channel, as kb and identities grant"],
  ["GET,POST channels/[channelId]/mentions", "gap", "the caller's mentions inbox"],
  ["GET channels/[channelId]/sessions", "gap", "peers' agent cards; dopl_get_status shows only your own"],
  ["POST boot", "not-user-facing", "app bootstrap"],
  ["GET version", "not-user-facing", "build probe"],
  ["GET cron/oauth-cleanup", "not-user-facing", "cron"],
  ["GET cron/playground-reaper", "not-user-facing", "cron"],
  ["GET cron/reconcile-seats", "not-user-facing", "cron"],
  ["POST billing/webhook", "not-user-facing", "Stripe webhook"],
  ["POST,DELETE,GET mcp", "not-user-facing", "this transport"],
  ["POST mcp/credits/consume", "not-user-facing", "the per-call meter"],
  ["GET oauth-authorization-server", "not-user-facing", OAUTH],
  ["GET oauth-protected-resource", "not-user-facing", OAUTH],
  ["POST oauth/authorize", "not-user-facing", OAUTH],
  ["POST oauth/register", "not-user-facing", OAUTH],
  ["POST oauth/revoke", "not-user-facing", OAUTH],
  ["POST oauth/token", "not-user-facing", OAUTH],
  ["POST playground/session", "not-user-facing", "public playground"],
  ["POST,DELETE,GET playground/mcp/[token]", "not-user-facing", "public playground"],
  ["GET home/link/[token]/info", "not-user-facing", "pre-login link preview"],
  ["GET workspaces/me", "not-user-facing", "app shell"],
  ["GET workspaces/resolve", "not-user-facing", "app shell"],
  ["GET user/onboarding-state", "not-user-facing", "app shell"],
  ["GET,POST user/mcp-status", "not-user-facing", HEARTBEAT],
  ["GET onboarding/mcp-status", "not-user-facing", HEARTBEAT],
  ["POST channels/presence", "not-user-facing", HEARTBEAT],
  ["POST channels/presence/all", "not-user-facing", HEARTBEAT],
  ["GET,POST channels/sessions", "not-user-facing", HEARTBEAT],
  ["GET channels/[channelId]/agents", "not-user-facing", "historical attribution roster"],
  ["GET ontology/reach", "not-user-facing", "desktop prompt framing"],
];
