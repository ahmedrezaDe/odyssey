import { ChevronDown } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { UserAvatar } from "@/components/user/user-avatar";

export function UserMenu() {
    const user = useCurrentUser();

    return (
        <button
            className="
            flex
            items-center
            gap-2
            rounded-lg
            border
            border-border
            px-2
            py-1.5
            hover:bg-muted
        "
        >
            <UserAvatar name={user?.name} />

            <span className="text-sm">
                {user?.name ?? "Guest"}
            </span>

            <ChevronDown className="h-4 w-4" />
        </button>
    );
}