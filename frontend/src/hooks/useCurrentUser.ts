import { UserProfile } from "@/types/user";

export function useCurrentUser(): UserProfile | null {
  // Temporary placeholder.
  // Replace with Clerk/Auth.js/FastAPI JWT later.

  return {
    id: "1",
    name: "Demo User",
    email: "demo@example.com",
    avatarUrl: undefined,
  };
}