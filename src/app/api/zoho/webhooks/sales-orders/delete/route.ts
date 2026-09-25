import type { NextRequest } from "next/server";
import { deleteSalesOrderFromWebhook } from "@/lib/zoho/sync";
import { handleZohoWebhook, zohoWebhookHealth } from "@/lib/zoho/webhook";

// Called by a Zoho Books workflow rule when a Sales Order is deleted. Removes the local copy (and its dispatch
// batches, as the Sync button does); it makes no request to Zoho. See handleZohoWebhook for how the request is
// authenticated and answered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = () => zohoWebhookHealth("sales-orders-delete");

const handle = (request: NextRequest) =>
  handleZohoWebhook(request, {
    idKey: "sales_order_id",
    run: deleteSalesOrderFromWebhook,
    revalidate: "/dashboard/sales-orders",
  });

// Zoho's webhook method can be POST or DELETE; both do the same thing here.
export const POST = handle;
export const DELETE = handle;
