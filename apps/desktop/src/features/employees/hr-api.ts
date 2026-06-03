import { API_BASE_URL } from "@/lib/api-config";

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(json?.message || "درخواست انجام نشد");
  }

  return json.data as T;
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(json?.message || "عملیات انجام نشد");
  }

  return json.data as T;
}
