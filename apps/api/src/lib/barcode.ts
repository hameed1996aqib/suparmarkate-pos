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