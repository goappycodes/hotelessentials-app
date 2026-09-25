import type { NextRequest } from "next/server";
import { syncQuoteFromWebhook } from "@/lib/zoho/sync";
import { handleZohoWebhook, zohoWebhookHealth } from "@/lib/zoho/webhook";

// Called by a Zoho Books workflow rule on Estimates (created / edited). See handleZohoWebhook for how
// the request is authenticated and answered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = () => zohoWebhookHealth("quotes");

export const POST = (request: NextRequest) =>
  handleZohoWebhook(request, { idKey: "quote_id", sync: syncQuoteFromWebhook, revalidate: "/dashboard/quotes" });
