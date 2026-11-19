// components/user-avatar.tsx

interface Props {
    name?: string
}

export function UserAvatar({ name }: Props) {

    const initials =
        name
            ?.split(" ")
            .map(n => n[0])
            .join("")
            .slice(0,2)
            .toUpperCase() ?? "?";

    return (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {initials}
        </div>
    )
}