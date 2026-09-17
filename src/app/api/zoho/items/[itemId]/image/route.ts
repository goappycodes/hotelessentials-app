import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getItemImage } from "@/lib/zoho/client";

// Serves a Zoho Books item image to signed-in users. Zoho image links need an OAuth
// token, so the server fetches it and the browser caches the result for a day.
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/zoho/items/[itemId]/image">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { itemId } = await ctx.params;
  if (!/^\d+$/.test(itemId)) return new Response("Invalid item id", { status: 400 });

  const image = await getItemImage(itemId);
  if (!image) return new Response("Not found", { status: 404 });

  return new Response(image.body, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
