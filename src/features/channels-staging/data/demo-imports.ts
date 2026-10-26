/**
 * The landing demo's roster, re-exported in one place so every staging module imports the
 * demo (`src/features/marketing/components/banner-demo/`) through a single seam. Read-only:
 * the marketing tree is never edited from here.
 */

export {
  AGENT_IDS,
  CURRENT_USER_ID,
  DEMO_CHANNEL,
  MEMBERS,
  minsAgo,
  MY_SESSIONS,
  OPEN_THREAD_ID,
  PEER_NOTICE,
  PEER_SCOUT,
  PEER_TRIAGE,
  PEER_WAKE,
  SERVER_SESSIONS,
  WORKSPACE_ID,
} from "@/features/marketing/components/banner-demo/demo-data";
export {
  HOME_ROW_ID as HOME_ROW_ID_DEMO,
  VIEWER,
} from "@/features/marketing/components/banner-demo/demo-home-rows";
