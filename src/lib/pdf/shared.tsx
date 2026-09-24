/* eslint-disable jsx-a11y/alt-text -- <Image> here is the @react-pdf/renderer PDF primitive, not an HTML <img>; it has no alt prop. */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Font, Image, StyleSheet, Text, View } from "@react-pdf/renderer";

// Building blocks shared by the quote and dispatch PDFs: fonts, logo, company
// details, the page header, the "To," block and the base table styles.

// Fonts & logo -----------------------------------------------------------------
// Arimo is bundled: it is metrically identical to Arial (so it renders with the
// Arial look) and, unlike the built-in PDF fonts, includes the ₹ (rupee) glyph.

const assetDir = path.join(process.cwd(), "src", "lib", "pdf");

let fontsRegistered = false;
export function registerFonts() {
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
export const COMPANY = {
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

/** An item picture ready to embed in a PDF. */
export type PdfImage = { data: Buffer; format: "png" | "jpg" };

// Formatting helpers -----------------------------------------------------------
export function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

// Styles -----------------------------------------------------------------------
export const BORDER = "#000000";
export const MUTED = "#151826";
const BLUE = "#1877f2";
const INK = "#151826";
const TITLE_GREY = "#40535c";

export const baseStyles = StyleSheet.create({
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
});

const s = baseStyles;

// Components -------------------------------------------------------------------

/** Company name + address on the left, logo + document details (right-aligned lines) on the right, then a rule. */
export function PdfHeader({ metaLines }: { metaLines: [label: string, value: string][] }) {
  return (
    <>
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
            {metaLines.map(([label, value], i) => (
              <Text key={i} style={s.metaLine}>{`${label}: `}{value}</Text>
            ))}
          </View>
        </View>
      </View>

      <View style={s.rule} />
    </>
  );
}

/** The "To," block: customer name, address, phone, PAN and GST. */
export function PdfRecipient({
  name,
  address,
  phone,
  panNo,
  gstNo,
}: {
  name: string | null;
  address: Record<string, string> | null;
  phone: string | null;
  panNo: string | null;
  gstNo: string | null;
}) {
  const addr = address ?? {};
  const cityLine = [addr.city, addr.state, addr.zip].filter(Boolean).join(", ");

  return (
    <View>
      <Text style={s.toLabel}>To,</Text>
      <Text style={s.toName}>{name ?? "—"}</Text>
      {addr.attention ? <Text style={s.toLine}>{addr.attention}</Text> : null}
      {addr.address ? <Text style={s.toLine}>{addr.address}</Text> : null}
      {addr.street2 ? <Text style={s.toLine}>{addr.street2}</Text> : null}
      {cityLine ? <Text style={s.toLine}>{cityLine}</Text> : null}
      {addr.country ? <Text style={s.toLine}>{addr.country}</Text> : null}
      {phone ? <Text style={s.toLine}>{phone}</Text> : null}
      {panNo ? <Text style={s.toLine}>Pan No : {panNo}</Text> : null}
      {gstNo ? <Text style={s.toLine}>GST No : {gstNo}</Text> : null}
    </View>
  );
}
