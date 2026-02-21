import { CliError, type GlobalOpts } from "../index";

export async function apiFetch<T>(
  opts: GlobalOpts,
  path: string,
  init?: RequestInit,
): Promise<{ data: T; headers: Headers }> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (init?.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(`${opts.gateway}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CliError(`Cannot reach gateway at ${opts.gateway}`);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    if (res.status === 401) {
      throw new CliError("Unauthorized. Pass --token or set SPACEDUCK_TOKEN.");
    }
    if (res.status === 409) {
      throw new CliError("Conflict: config was modified concurrently. Retry.");
    }
    throw new CliError(body.error ?? `HTTP ${res.status}`);
  }

  const data = await res.json() as T;
  return { data, headers: res.headers };
}
