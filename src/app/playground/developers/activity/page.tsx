import { ActivitySection } from "../_sections/activity";

export default async function Page({ searchParams }: { searchParams: Promise<{ call?: string; user?: string; device?: string; status?: string }> }) {
  const params = await searchParams;
  return <ActivitySection initial={params} />;
}
