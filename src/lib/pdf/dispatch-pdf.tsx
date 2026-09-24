import "server-only";
import { Document, Page, renderToBuffer, Text, View } from "@react-pdf/renderer";
import { baseStyles as s, formatDate, PdfHeader, PdfRecipient, registerFonts } from "./shared";

// Data shape -------------------------------------------------------------------
export type DispatchPdfItem = {
  name: string;
  quantity_sent: number;
  /** Quantity of the item still to be sent across all dispatches; null if the item no longer exists on the order. */
  quantity_remaining: number | null;
};

export type DispatchPdfData = {
  batch_number: string;
  salesorder_number: string;
  date: string | null;
  customer_name: string | null;
  billing_address: Record<string, string> | null;
  phone: string | null;
  pan_no: string | null;
  gst_no: string | null;
  items: DispatchPdfItem[];
};

// Same number format as the dashboard's dispatch screens.
const qtyFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

// Column widths (must sum to 100).
const COLS = { name: 60, sent: 20, remaining: 20 };

function DispatchDocument({ data }: { data: DispatchPdfData }) {
  return (
    <Document title={`Dispatch ${data.batch_number}`} author="Hotel Essentials">
      <Page size="A4" style={s.page}>
        <PdfHeader
          metaLines={[
            ["Date", formatDate(data.date)],
            ["Dispatch No", data.batch_number],
            ["Sales Order No", data.salesorder_number],
          ]}
        />

        <PdfRecipient
          name={data.customer_name}
          address={data.billing_address}
          phone={data.phone}
          panNo={data.pan_no}
          gstNo={data.gst_no}
        />

        {/* Title */}
        <Text style={s.title}>Dispatch</Text>

        {/* Items table */}
        <View style={s.table}>
          {/* Header (repeats on each page) */}
          <View style={s.row} fixed>
            <Text style={[s.headerCell, { width: `${COLS.name}%` }]}>Item Name</Text>
            <Text style={[s.headerCell, { width: `${COLS.sent}%` }]}>Quantity Sent</Text>
            <Text style={[s.headerCell, { width: `${COLS.remaining}%` }]}>Quantity Remaining</Text>
          </View>

          {/* Rows */}
          {data.items.map((item, index) => (
            <View key={index} style={s.row} wrap={false}>
              <View style={[s.cell, { width: `${COLS.name}%` }]}>
                <Text>{item.name}</Text>
              </View>
              <View style={[s.cell, { width: `${COLS.sent}%`, alignItems: "center" }]}>
                <Text>{qtyFormat.format(item.quantity_sent)}</Text>
              </View>
              <View style={[s.cell, { width: `${COLS.remaining}%`, alignItems: "center" }]}>
                <Text>{item.quantity_remaining == null ? "—" : qtyFormat.format(item.quantity_remaining)}</Text>
              </View>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

export async function renderDispatchPdf(data: DispatchPdfData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<DispatchDocument data={data} />);
}
