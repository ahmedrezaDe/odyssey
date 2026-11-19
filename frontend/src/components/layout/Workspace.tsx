import { ReactNode } from "react";

interface Props {
    children: ReactNode;
}

export function Workspace({ children }: Props) {
    return (
        <main className="flex-1 overflow-y-auto bg-background">
            <div className="mx-auto h-full w-full max-w-[1400px] p-6">
                {children}
            </div>
        </main>
    );
}