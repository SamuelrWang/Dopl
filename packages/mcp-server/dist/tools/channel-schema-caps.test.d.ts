/**
 * F5 — THE PUBLISHED INPUT SHAPE MIRRORS THE ROUTE'S, IN BOTH DIRECTIONS.
 *
 * The caps were mirrored in a previous round; the MINIMUMS were not, and one
 * cap was never published at all. So `body: ""`, `client_msg_id: ""`,
 * `title: "   "` and a >64-character agent handle all passed the tool, reached
 * the route, and came back as an opaque 400 — which the write ops then had to
 * GUESS at, and historically guessed wrong ("invite them first" for a rejected
 * body). Declared here they are a -32602 that names the field, before anything
 * is sent.
 *
 * WHAT IS DELIBERATELY NOT MIRRORED, and must stay unmirrored:
 *  - `summary`'s 2000. One param serves two routes with two caps (a post's is
 *    200, close_thread's is 2000) and the schema declares the LOOSER so a
 *    legitimate close summary is never refused client-side. Pinned below so a
 *    later "consistency" pass cannot quietly tighten it.
 *  - `.trim()` on the agent refs. The route trims before measuring; this schema
 *    does not, and adding it here would change the bytes that are SENT.
 */
export {};
