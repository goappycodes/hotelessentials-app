import "server-only";
import ExcelJS from "exceljs";

export type SalesOrderItemsExportRow = {
  serial: number;
  item: string;
  hsn_or_sac: string | null;
  quantity: number;
  sent: number;
  remaining: number;
};

type LineItem = {
  item_order: number | null;
  name: string;
  hsn_or_sac: string | null;
  quantity: number | null;
};

/** Per-item totals from the sales_order_item_dispatch view (remaining = sent − ordered, so < 0 means still to send). */
export type ItemDispatch = { quantity_sent: number | string; remaining: number | string };

/**
 * One export row for a line item. `index` is its position in the order's item list (used as the
 * serial when Zoho gave no item_order). Remaining is the quantity still to send across all
 * dispatches; over-sent items show 0. Without dispatch data the whole quantity is remaining.
 */
export function toExportRow(item: LineItem, index: number, dispatch?: ItemDispatch): SalesOrderItemsExportRow {
  const quantity = Number(item.quantity ?? 0);
  return {
    serial: item.item_order ?? index + 1,
    item: item.name,
    hsn_or_sac: item.hsn_or_sac,
    quantity,
    sent: dispatch ? Number(dispatch.quantity_sent) : 0,
    remaining: dispatch ? Math.max(0, -Number(dispatch.remaining)) : quantity,
  };
}

/** A row of the multi-order export, which also names the sales order the item belongs to. */
export type RemainingItemsExportRow = SalesOrderItemsExportRow & { salesorder_number: string };

export type ItemsSheet = { name: string; rows: RemainingItemsExportRow[] };

/**
 * One sheet per sales order holding only the items still to be sent, each row tagged with the order's
 * number. `pending` maps a line item's id to its dispatch totals for items with quantity remaining;
 * orders with none are left out.
 */
export function remainingItemSheets(
  orders: { salesorder_number: string; sales_order_items: (LineItem & { id: string })[] }[],
  pending: Map<string, ItemDispatch>,
): ItemsSheet[] {
  const sheets: ItemsSheet[] = [];
  for (const order of orders) {
    const rows = order.sales_order_items.flatMap((item, index) => {
      const dispatch = pending.get(item.id);
      return dispatch ? [{ salesorder_number: order.salesorder_number, ...toExportRow(item, index, dispatch) }] : [];
    });
    if (rows.length) sheets.push({ name: order.salesorder_number, rows });
  }
  return sheets;
}

function newWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hotel Essentials";
  return workbook;
}

/**
 * Adds the Items table (Serial No, Item, HSN/SAC, QTY, Item Sent, Item Remaining) as a worksheet. Rows
 * that carry a `salesorder_number` get it as a "Sales Order No" column right after Serial No.
 */
function addItemsSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  rows: (SalesOrderItemsExportRow & { salesorder_number?: string })[],
) {
  const withOrderNumber = rows.some((row) => row.salesorder_number !== undefined);
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Serial No", key: "serial", width: 10 },
    ...(withOrderNumber ? [{ header: "Sales Order No", key: "salesorder_number", width: 18 }] : []),
    { header: "Item", key: "item", width: 60 },
    { header: "HSN/SAC", key: "hsn_or_sac", width: 14 },
    { header: "QTY", key: "quantity", width: 10 },
    { header: "Item Sent", key: "sent", width: 12 },
    { header: "Item Remaining", key: "remaining", width: 16 },
  ];

  // HSN/SAC and item are written as text (never parsed as numbers/formulas), so codes keep leading zeros.
  for (const row of rows) sheet.addRow({ ...row, hsn_or_sac: row.hsn_or_sac ?? "" });

  // Column alignment first; the header row is styled afterwards so it wins.
  sheet.getColumn("item").alignment = { wrapText: true, vertical: "top" };
  sheet.getColumn("hsn_or_sac").alignment = { horizontal: "left", vertical: "top" };
  if (withOrderNumber) sheet.getColumn("salesorder_number").alignment = { horizontal: "left", vertical: "top" };
  for (const key of ["serial", "quantity", "sent", "remaining"]) {
    sheet.getColumn(key).alignment = { horizontal: "right", vertical: "top" };
  }

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { horizontal: "center", vertical: "middle" };
  const black = { style: "thin", color: { argb: "FF000000" } } as const;
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    cell.border = { top: black, left: black, bottom: black, right: black };
  });
}

/** Builds the sales order Items export: one sheet, one row per line item. */
export async function buildSalesOrderItemsXlsx(rows: SalesOrderItemsExportRow[]): Promise<Buffer> {
  const workbook = newWorkbook();
  addItemsSheet(workbook, "Items", rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Excel sheet names: max 31 chars, unique (case-insensitive), none of \ / ? * [ ] :
function sheetName(raw: string, used: Set<string>) {
  const base = raw.replace(/[\\/?*[\]:]/g, "-").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

/** Same table as the single-order export, one sheet per sales order (named after the order number). */
export async function buildSalesOrdersItemsXlsx(sheets: ItemsSheet[]): Promise<Buffer> {
  const workbook = newWorkbook();
  const used = new Set<string>();
  for (const sheet of sheets) addItemsSheet(workbook, sheetName(sheet.name, used), sheet.rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
