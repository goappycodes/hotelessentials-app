/* eslint-disable jsx-a11y/alt-text -- <Image> here is the @react-pdf/renderer PDF primitive, not an HTML <img>; it has no alt prop. */
import "server-only";
import {
  Document,
  Image,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { amountInWords } from "./amount-in-words";
import { BORDER, baseStyles, COMPANY, formatDate, MUTED, PdfHeader, PdfRecipient, registerFonts } from "./shared";

// Data shape -------------------------------------------------------------------
export type QuotePdfItem = {
  item_order: number | null;
  name: string;
  sku: string | null;
  description: string | null;
  quantity: number | null;
  rate: number | null;
  item_sub_total: number | null;
  tax_percentage: number | null;
  image: { data: Buffer; format: "png" | "jpg" } | null;
};

export type QuotePdfData = {
  estimate_number: string;
  date: string | null;
  customer_name: string | null;
  billing_address: Record<string, string> | null;
  phone: string | null;
  pan_no: string | null;
  gst_no: string | null;
  currency_code: string | null;
  sub_total: number | null;
  tax_total: number | null;
  total: number | null;
  items: QuotePdfItem[];
};

// Formatting helpers -----------------------------------------------------------
function moneyFmt(currency: string) {
  const symbol = currency === "INR" ? "₹" : currency;
  const nf = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (value: number | null | undefined) => `${symbol} ${nf.format(Number(value ?? 0))}`;
}

function formatQty(value: number | null) {
  return Number(value ?? 0).toFixed(2);
}

function formatPct(value: number | null) {
  if (value == null) return "—";
  return `${Number(value).toFixed(1)}%`;
}

// Column widths (must sum to 100).
const COLS = { sno: 6, image: 14, code: 12, name: 32, qty: 8, rate: 11, taxable: 11, gst: 6 };

const s = {
  ...baseStyles,
  ...StyleSheet.create({
    itemName: {},
    itemDesc: { fontSize: 6.5, color: MUTED, marginTop: 2 },
    // Totals
    totalsWrap: { marginTop: 14, width: "100%" },
    totalsRow: { flexDirection: "row", borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: BORDER },
    totalsRowLast: { borderBottomWidth: 1 },
    totalsLabel: {
      width: "33%",
      paddingVertical: 5,
      paddingHorizontal: 6,
      fontWeight: "bold",
      textAlign: "right",
      borderRightWidth: 1,
      borderColor: BORDER,
    },
    totalsValue: { width: "67%", paddingVertical: 5, paddingHorizontal: 6, textAlign: "right" },
    grandLabel: { backgroundColor: "#f3f4f6" },
    grand: { fontWeight: "bold" },
    wordsRow: { flexDirection: "row", borderWidth: 1, borderTopWidth: 0, borderColor: BORDER },
    wordsLabel: {
      width: "33%",
      paddingVertical: 5,
      paddingHorizontal: 6,
      fontWeight: "bold",
      borderRightWidth: 1,
      borderColor: BORDER,
      backgroundColor: "#f9fafb",
    },
    wordsValue: { width: "67%", paddingVertical: 5, paddingHorizontal: 6, fontWeight: "bold" },
    // Footer (bank + terms)
    footer: { flexDirection: "row", gap: 24, marginTop: 22 },
    footerCol: { flexGrow: 1, flexShrink: 1, width: "50%" },
    footerHeading: { fontSize: 11, fontWeight: "bold", marginBottom: 8 },
    bankLine: { fontSize: 8.5, marginBottom: 3 },
    termLine: { fontSize: 8.5, marginBottom: 4 },
  }),
};

function QuoteDocument({ data }: { data: QuotePdfData }) {
  const currency = data.currency_code ?? "INR";
  const money = moneyFmt(currency);

  return (
    <Document title={`Quotation ${data.estimate_number}`} author="Hotel Essentials">
      <Page size="A4" style={s.page}>
        <PdfHeader metaLines={[["Date", formatDate(data.date)], ["Quotation No", data.estimate_number]]} />

        <PdfRecipient
          name={data.customer_name}
          address={data.billing_address}
          phone={data.phone}
          panNo={data.pan_no}
          gstNo={data.gst_no}
        />

        {/* Title */}
        <Text style={s.title}>Quotation</Text>

        {/* Items table */}
        <View style={s.table}>
          {/* Header (repeats on each page) */}
          <View style={s.row} fixed>
            <Text style={[s.headerCell, { width: `${COLS.sno}%` }]}>S.No.</Text>
            <Text style={[s.headerCell, { width: `${COLS.image}%` }]}>Image</Text>
            <Text style={[s.headerCell, { width: `${COLS.code}%` }]}>Code</Text>
            <Text style={[s.headerCell, { width: `${COLS.name}%` }]}>Name</Text>
            <Text style={[s.headerCell, { width: `${COLS.qty}%` }]}>Qty</Text>
            <Text style={[s.headerCell, { width: `${COLS.rate}%` }]}>Selling Rate</Text>
            <Text style={[s.headerCell, { width: `${COLS.taxable}%` }]}>Taxable Amount</Text>
            <Text style={[s.headerCell, { width: `${COLS.gst}%` }]}>GST</Text>
          </View>

          {/* Rows */}
          {data.items.map((item, index) => (
            <View key={index} style={s.row} wrap={false}>
              <View style={[s.cell, { width: `${COLS.sno}%`, alignItems: "center" }]}>
                <Text>{item.item_order ?? index + 1}</Text>
              </View>
              <View style={[s.cell, { width: `${COLS.image}%`, alignItems: "center" }]}>
                {item.image ? <Image style={s.itemImage} src={item.image} /> : <Text> </Text>}
              </View>
              <View style={[s.cell, { width: `${COLS.code}%`, alignItems: "center" }]}>
                <Text>{item.sku ?? "—"}</Text>
              </View>
              <View style={[s.cell, { width: `${COLS.name}%` }]}>
                <Text style={s.itemName}>{item.name}</Text>
                {item.description ? <Text style={s.itemDesc}>{item.description}</Text> : null}
              </View>
              <View style={[s.cell, { width: `${COLS.qty}%`, alignItems: "center" }]}>
                <Text>{formatQty(item.quantity)}</Text>
              </View>
              <View style={[s.cell, { width: `${COLS.rate}%`, alignItems: "flex-end" }]}>
                <Text>{money(item.rate)}</Text>
              </View>
              <View style={[s.cell, { width: `${COLS.taxable}%`, alignItems: "flex-end" }]}>
                <Text>{money(item.item_sub_total ?? Number(item.rate ?? 0) * Number(item.quantity ?? 0))}</Text>
              </View>
              <View style={[s.cell, { width: `${COLS.gst}%`, alignItems: "center" }]}>
                <Text>{formatPct(item.tax_percentage)}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={s.totalsWrap}>
          <View style={s.totalsRow}>
            <Text style={s.totalsLabel}>Taxable amount</Text>
            <Text style={s.totalsValue}>{money(data.sub_total)}</Text>
          </View>
          <View style={s.totalsRow}>
            <Text style={s.totalsLabel}>GST</Text>
            <Text style={s.totalsValue}>{money(data.tax_total)}</Text>
          </View>
          <View style={[s.totalsRow, s.totalsRowLast]}>
            <Text style={[s.totalsLabel, s.grandLabel, s.grand]}>Total</Text>
            <Text style={[s.totalsValue, s.grand]}>{money(data.total)}</Text>
          </View>
          <View style={s.wordsRow}>
            <Text style={s.wordsLabel}>Total Quotation Amount in Words</Text>
            <Text style={s.wordsValue}>{amountInWords(data.total)}</Text>
          </View>
        </View>

        {/* Bank details & terms */}
        <View style={s.footer} wrap={false}>
          <View style={s.footerCol}>
            <Text style={s.footerHeading}>BANK DETAILS :</Text>
            {COMPANY.bank.map(([label, value], i) => (
              <Text key={i} style={s.bankLine}>
                {label} : {value}
              </Text>
            ))}
          </View>
          <View style={s.footerCol}>
            <Text style={s.footerHeading}>Terms &amp; Conditions:</Text>
            {COMPANY.terms.map((t, i) => (
              <Text key={i} style={s.termLine}>
                {i + 1}. {t}
              </Text>
            ))}
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(data: QuotePdfData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<QuoteDocument data={data} />);
}
