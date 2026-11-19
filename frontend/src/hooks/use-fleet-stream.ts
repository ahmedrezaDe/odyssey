// Live SSE replacement for useFleetSimulator. Falls back to the simulator
// when VITE_ODYSSEY_API_URL is not set or the backend is unreachable.
import { useCallback, useEffect, useRef, useState } from "react";
import type { LogLine, LogLevel } from "@/components/terminal-output";
import type { FleetStatus } from "@/components/master-start-button";
import { odyssey } from "@/lib/api/odyssey";
import { useFleetSimulator } from "./use-fleet-simulator";

type Event = { ts: string; level: LogLevel; source: string; message: string };

export function useFleetStream() {
  const sim = useFleetSimulator();
  const [status, setStatus] = useState<FleetStatus>("idle");
  const [lines, setLines] = useState<LogLine[]>([]);
  const [useBackend, setUseBackend] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const idRef = useRef(0);

  const enabled = odyssey.configured();
  
  useEffect(() => {
    if (!enabled) {
      setUseBackend(false);
      return;
    }

    // Test backend connection
    odyssey.fleet.health()
      .then((h) => {
        setStatus(h.status as FleetStatus);
        setUseBackend(true);
      })
      .catch(() => {
        setUseBackend(false);
      });
  }, [enabled]);

  useEffect(() => {
    if (!useBackend) return;

    const es = new EventSource(odyssey.fleet.logsUrl());
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const e: Event = JSON.parse(ev.data);
        idRef.current += 1;
        setLines((prev) => {
          const next = [...prev, { id: idRef.current, ...e }];
          return next.length > 200 ? next.slice(-200) : next;
        });
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      setStatus("idle");
      setUseBackend(false);
    };
    return () => es.close();
  }, [useBackend]);

  const toggle = useCallback(async () => {
    if (useBackend) {
      if (status === "idle") {
        setStatus("initializing");
        await odyssey.fleet.start().catch(() => {
          setStatus("idle");
          setUseBackend(false);
        });
        setStatus("running");
      } else {
        await odyssey.fleet.stop().catch(() => {});
        setStatus("idle");
      }
    } else {
      sim.toggle();
    }
  }, [status, useBackend, sim]);

  if (!useBackend) return sim;
  return { status, lines, toggle };
}
