# /identities staging

`/identities` (public alias `/playground/identities`) renders **desktop /home → Identities** inside
the landing demo's window (`src/features/ui-staging/staging-frame.tsx`). Since the 2026-10-26 port
(`docs/specs/identities-port/INVENTORY.md`) it mounts the PRODUCT face: a change to
`src/features/agent-identities/components/*` shows here and in the desktop at once. There is nothing
to port back.

## Hosts

| Staging file | Stands in for |
|---|---|
| `home/identities-scene.tsx` | `apps/desktop-ui/src/pages/home/identity-panels.tsx`: mounts `identities-home.tsx`, `identity-editor.tsx` and `identity-knowledge-dialog.tsx` with the same props, from the staging data layer. Launch is simulated (a busy beat, then the toast, or the refusal line for `data.ts › REFUSED_LAUNCH`). |
| `identities-staging-page.tsx` | `pages/home/home-panes.tsx › HomePane`'s Identities branch, plus the scenario pills and a QueryClient seeded with each base's knowledge tree for the product picker. |

## Data layer (stand-ins, never ported)

| File | Replaces |
|---|---|
| `store/identity-store.ts` | the database (reseeded on mount) |
| `store/use-staging-identities.ts` | `agent-identities/hooks/use-agent-identities.ts` |
| `store/use-staging-identity-save.ts` | `agent-identities/hooks/use-identity-save.ts` |
| `store/use-staging-attachable-bases.ts` | `agent-identities/hooks/use-attachable-bases.ts` |
| `data.ts` | the identities, the selected channel, runtimes and model catalogs; knowledge from `/knowledge`'s seed |
| `data-agents.ts` | the roster's photos and names, and this machine's session feed (`use-desktop-sessions.ts`), live and ended agents |

The editor's Runtime and Model rows read the desktop bridge (`useLaunchSelection`), which a browser
does not have, so on this page they offer Any and Default only.
