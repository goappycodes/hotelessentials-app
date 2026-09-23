// Converts an amount to words using the Indian numbering system
// (thousand / lakh / crore), e.g. 22347.50 →
// "Twenty-Two Thousand, Three Hundred And Forty-Seven Rupees and Fifty Paise".

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

// Words for a number in 0..99, hyphenating compound tens (Forty-Seven).
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const ones = n % 10;
  return ones ? `${tens}-${ONES[ones]}` : tens;
}

// Words for a number in 0..999, with "And" before the tens (Three Hundred And Forty-Seven).
function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return twoDigits(rest);
  const head = `${ONES[hundreds]} Hundred`;
  return rest ? `${head} And ${twoDigits(rest)}` : head;
}

// Words for a whole number using Indian grouping (crore, lakh, thousand).
function wholeInWords(n: number): string {
  if (n === 0) return "Zero";

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = n % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${wholeInWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  return parts.join(", ");
}

export function amountInWords(amount: number | null | undefined, currencyName = "Rupees"): string {
  const value = Number(amount ?? 0);
  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);

  const rupeeWords = `${wholeInWords(rupees)} ${currencyName}`;
  if (paise > 0) return `${rupeeWords} and ${twoDigits(paise)} Paise`;
  return `${rupeeWords} Only`;
}
