import { useState, useEffect, useCallback, useRef } from "react";

function getAuth() {
  const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
  const token = localStorage.getItem("spaceduck.token");
  return { gatewayUrl, token };
}

async function memoryFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { gatewayUrl, token } = getAuth();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(`${gatewayUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface MemorySource {
  type: string;
  id?: string;
  conversationId?: string;
  runId?: string;
  toolName?: string;
  taskId?: string;
  skillId?: string;
}

export interface MemoryRecord {
  id: string;
  kind: "fact" | "episode" | "procedure";
  title: string;
  content: string;
  summary: string;
  scope: { type: string; projectId?: string; conversationId?: string; entityId?: string };
  entityRefs: string[];
  source: MemorySource;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  importance: number;
  confidence: number;
  status: string;
  supersededBy?: string;
  tags: string[];
  occurredAt?: number;
  expiresAt?: number;
  procedureSubtype?: string;
}

export interface ScoredMemory {
  memory: MemoryRecord;
  score: number;
  matchSource: string;
}

export interface MemoryFilters {
  kinds?: string;
  status?: string;
  scope?: string;
}

export interface UseMemoriesReturn {
  memories: MemoryRecord[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filters: MemoryFilters;
  setFilters: (f: MemoryFilters) => void;
  refresh: () => Promise<void>;
  deleteMemory: (id: string) => Promise<boolean>;
}

export function useMemories(): UseMemoriesReturn {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<MemoryFilters>({});
  const mountedRef = useRef(true);

  const buildFilterParams = useCallback((base: URLSearchParams) => {
    if (filters.kinds) base.set("kinds", filters.kinds);
    if (filters.status) base.set("status", filters.status);
    if (filters.scope) base.set("scope", filters.scope);
    return base;
  }, [filters]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      if (searchQuery.trim()) {
        const params = buildFilterParams(new URLSearchParams({ q: searchQuery.trim() }));
        const res = await memoryFetch<{ memories: ScoredMemory[] }>(
          `/api/memories/search?${params.toString()}`,
        );
        if (mountedRef.current) {
          setMemories(res.memories.map((sm) => sm.memory));
          setError(null);
        }
      } else {
        const params = buildFilterParams(new URLSearchParams());
        const qs = params.toString();
        const res = await memoryFetch<{ memories: MemoryRecord[] }>(
          `/api/memories${qs ? `?${qs}` : ""}`,
        );
        if (mountedRef.current) {
          setMemories(res.memories);
          setError(null);
        }
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load memories");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [searchQuery, buildFilterParams]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const deleteMemory = useCallback(async (id: string): Promise<boolean> => {
    try {
      await memoryFetch(`/api/memories/${id}`, { method: "DELETE" });
      if (mountedRef.current) {
        setMemories((prev) => prev.filter((m) => m.id !== id));
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete memory");
      return false;
    }
  }, []);

  return {
    memories,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,
    refresh: load,
    deleteMemory,
  };
}
