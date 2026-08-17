import { describe, expect, it } from "vitest";
import { createOperationReference } from "./operation-id";

describe("createOperationReference", () => {
  it("creates collision-resistant, readable operation references", () => {
    const references = Array.from({ length: 10_000 }, () =>
      createOperationReference("TEST")
    );

    expect(new Set(references).size).toBe(references.length);
    expect(
      references.every((reference) =>
        /^TEST-[0-9A-Z]+-[0-9A-F]{32}$/.test(reference)
      )
    ).toBe(true);
  });
});
