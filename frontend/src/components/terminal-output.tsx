import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type LogLevel = "INFO" | "WARN" | "ERR" | "OK";
export interface LogLine {
  id: number;
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
}

const levelColor: Record<LogLevel, string> = {
  INFO: "text-terminal-foreground",
  OK: "text-success",
  WARN: "text-warning",
  ERR: "text-destructive",
};

interface Props {
  lines: LogLine[];
  className?: string;
  title?: string;
}

export function TerminalOutput({ lines, className, title = "terminal" }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-md border border-border bg-terminal shadow-[inset_0_0_40px_rgba(0,0,0,0.6)]",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-black/40 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/80" />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {title}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {lines.length} lines
        </span>
      </div>

      <div
        ref={ref}
        className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <div className="text-muted-foreground/60">
            <span className="text-primary-glow">$</span> awaiting orchestrator…
            <span className="ml-1 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-primary-glow" />
          </div>
        ) : (
          lines.map((l) => (
            <div key={l.id} className="flex gap-3 animate-in fade-in duration-200">
              <span className="shrink-0 text-muted-foreground/70">{l.ts}</span>
              <span
                className={cn(
                  "shrink-0 w-12 font-semibold",
                  levelColor[l.level],
                )}
              >
                {l.level}
              </span>
              <span className="shrink-0 text-primary-glow/80">[{l.source}]</span>
              <span className="text-terminal-foreground/90">{l.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
