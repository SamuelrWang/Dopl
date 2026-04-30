/**
 * /canvases/[slug]/settings — per-canvas settings page. Shows General
 * (rename + description) for admins/owners, the Members section (any
 * member can read; admins can invite/re-role/remove), and the Danger
 * zone (delete) for owners.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/shared/supabase/server";
import {
  findCanvasForMember,
  resolveMembershipOrThrow,
} from "@/features/canvases/server/service";
import { CanvasSettingsForm } from "@/features/canvases/components/canvas-settings-form";
import { CanvasMembersSection } from "@/features/canvases/components/canvas-members-section";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function CanvasSettingsPage({ params }: PageProps) {
  const { slug } = await params;

  const user = await getUser();
  if (!user) redirect("/login");

  const canvas = await findCanvasForMember(user.id, slug);
  if (!canvas) notFound();
  const { membership } = await resolveMembershipOrThrow(canvas.id, user.id);

  return (
    <div className="container mx-auto px-4 pt-24 pb-16 max-w-2xl">
      <Link
        href="/canvases"
        className="text-[10px] uppercase tracking-wider text-white/40 hover:text-white/70 transition-colors"
      >
        ← All canvases
      </Link>
      <div className="mt-3 mb-6">
        <h1 className="text-2xl font-semibold text-white">{canvas.name}</h1>
        <p className="text-xs text-white/40 mt-1 font-mono">
          /canvas/{canvas.slug}
        </p>
      </div>
      <div className="space-y-8">
        <CanvasSettingsForm canvas={canvas} role={membership.role} />
        <CanvasMembersSection
          canvasSlug={canvas.slug}
          myUserId={user.id}
          myRole={membership.role}
        />
      </div>
    </div>
  );
}
