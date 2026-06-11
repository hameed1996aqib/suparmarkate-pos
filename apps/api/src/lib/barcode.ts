import bwipjs from "bwip-js";

export function normalizeBarcodeText(value: string) {
  return value.trim();
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
