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

/** Builds the sales order Items export: one sheet, one row per line item. */
export async function buildSalesOrderItemsXlsx(rows: SalesOrderItemsExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hotel Essentials";

  const sheet = workbook.addWorksheet("Items", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Serial No", key: "serial", width: 10 },
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

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
