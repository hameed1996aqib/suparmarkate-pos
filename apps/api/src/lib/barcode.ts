import bwipjs from "bwip-js";

export function normalizeBarcodeText(value: string) {
  const digitMap: Record<string, string> = {
    "۰": "0",
    "۱": "1",
    "۲": "2",
    "۳": "3",
    "۴": "4",
    "۵": "5",
    "۶": "6",
    "۷": "7",
    "۸": "8",
    "۹": "9",
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9"
  };

  return value
    .trim()
    .replace(/[۰-۹٠-٩]/g, (digit) => digitMap[digit] || digit)
    .replace(/[\s\u200b\u200c\u200d\u2060-]/g, "");
}

export function detectBarcodeType(text: string) {
  const value = normalizeBarcodeText(text);

  if (/^\d{13}$/.test(value)) {
    return "ean13";
  }

  if (/^\d{8}$/.test(value)) {
    return "ean8";
  }

  if (/^\d{12}$/.test(value)) {
    return "upca";
  }

  return "code128";
}

function ean13CheckDigit(first12Digits: string) {
  const sum = first12Digits
    .split("")
    .reduce((total, digit, index) => {
      return total + Number(digit) * (index % 2 === 0 ? 1 : 3);
    }, 0);

  return String((10 - (sum % 10)) % 10);
}

export function generateProductBarcodeCandidate() {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  const first12 = `20${timestamp}${random}`.slice(0, 12);

  return `${first12}${ean13CheckDigit(first12)}`;
}

export function buildBarcodeOptions(input: {
  text: string;
  format?: string | null;
}) {
  const text = normalizeBarcodeText(input.text);
  const bcid = input.format?.trim() || detectBarcodeType(text);

  return {
    bcid,
    text,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: "center",
    backgroundcolor: "FFFFFF"
  };
}

export async function renderBarcodePng(input: {
  text: string;
  format?: string | null;
}) {
  const options = buildBarcodeOptions(input);

  return bwipjs.toBuffer(options);
}

export function renderBarcodeSvg(input: {
  text: string;
  format?: string | null;
}) {
  const options = buildBarcodeOptions(input);

  return bwipjs.toSVG(options);
}
