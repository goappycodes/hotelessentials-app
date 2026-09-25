import type { NextRequest } from "next/server";
import { syncSalesOrderFromWebhook } from "@/lib/zoho/sync";
import { handleZohoWebhook, zohoWebhookHealth } from "@/lib/zoho/webhook";

// Called by a Zoho Books workflow rule on Sales Orders (created / edited). See handleZohoWebhook for how
// the request is authenticated and answered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = () => zohoWebhookHealth("sales-orders");

export const POST = (request: NextRequest) =>
  handleZohoWebhook(request, { idKey: "sales_order_id", sync: syncSalesOrderFromWebhook, revalidate: "/dashboard/sales-orders" });
