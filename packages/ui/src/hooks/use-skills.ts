import { useState, useEffect, useCallback } from "react";
import type { TaskBudget, TaskResultRoute } from "@spaceduck/core";

export interface SkillSummary {
  id: string;
  description: string;
  version?: string;
  author?: string;
  toolAllow?: string[];
  budget?: Partial<TaskBudget>;
  resultRoute?: TaskResultRoute;
}

function getAuth() {
  const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
  const token = localStorage.getItem("spaceduck.token");
  return { gatewayUrl, token };
}

export interface UseSkillsReturn {
  skills: SkillSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useSkills(): UseSkillsReturn {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { gatewayUrl, token } = getAuth();
    if (!gatewayUrl) {
      setLoading(false);
      return;
    }
    try {
      const headers: Record<string, string> = {};
      if (token) headers["authorization"] = `Bearer ${token}`;
      const res = await fetch(`${gatewayUrl}/api/skills`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { skills: SkillSummary[] };
      setSkills(data.skills);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { skills, loading, error, refresh: load };
}
