"use client";

import Link from "next/link";
import { AppRailCore, type AppRailCoreProps } from "./app-rail-core";

type Props = Omit<AppRailCoreProps, "Link">;

/**
 * Far-left vertical rail of workspace tiles (new design language). Lists
 * the user's real workspaces — the active one is highlighted with the
 * light tile + edge bar — plus an add affordance (opens the create-
 * workspace dialog in place). Account/profile lives in the top-right.
 *
 * The markup lives in `./app-rail-core`, which takes the link component as a
 * prop; this file is only the `next/link` binding, so the desktop renderer
 * reuses the same rail with a react-router link.
 */
export function AppRail(props: Props) {
  return <AppRailCore {...props} Link={Link} />;
}
