function fallbackRandomUuid() {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

try {
  const cryptoApi = globalThis.crypto;

  if (cryptoApi && typeof cryptoApi.randomUUID !== "function") {
    Object.defineProperty(cryptoApi, "randomUUID", {
      configurable: true,
      value: fallbackRandomUuid,
    });
  }
} catch {
  // Some older browser shells expose a locked crypto object. In that case the
  // app-level createClientId fallback still keeps Muhaseb usable.
}

