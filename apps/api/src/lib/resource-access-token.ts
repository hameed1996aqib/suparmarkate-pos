import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type ResourceTokenPayload = {
  resource: string;
  id: string;
  exp: number;
  nonce: string;
};

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 24) {
    throw new Error("JWT_SECRET must be set and contain at least 24 characters");
  }
  return value;
}

function encode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signature(payload: string) {
  return encode(createHmac("sha256", secret()).update(payload).digest());
}

export function createResourceAccessToken(input: {
  resource: string;
  id: string;
  ttlSeconds?: number;
}) {
  const ttlSeconds = Math.max(30, Math.min(900, input.ttlSeconds || 180));
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const payload = encode(
    JSON.stringify({
      resource: input.resource,
      id: input.id,
      exp: Math.floor(expiresAt.getTime() / 1000),
      nonce: randomBytes(8).toString("hex")
    } satisfies ResourceTokenPayload)
  );

  return {
    token: `${payload}.${signature(payload)}`,
    expiresAt
  };
}

export function verifyResourceAccessToken(
  token: string,
  expected: { resource: string; id: string }
) {
  try {
    const [payload, suppliedSignature, extra] = token.split(".");
    if (!payload || !suppliedSignature || extra) return false;
    const expectedSignature = signature(payload);
    const suppliedBuffer = Buffer.from(suppliedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      return false;
    }

    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Partial<ResourceTokenPayload>;
    return (
      parsed.resource === expected.resource &&
      parsed.id === expected.id &&
      Number(parsed.exp || 0) * 1000 > Date.now()
    );
  } catch {
    return false;
  }
}
