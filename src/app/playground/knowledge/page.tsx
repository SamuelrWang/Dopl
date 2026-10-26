/**
 * PUBLIC ALIAS of `/knowledge` (the UI-staging page). `/playground` is already in
 * `shared/auth/public-routes.ts › PUBLIC_ROUTES` (prefix match), so this path
 * renders signed out, while `/knowledge` needs a session until it is added there.
 */
export { default, metadata } from "../../knowledge/page";
