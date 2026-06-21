const API_BASE_URL_KEY = "muhaseb_api_base_url";

export function normalizeApiBaseUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value.trim())
    ? value.trim()
    : `http://${value.trim()}`;
  const parsed = new URL(withProtocol);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("آدرس سرور باید با http یا https باشد");
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export function getStoredApiBaseUrl() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(API_BASE_URL_KEY);
}

function getDefaultApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }

  if (typeof window !== "undefined") {
    const { protocol, origin, port } = window.location;
    const isHttp = protocol === "http:" || protocol === "https:";
    const isViteDevOrPreview = port === "5173" || port === "4173";

    if (isHttp && origin && !isViteDevOrPreview) {
      return origin;
    }
  }

  return "http://localhost:4000";
}

export function getApiBaseUrl() {
  const stored = getStoredApiBaseUrl();
  if (stored) return normalizeApiBaseUrl(stored);
  return normalizeApiBaseUrl(getDefaultApiBaseUrl());
}

export function saveApiBaseUrl(value: string) {
  const normalized = normalizeApiBaseUrl(value);
  window.localStorage.setItem(API_BASE_URL_KEY, normalized);
  return normalized;
}

export async function testApiBaseUrl(value: string) {
  const normalized = normalizeApiBaseUrl(value);
  const response = await fetch(`${normalized}/health`);
  if (!response.ok) throw new Error("سرور پاسخ معتبر نداد");
  const json = await response.json().catch(() => null);
  if (json?.status !== "ok") {
    throw new Error("اتصال دیتابیس سرور برقرار نیست");
  }
  return normalized;
}

export const API_BASE_URL = getApiBaseUrl();

export function getSystemHealthWebSocketUrl(token: string) {
  const api = new URL(API_BASE_URL);
  const protocol = api.protocol === "https:" ? "wss:" : "ws:";
  const port = import.meta.env.VITE_SYSTEM_HEALTH_WS_PORT || "4002";
  return `${protocol}//${api.hostname}:${port}?token=${encodeURIComponent(token)}`;
}
