import {
  AccountRailCore,
  type AccountRailProps,
} from "@/shared/layout/app-shell/account-rail-core";
// Same `?inline` reason as app-shell.tsx: packaged renderer is `file://`.
import doplMark from "#/assets/dopl-mark.png?inline";

export { HOME_PATH } from "@/shared/layout/app-shell/account-rail-core";

/** The SPA's account rail: the shared core with the packaged Dopl mark. */
export function AccountRail(props: Omit<AccountRailProps, "markSrc">) {
  return <AccountRailCore {...props} markSrc={doplMark} />;
}
