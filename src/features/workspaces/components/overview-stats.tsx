import Link from "next/link";
import {
  OverviewStatsCore,
  type OverviewStatsCoreProps,
} from "./overview-stats-core";

type Props = Omit<OverviewStatsCoreProps, "Link">;

/**
 * OverviewStats — the workspace-at-a-glance card row on the overview
 * page. Each card is a live count that deep-links into its section, so
 * the row doubles as navigation (server component; counts come from the
 * page's parallel head-count queries).
 *
 * The markup lives in `./overview-stats-core`, which takes the link component
 * as a prop; this file is only the `next/link` binding, so the desktop
 * renderer reuses the same row with a react-router link.
 */
export function OverviewStats(props: Props) {
  return <OverviewStatsCore {...props} Link={Link} />;
}
