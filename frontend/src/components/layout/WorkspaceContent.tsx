import { ReactNode } from "react";

interface WorkspaceContentProps {
    children: ReactNode;
    className?: string;
}

export function WorkspaceContent({ children, className }: WorkspaceContentProps) {
    return (
        <div className={`
            flex-1 
            overflow-y-auto 
            overflow-x-hidden
            ${className}
        `}>
            <div className="h-full">
                {children}
            </div>
        </div>
    );
}

interface ContentSectionProps {
    children: ReactNode;
    className?: string;
    title?: string;
}

export function ContentSection({ children, className, title }: ContentSectionProps) {
    return (
        <section className={`
            mb-6
            ${className}
        `}>
            {title && (
                <h2 className="text-lg font-medium mb-3 text-foreground">
                    {title}
                </h2>
            )}
            {children}
        </section>
    );
}