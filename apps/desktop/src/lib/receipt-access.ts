type ReceiptAccessResponse = {
  data?: {
    path?: string;
  };
  message?: string;
};

function tokenEndpoint(pathname: string) {
  const patterns = [
    /^\/api\/pos-receipts\/sales\/([^/]+)\/html$/,
    /^\/api\/receipts\/sales\/([^/]+)\/html$/,
    /^\/api\/receipts\/party-payments\/([^/]+)\/html$/
  ];
  for (const pattern of patterns) {
    if (pattern.test(pathname)) return pathname.replace(/\/html$/, "/token");
  }
  return null;
}

export async function refreshReceiptAccessUrl(url: string) {
  if (!url || url.startsWith("data:")) return url;
  const parsedUrl = new URL(url, window.location.href);
  const endpoint = tokenEndpoint(parsedUrl.pathname);
  if (!endpoint) return url;

  const response = await fetch(`${parsedUrl.origin}${endpoint}`, {
    method: "POST"
  });
  const json = (await response.json().catch(() => null)) as ReceiptAccessResponse | null;
  if (!response.ok || !json?.data?.path) {
    throw new Error(json?.message || "ساخت لینک امن رسید ناکام شد");
  }

  const secureUrl = new URL(json.data.path, parsedUrl.origin);
  for (const [key, value] of parsedUrl.searchParams) {
    if (key !== "accessToken" && !secureUrl.searchParams.has(key)) {
      secureUrl.searchParams.set(key, value);
    }
  }
  return secureUrl.toString();
}
