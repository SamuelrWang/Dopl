/**
 * THE SWEEP INTO THE REST OF THE MCP SURFACE — part 2 of 3: the two tools whose
 * reads are CROSS-USER BY DESIGN. Siblings: `narration.test.ts` (the shared
 * helper + the workspace name) and `tool-narration-graph.test.ts` (the
 * workspace's shared authored content). Split three ways at the §2 500-line cap.
 *
 * Two earlier passes hardened `dopl_channel` — its read ops, then its write ops
 * and its member resolver — and both stopped at the channel files. Every other
 * tool splices the same kind of string into the same kind of line.
 *
 * REACH, established rather than assumed:
 *
 *   dopl_chats   — a chat is private by default, but `visibility: "public"`
 *                  shares it workspace-wide and `op="list"` returns those
 *                  alongside your own, on a row that literally read `shared by
 *                  <someone else's display name>`. `op="get"` then rendered that
 *                  chat's 200-char title as `# ${chat.title}` — a real H1, with
 *                  no framing anywhere in the result. This is the site the last
 *                  sweep flagged by file and line.
 *   dopl_members — `profiles.display_name`, the column the channel pass found
 *                  has no validation anywhere in the product and which any
 *                  signed-in user can PATCH straight through PostgREST, plus
 *                  `teams.name` / `.description` and the NAME of every shareable
 *                  resource. `op="get"` built a `## ` heading out of the first
 *                  and `op="teams"` a `### ` out of the second; `op="list"`
 *                  printed a name with no user id beside it at all.
 *
 * The @dopl/client is hand-stubbed throughout; nothing transports.
 */
export {};
