import type { NextRequest } from "next/server";
import { deleteQuoteFromWebhook } from "@/lib/zoho/sync";
import { handleZohoWebhook, zohoWebhookHealth } from "@/lib/zoho/webhook";

// Called by a Zoho Books workflow rule when a Quote is deleted. Removes the local copy; it makes no request
// to Zoho. See handleZohoWebhook for how the request is authenticated and answered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = () => zohoWebhookHealth("quotes-delete");

const handle = (request: NextRequest) =>
  handleZohoWebhook(request, { idKey: "quote_id", run: deleteQuoteFromWebhook, revalidate: "/dashboard/quotes" });

// Zoho's webhook method can be POST or DELETE; both do the same thing here.
export const POST = handle;
export const DELETE = handle;
