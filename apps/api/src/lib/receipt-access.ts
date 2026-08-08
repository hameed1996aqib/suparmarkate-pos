import type { Context } from "hono";
import {
  createResourceAccessToken,
  verifyResourceAccessToken
} from "./resource-access-token";

export function issueReceiptAccess(
  c: Context,
  input: { resource: string; id: string; htmlPath: string }
) {
  const { token, expiresAt } = createResourceAccessToken({
    resource: input.resource,
    id: input.id,
    ttlSeconds: Number(process.env.RECEIPT_TOKEN_TTL_SECONDS || 180)
  });
  const separator = input.htmlPath.includes("?") ? "&" : "?";
  return c.json({
    data: {
      token,
      expiresAt,
      path: `${input.htmlPath}${separator}accessToken=${encodeURIComponent(token)}`
    }
  });
}

export function requireReceiptAccess(
  c: Context,
  input: { resource: string; id: string }
) {
  const token = c.req.query("accessToken") || "";
  if (
    token &&
    verifyResourceAccessToken(token, {
      resource: input.resource,
      id: input.id
    })
  ) {
    return null;
  }
  if (process.env.ALLOW_LEGACY_PUBLIC_RECEIPTS === "true") return null;
  return c.json({ message: "لینک رسید نامعتبر یا منقضی شده است" }, 401);
}
