/* eslint-disable jsx-a11y/alt-text -- <Image> here is the @react-pdf/renderer PDF primitive, not an HTML <img>; it has no alt prop. */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import {
  Document,
  Font,
  Image,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { amountInWords } from "./amount-in-words";

// Fonts & logo -----------------------------------------------------------------
// Arimo is bundled: it is metrically identical to Arial (so it renders with the
// Arial look) and, unlike the built-in PDF fonts, includes the ₹ (rupee) glyph.

const assetDir = path.join(process.cwd(), "src", "lib", "pdf");

let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  Font.register({
    family: "Arimo",
    fonts: [
      { src: path.join(assetDir, "fonts", "Arimo-Regular.ttf") },
      { src: path.join(assetDir, "fonts", "Arimo-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // Keep long codes/words from being split across lines.
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

let logoData: Buffer | null = null;
function getLogo() {
  if (!logoData) logoData = fs.readFileSync(path.join(assetDir, "logo.png"));
  return logoData;
}

// Static company details (Hotel Essentials' own, as printed on the quote). -------
const COMPANY = {
  name: "HOTEL ESSENTIALS",
  addressLeft: [
    "Shree Laxmi Logistics Compound",
    "Eastern Bypass Road, Thakurnagar, P.O.",
    "Sahudangihaat, P.S. NJP",
    "GST NO : 19AARFH2182D1Z8",
    "PAN No : AARFH2182D",
    "Email : sales@hotelesssentialsIndia.com",
    "Contact No. : 9046262872/9933606434",
  ],
  addressRight: [
    "Hotel Essentials,",
    "Beside terai blood bank,",
    "lane opposite cosmos mall,",
    "Sevoke road,",
    "Siliguri",
    "A/c No. 44731803512",
    "IFSC code. SBIN0063991",
  ],
  bank: [
    ["Bank A/C Name", "HOTEL ESSENTIALS"],
    ["Bank Name", "STATE BANK OF INDIA"],
    ["Bank A/C No", "44731803512"],
    ["Bank Branch IFSC", "SBIN0063991"],
    ["Branch", "SME Hill Cart Road Siliguri"],
  ],
  terms: [
    "Packing & Forwarding: Rates are inclusive of delivery till Ex- Siliguri.",
    "Payment Terms: 80% advance payment required; the remaining 20% payable before delivery.",
    "Validity: Quotation is valid for 15 days from the date of issue.",
    "Delivery: Estimated delivery timeline will be confirmed upon order confirmation.",
  ],
};

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

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
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

const BLUE = "#1877f2";
const BORDER = "#000000";
const INK = "#151826";
const MUTED = "#151826";
const TITLE_GREY = "#40535c";

const s = StyleSheet.create({
  page: {
    fontFamily: "Arimo",
    fontSize: 7.5,
    color: INK,
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 26,
    lineHeight: 1.3,
  },
  // Header (pulled up ~15px so it sits a little higher on the page)
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: -15 },
  companyTitle: { fontSize: 19, fontWeight: "bold", letterSpacing: 0.5, marginBottom: 26, color: TITLE_GREY },
  addressCols: { flexDirection: "row", gap: 24 },
  addressCol: { flexGrow: 1, flexShrink: 1 },
  addrLine: { fontSize: 7.5, color: INK, marginBottom: 1.5 },
  logo: { width: 142, height: 57, objectFit: "contain", marginLeft: "auto" },
  metaRight: { marginTop: 18, textAlign: "right" },
  metaLine: { fontSize: 7.5, marginBottom: 2 },
  rule: { borderTopWidth: 1.5, borderTopColor: "#9ca3af", marginTop: 8, marginBottom: 12 },
  // To block
  toLabel: { fontWeight: "bold", fontSize: 8.5, marginBottom: 2 },
  toName: { fontWeight: "bold", fontSize: 11, marginBottom: 2 },
  toLine: { fontSize: 8.5, marginBottom: 1.5 },
  // Title
  title: { textAlign: "center", fontSize: 14, fontWeight: "bold", marginTop: 14, marginBottom: 10 },
  // Table
  table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: BORDER },
  row: { flexDirection: "row" },
  headerCell: {
    backgroundColor: BLUE,
    color: "#ffffff",
    fontSize: 7,
    paddingVertical: 6,
    paddingHorizontal: 3,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
    textAlign: "center",
  },
  cell: {
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
    justifyContent: "center",
  },
  itemImage: { width: 56, height: 56, objectFit: "contain", alignSelf: "center" },
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
});

function QuoteDocument({ data }: { data: QuotePdfData }) {
  const currency = data.currency_code ?? "INR";
  const money = moneyFmt(currency);
  const addr = data.billing_address ?? {};
  const cityLine = [addr.city, addr.state, addr.zip].filter(Boolean).join(", ");

  return (
    <Document title={`Quotation ${data.estimate_number}`} author="Hotel Essentials">
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.headerRow}>
          <View style={{ width: "68%" }}>
            <Text style={s.companyTitle}>{COMPANY.name}</Text>
            <View style={s.addressCols}>
              <View style={s.addressCol}>
                {COMPANY.addressLeft.map((l, i) => (
                  <Text key={i} style={s.addrLine}>{l}</Text>
                ))}
              </View>
              <View style={s.addressCol}>
                {COMPANY.addressRight.map((l, i) => (
                  <Text key={i} style={s.addrLine}>{l}</Text>
                ))}
              </View>
            </View>
          </View>
          <View style={{ width: "30%" }}>
            <Image style={s.logo} src={{ data: getLogo(), format: "png" }} />
            <View style={s.metaRight}>
              <Text style={s.metaLine}>Date: {formatDate(data.date)}</Text>
              <Text style={s.metaLine}>Quotation No: {data.estimate_number}</Text>
            </View>
          </View>
        </View>

        <View style={s.rule} />

        {/* To */}
        <View>
          <Text style={s.toLabel}>To,</Text>
          <Text style={s.toName}>{data.customer_name ?? "—"}</Text>
          {addr.attention ? <Text style={s.toLine}>{addr.attention}</Text> : null}
          {addr.address ? <Text style={s.toLine}>{addr.address}</Text> : null}
          {addr.street2 ? <Text style={s.toLine}>{addr.street2}</Text> : null}
          {cityLine ? <Text style={s.toLine}>{cityLine}</Text> : null}
          {addr.country ? <Text style={s.toLine}>{addr.country}</Text> : null}
          {data.phone ? <Text style={s.toLine}>{data.phone}</Text> : null}
          {data.pan_no ? <Text style={s.toLine}>Pan No : {data.pan_no}</Text> : null}
          {data.gst_no ? <Text style={s.toLine}>GST No : {data.gst_no}</Text> : null}
        </View>

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
