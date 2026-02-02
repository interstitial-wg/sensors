"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface Stats {
  sensors: number;
  agencies: number;
  providers: number;
}

const API_BASE =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_SENSORS_API_URL || "http://localhost:3001"
    : "http://localhost:3001";

const StatsContext = createContext<Stats | null>(null);

export function StatsProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const headers: HeadersInit = {};
    const key = process.env.NEXT_PUBLIC_SENSORS_API_KEY?.trim();
    if (key) headers["x-api-key"] = key;

    fetch(`${API_BASE}/api/v1/stats`, { headers })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  return (
    <StatsContext.Provider value={stats}>{children}</StatsContext.Provider>
  );
}

export function useStats() {
  return useContext(StatsContext);
}
