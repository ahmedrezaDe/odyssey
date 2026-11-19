import { ReactNode } from "react";

interface WorkspaceFooterProps {
    children: ReactNode;
    className?: string;
}

export function WorkspaceFooter({ children, className }: WorkspaceFooterProps) {
    return (
        <div className={`
            mt-6
            flex 
            items-center 
            justify-between
            border-t 
            border-border/50
            pt-4
            ${className}
        `}>
            {children}
        </div>
    );
}

interface FooterStatusProps {
    children: ReactNode;
    className?: string;
}

export function FooterStatus({ children, className }: FooterStatusProps) {
    return (
        <div className={`
            flex 
            items-center 
            gap-2
            text-sm 
            text-muted-foreground
            ${className}
        `}>
            {children}
        </div>
    );
}

interface FooterActionsProps {
    children: ReactNode;
    className?: string;
}

export function FooterActions({ children, className }: FooterActionsProps) {
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

interface FooterPaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    className?: string;
}

export function FooterPagination({ 
    currentPage, 
    totalPages, 
    onPageChange,
    className 
}: FooterPaginationProps) {
    return (
        <div className={`
            flex 
            items-center 
            gap-1
            ${className}
        `}>
            <button
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="
                    px-2 
                    py-1 
                    text-sm 
                    rounded 
                    border 
                    border-border/50
                    disabled:opacity-50
                    disabled:cursor-not-allowed
                    hover:bg-muted
                    transition-colors
                "
            >
                Previous
            </button>
            <span className="text-sm text-muted-foreground px-2">
                {currentPage} of {totalPages}
            </span>
            <button
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="
                    px-2 
                    py-1 
                    text-sm 
                    rounded 
                    border 
                    border-border/50
                    disabled:opacity-50
                    disabled:cursor-not-allowed
                    hover:bg-muted
                    transition-colors
                "
            >
                Next
            </button>
        </div>
    );
}