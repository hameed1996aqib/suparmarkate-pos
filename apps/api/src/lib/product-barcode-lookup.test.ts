import { describe, expect, it } from "vitest";

import { barcodeLookupStatus } from "./product-barcode-lookup";

describe("product barcode lookup status", () => {
  it("classifies exact lookup result counts", () => {
    expect(barcodeLookupStatus(0)).toBe("NOT_FOUND");
    expect(barcodeLookupStatus(1)).toBe("FOUND");
    expect(barcodeLookupStatus(2)).toBe("AMBIGUOUS");
    expect(barcodeLookupStatus(20)).toBe("AMBIGUOUS");
  });
});
