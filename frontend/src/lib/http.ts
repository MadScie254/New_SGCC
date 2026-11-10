// Typed helpers over the console's axios instance (API key header, base URL). Workspace API
// modules (src/lib/api/*.ts) use these instead of creating their own client.
import { api } from "@/lib/api";

type Params = Record<string, string | number | boolean | undefined | null>;

function clean(params?: Params) {
  if (!params) return undefined;
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null));
}

export async function httpGet<T>(url: string, params?: Params): Promise<T> {
  return (await api.get<T>(url, { params: clean(params) })).data;
}

export async function httpPost<T>(url: string, body?: unknown, params?: Params): Promise<T> {
  return (await api.post<T>(url, body ?? {}, { params: clean(params) })).data;
}

export async function httpDelete(url: string): Promise<void> {
  await api.delete(url);
}

/** Download a binary response (PDF, PNG, CSV) and hand it to the browser as a file. */
export async function httpDownload(url: string, filename: string, params?: Params): Promise<void> {
  const response = await api.get<Blob>(url, { params: clean(params), responseType: "blob" });
  const href = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
