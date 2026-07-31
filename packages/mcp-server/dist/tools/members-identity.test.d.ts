/**
 * `dopl_members` — WHO AM I, and the privacy fence around WHO ARE THEY.
 *
 * Two separate claims live here and they pull in opposite directions:
 *
 *   SELF — `whoami` is the authoritative answer, so it must state the caller's
 *   immutable id even when the membership endpoint declines to, must say what
 *   the session is acting through, and must carry the locus refusals. Before
 *   this, a null `userId` from `GET /api/workspaces/me` produced a whoami that
 *   named a workspace and a role and identified NOBODY — while `dopl_channel`
 *   in the same connection was confidently marking "you" off a different id.
 *
 *   PEER — a member other than the caller is name + immutable id + membership
 *   and NOTHING ELSE. No hostname, no credential, no runtime. The session
 *   record now flows into this tool, so the fence has to be asserted, not
 *   assumed.
 */
export {};
