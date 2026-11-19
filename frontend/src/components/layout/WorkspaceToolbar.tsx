import { ReactNode } from "react";

interface WorkspaceToolbarProps {
    children: ReactNode;
    className?: string;
}

export function WorkspaceToolbar({ children, className }: WorkspaceToolbarProps) {
    return (
        <div className={`
            mb-4
            flex 
            flex-wrap 
            items-center 
            gap-3 
            border-b 
            border-border/50
            pb-4
            ${className}
        `}>
            {children}
        </div>
    );
}

interface ToolbarSectionProps {
    children: ReactNode;
    className?: string;
}

export function ToolbarSection({ children, className }: ToolbarSectionProps) {
    return (
        <div className={`
            flex 
            items-center 
            gap-2
            ${className}
        `}>
            {children}
        </div>
    );
}

interface ToolbarDividerProps {
    className?: string;
}

export function ToolbarDivider({ className }: ToolbarDividerProps) {
    return (
        <div className={`
            h-6 
            w-px 
            bg-border/50
            ${className}
        `} />
    );
}