type SystemStatus = "Ready" | "Processing" | "Idle" | "Error";

interface StatusConfig {
    color: string;
    pulse: boolean;
}

const statusConfig: Record<SystemStatus, StatusConfig> = {
    Ready: { color: "bg-green-500", pulse: false },
    Processing: { color: "bg-blue-500", pulse: true },
    Idle: { color: "bg-yellow-500", pulse: false },
    Error: { color: "bg-red-500", pulse: true },
};

export function ActivityStrip() {
    const currentStatus: SystemStatus = "Ready";
    const config = statusConfig[currentStatus];

    return (
        <footer
            className="
                flex
                h-10
                items-center
                justify-between
                border-t
                border-border
                bg-card/50
                px-4
            "
        >
            <div className="flex items-center gap-2">
                <div
                    className={`
                        h-2
                        w-2
                        rounded-full
                        ${config.color}
                        ${config.pulse ? "animate-pulse" : ""}
                    `}
                />
                <span
                    className="
                        text-xs
                        text-muted-foreground
                    "
                >
                    {currentStatus}
                </span>
            </div>
            <span
                className="
                    text-xs
                    text-muted-foreground/60
                "
            >
                System operational
            </span>
        </footer>
    );
}