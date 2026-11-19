import { useEffect, useRef, useState, useCallback } from "react";
import type { FeedItem, FeedLevel } from "@/components/activity-feed";
import type { FleetStatus } from "@/components/master-start-button";

// Kept for backwards-compatible imports elsewhere in the app.
export type LogLine = FeedItem;
export type LogLevel = FeedLevel;

const bootScript: Array<{ level: FeedLevel; source: string; message: string }> = [
  { level: "INFO", source: "Runtime",         message: "Initializing workspace runtime…" },
  { level: "INFO", source: "Workflows",       message: "Loading workflow definitions from registry" },
  { level: "OK",   source: "Workflows",       message: "3 workflows registered and ready" },
  { level: "INFO", source: "Document Studio", message: "Initializing document parser…" },
  { level: "INFO", source: "Inbound Gateway", message: "Establishing secure mail connection" },
  { level: "OK",   source: "Inbound Gateway", message: "Inbound channel established" },
  { level: "INFO", source: "Intake Pipeline", message: "Warming classifier model…" },
  { level: "OK",   source: "Intake Pipeline", message: "Pipeline ready · model warm" },
  { level: "OK",   source: "Runtime",         message: "Workspace active — accepting work" },
];

const tickScript: Array<{ level: FeedLevel; source: string; message: string }> = [
  { level: "INFO", source: "Inbound Gateway", message: "Polling inbox · no new messages" },
  { level: "INFO", source: "Intake Pipeline", message: "Health check passed · queue empty" },
  { level: "OK",   source: "Document Studio", message: "Template cache refreshed" },
  { level: "WARN", source: "Inbound Gateway", message: "Rate-limit window at 80%" },
  { level: "INFO", source: "Runtime",         message: "System heartbeat · latency 4ms" },
];

export function useFleetSimulator() {
  const [status, setStatus] = useState<FleetStatus>("idle");
  const [lines, setLines] = useState<FeedItem[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const append = useCallback((level: FeedLevel, source: string, message: string) => {
    const d = new Date();
    const ts = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    idRef.current += 1;
    setLines((prev) => {
      const next = [...prev, { id: idRef.current, ts, level, source, message }];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  const clearTimers = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  };

  const start = useCallback(() => {
    setStatus("initializing");
    setLines([]);
    idRef.current = 0;
    bootScript.forEach((entry, i) => {
      const t = setTimeout(() => {
        append(entry.level, entry.source, entry.message);
        if (i === bootScript.length - 1) setStatus("running");
      }, 400 + i * 550);
      timersRef.current.push(t);
    });
  }, [append]);

  const stop = useCallback(() => {
    clearTimers();
    append("WARN", "Runtime", "Pause requested by operator");
    append("INFO", "Runtime", "Stopping active workflows…");
    append("OK",   "Runtime", "Workspace paused");
    setStatus("idle");
  }, [append]);

  const toggle = useCallback(() => {
    if (status === "idle") start();
    else stop();
  }, [status, start, stop]);

  useEffect(() => {
    if (status !== "running") return;
    const interval = setInterval(() => {
      const e = tickScript[Math.floor(Math.random() * tickScript.length)];
      append(e.level, e.source, e.message);
    }, 2200);
    return () => clearInterval(interval);
  }, [status, append]);

  useEffect(() => () => clearTimers(), []);

  return { status, lines, toggle };
}
