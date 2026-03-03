import type { Logger, MemoryStore, MemoryFilter, MemoryKind, MemoryScope, MemoryStatus, MemoryRecallOptions } from "@spaceduck/core";

export interface MemoryRouteDeps {
  readonly memoryStore: MemoryStore;
  readonly logger: Logger;
}

function parseScopeParam(raw: string | null): MemoryScope | undefined {
  if (!raw) return undefined;
  if (raw === "global") return { type: "global" };
  return undefined;
}

function parseKindsParam(raw: string | null): MemoryKind[] | undefined {
  if (!raw) return undefined;
  return raw.split(",").filter((k): k is MemoryKind => ["fact", "episode", "procedure"].includes(k));
}

function parseStatusParam(raw: string | null): MemoryStatus[] | undefined {
  if (!raw) return undefined;
  return raw.split(",").filter((s): s is MemoryStatus =>
    ["candidate", "active", "stale", "superseded", "archived"].includes(s),
  );
}

export async function handleMemoryRoute(
  req: Request,
  url: URL,
  deps: MemoryRouteDeps,
): Promise<Response | null> {
  const { memoryStore, logger } = deps;

  // GET /api/memories/search?q=...
  if (req.method === "GET" && url.pathname === "/api/memories/search") {
    const query = url.searchParams.get("q");
    if (!query) {
      return Response.json({ error: "Missing required query parameter: q" }, { status: 400 });
    }
    try {
      const options: MemoryRecallOptions = {
        kinds: parseKindsParam(url.searchParams.get("kinds")),
        scope: parseScopeParam(url.searchParams.get("scope")),
        status: parseStatusParam(url.searchParams.get("status")),
        topK: url.searchParams.has("topK") ? parseInt(url.searchParams.get("topK")!, 10) : 50,
        strategy: "hybrid",
      };
      const result = await memoryStore.recall(query, options);
      if (!result.ok) return Response.json({ error: result.error.message }, { status: 500 });
      return Response.json({ memories: result.value });
    } catch (e) {
      logger.error("Memory search failed", { error: String(e) });
      return Response.json({ error: "Search failed" }, { status: 500 });
    }
  }

  // GET /api/memories — list with optional filters
  if (req.method === "GET" && url.pathname === "/api/memories") {
    try {
      const filter: MemoryFilter = {
        kinds: parseKindsParam(url.searchParams.get("kinds")),
        status: parseStatusParam(url.searchParams.get("status")),
        scope: parseScopeParam(url.searchParams.get("scope")),
        limit: url.searchParams.has("limit") ? parseInt(url.searchParams.get("limit")!, 10) : 200,
      };
      const result = await memoryStore.list(filter);
      if (!result.ok) return Response.json({ error: result.error.message }, { status: 500 });
      return Response.json({ memories: result.value });
    } catch (e) {
      logger.error("Memory list failed", { error: String(e) });
      return Response.json({ error: "Failed to list memories" }, { status: 500 });
    }
  }

  // Match /api/memories/:id
  const idMatch = url.pathname.match(/^\/api\/memories\/([^/]+)$/);
  if (idMatch) {
    const memoryId = idMatch[1];

    // GET /api/memories/:id
    if (req.method === "GET") {
      try {
        const result = await memoryStore.get(memoryId);
        if (!result.ok) return Response.json({ error: result.error.message }, { status: 500 });
        if (!result.value) return Response.json({ error: "Memory not found" }, { status: 404 });
        return Response.json(result.value);
      } catch (e) {
        logger.error("Memory get failed", { error: String(e), memoryId });
        return Response.json({ error: "Failed to get memory" }, { status: 500 });
      }
    }

    // DELETE /api/memories/:id
    if (req.method === "DELETE") {
      try {
        const result = await memoryStore.delete(memoryId);
        if (!result.ok) return Response.json({ error: result.error.message }, { status: 500 });
        return Response.json({ status: "deleted" });
      } catch (e) {
        logger.error("Memory delete failed", { error: String(e), memoryId });
        return Response.json({ error: "Failed to delete memory" }, { status: 500 });
      }
    }
  }

  return null;
}
