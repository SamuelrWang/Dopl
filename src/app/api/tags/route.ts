import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
const supabase = supabaseAdmin();
import { withExternalAuth } from "@/lib/auth/with-auth";

async function handleGet(_request: NextRequest) {
  const { data, error } = await supabase
    .from("tags")
    .select("tag_type, tag_value");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group by tag_type and count
  const tagCounts: Record<string, Record<string, number>> = {};
  for (const tag of data || []) {
    if (!tagCounts[tag.tag_type]) {
      tagCounts[tag.tag_type] = {};
    }
    tagCounts[tag.tag_type][tag.tag_value] =
      (tagCounts[tag.tag_type][tag.tag_value] || 0) + 1;
  }

  // Format as array
  const tags = Object.entries(tagCounts).flatMap(([type, values]) =>
    Object.entries(values).map(([value, count]) => ({
      tag_type: type,
      tag_value: value,
      count,
    }))
  );

  // Sort by count descending
  tags.sort((a, b) => b.count - a.count);

  return NextResponse.json({ tags });
}

export const GET = withExternalAuth(handleGet);
