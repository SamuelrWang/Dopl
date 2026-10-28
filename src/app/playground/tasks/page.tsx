import type { Metadata } from "next";
import { TasksStagingPage } from "@/features/tasks-staging/tasks-staging-page";

export const metadata: Metadata = {
  title: "Tasks (staging) | Dopl",
  robots: { index: false, follow: false },
};

/** UI STAGING: the mocked Tasks page on fake data. Public under the `/playground` prefix. */
export default function TasksStagingRoute() {
  return <TasksStagingPage />;
}
