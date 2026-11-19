import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type FeedLevel = "INFO" | "WARN" | "ERR" | "OK";
export interface FeedItem {
  id: number;
  ts: string;
  level: FeedLevel;
  source: string;
  message: string;
}

const levelMeta: Record<
  FeedLevel,
  { label: string; dot: string }
> = {
  INFO: { label: "Info",      dot: "bg-muted-foreground/60" },
  OK:   { label: "Success",   dot: "bg-success" },
  WARN: { label: "Warning",   dot: "bg-warning" },
  ERR:  { label: "Error",     dot: "bg-destructive" },
};

interface Props {
  items: FeedItem[];
  className?: string;
  title?: string;
  emptyLabel?: string;
}

export function ActivityFeed({
  items,
  className,
  title = "Activity",
  emptyLabel = "No activity yet. Start a workflow to see events here.",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-md border border-border bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary-glow" />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            {title}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {items.length} event{items.length === 1 ? "" : "s"}
        </span>
      </div>

      <div ref={ref} className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex h-full min-h-[120px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((it) => {
              const meta = levelMeta[it.level];
              return (
                <div
                  key={it.id}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-secondary/50"
                >
                  <span className={cn("mt-1.5 flex h-2 w-2 shrink-0 rounded-full ring-2 ring-background", meta.dot)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <p className="text-sm text-foreground/90">
                        {it.message}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {it.ts}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/70">
                        {it.source}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
