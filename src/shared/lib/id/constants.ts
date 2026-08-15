/** Pure constants for the publicId routing-handle scheme. ⚠ No `"server-only"`
 *  directive and no Node-only imports, so client components and shared URL
 *  parsers can consume it — the generator in `./public-id.ts` IS server-only
 *  (`node:crypto`). */
export const PUBLIC_ID_LENGTH = 12;
