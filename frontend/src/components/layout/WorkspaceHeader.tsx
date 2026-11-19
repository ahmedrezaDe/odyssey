import { ReactNode } from "react";

interface WorkspaceHeaderProps {
    title: string;
    description?: string;
    actions?: ReactNode;
    badge?: ReactNode;
}

export function WorkspaceHeader({
    title,
    description,
    actions,
    badge
}: WorkspaceHeaderProps) {
    return (
        <div className="mb-8 flex items-start justify-between gap-6 animate-fade-in-stagger-1">
            <div className="flex-1">
                <div className="flex items-center gap-4 mb-3">
                    <h1 className="font-display text-3xl font-semibold tracking-tight leading-none">
                        {title}
                    </h1>
                    {badge && (
                        <div className="flex-shrink-0">
                            {badge}
                        </div>
                    )}
                </div>
                {description && (
                    <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
                        {description}
                    </p>
                )}
            </div>
            {actions && (
                <div className="flex flex-shrink-0 items-center gap-3">
                    {actions}
                </div>
            )}
        </div>
    );
}