/**
 * PUBLIC ALIAS of `/channels` (the UI-staging page). `/playground` is already in
 * `shared/auth/public-routes.ts › PUBLIC_ROUTES` (prefix match), so this path renders
 * signed out, while `/channels` needs a session until it is added there.
 */
export { default, metadata } from "../../channels/page";
