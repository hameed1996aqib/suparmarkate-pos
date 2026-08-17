import { describe, expect, it } from "vitest";
import { posCartRoute } from "./routes";

describe("POS browser cart page", () => {
  it("ships valid browser JavaScript and a stable sale operation ID", async () => {
    const response = await posCartRoute.request(
      "http://localhost/sessions/test-session"
    );
    const html = await response.text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";

    expect(response.status).toBe(200);
    expect(script).not.toContain("createOperationReference(");
    expect(script).toContain('"Idempotency-Key": operationId');
    expect(script).toContain("clientRequestId: operationId");
    expect(() => new Function(script)).not.toThrow();
  });
});
