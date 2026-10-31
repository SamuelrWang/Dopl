import { notFound } from "next/navigation";
import { userById } from "../../_data/users";
import { UserPageSection } from "../../_sections/user-page";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  if (!userById(id)) notFound();
  return <UserPageSection userId={id} initialTab={tab} />;
}
