"use client";

import {
    createContext,
    useContext,
    useMemo,
    useState,
} from "react";

interface CommandContextValue {

    open: boolean;

    setOpen: (open: boolean) => void;

    toggle: () => void;

}

const CommandContext =
    createContext<CommandContextValue | null>(null);

export function CommandProvider({

    children,

}: {

    children: React.ReactNode;

}) {

    const [open, setOpen] = useState(false);

    const value = useMemo(() => ({

        open,

        setOpen,

        toggle: () => setOpen(v => !v),

    }), [open]);

    return (

        <CommandContext.Provider value={value}>

            {children}

        </CommandContext.Provider>

    );

}

export function useCommand() {

    const ctx = useContext(CommandContext);

    if (!ctx) {

        throw new Error("useCommand must be inside CommandProvider");

    }

    return ctx;

}