import { describe, expect, it } from "vitest";
import { barcodeSearchCandidates, normalizeBarcodeText } from "./barcode";

describe("barcode normalization", () => {
  it("normalizes Persian and Arabic digits", () => {
    expect(normalizeBarcodeText("\u06f1\u06f2\u06f3-\u0664\u0665\u0666")).toBe(
      "123456"
    );
  });

  it("removes whitespace and invisible separators", () => {
    expect(normalizeBarcodeText(" 6263\u200c 9818-02863 ")).toBe(
      "6263981802863"
    );
  });

  it("keeps raw and normalized candidates without duplicates", () => {
    expect(barcodeSearchCandidates(" 123-45 ")).toEqual([
      "123-45",
      "12345"
    ]);
    expect(barcodeSearchCandidates("12345")).toEqual(["12345"]);
  });
});
