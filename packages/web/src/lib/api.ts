export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { error?: unknown };
  if (!res.ok) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : data.error
          ? JSON.stringify(data.error)
          : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}
