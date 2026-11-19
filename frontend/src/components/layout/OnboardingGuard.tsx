import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { odyssey } from "@/lib/api/odyssey";
import { Loader2 } from "lucide-react";

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    const checkProfile = async () => {
      try {
        // Step 1: Check if session is established
        console.log("OnboardingGuard: Checking session...");
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error("OnboardingGuard: Session check error:", sessionError);
          navigate({ to: "/login" });
          return;
        }

        console.log("OnboardingGuard: Session found:", !!session);
        
        if (!session) {
          console.log("OnboardingGuard: No session found, redirecting to /login");
          navigate({ to: "/login" });
          return;
        }

        // Step 2: Only fetch profile if session is confirmed
        console.log("OnboardingGuard: Session confirmed, checking profile...");
        const response = await odyssey.userProfile.get();
        
        console.log("OnboardingGuard: Profile check result:", response ? "success" : "fail");
        
        if (response && response.success && response.data) {
          console.log("OnboardingGuard: Profile exists, allowing access");
          setHasProfile(true);
        } else {
          // Profile doesn't exist (404) - redirect to onboarding
          console.log("OnboardingGuard: Profile not found (404), redirecting to /onboarding");
          navigate({ to: "/onboarding" });
          return;
        }
      } catch (error: any) {
        console.error("OnboardingGuard: Error checking profile:", error);
        
        // Check if this is a 401 error (unauthorized)
        if (error?.status === 401 || error?.response?.status === 401) {
          console.log("OnboardingGuard: 401 error, logging user out and redirecting to /login");
          await supabase.auth.signOut();
          navigate({ to: "/login" });
          return;
        }
        
        // Check if this is a 404 error (profile not found)
        if (error?.status === 404 || error?.response?.status === 404) {
          console.log("OnboardingGuard: 404 error (profile not found), redirecting to /onboarding");
          navigate({ to: "/onboarding" });
          return;
        }
        
        // For other errors, treat as "no profile found" to allow onboarding
        console.log("OnboardingGuard: Unknown error, redirecting to /onboarding");
        navigate({ to: "/onboarding" });
        return;
      } finally {
        setLoading(false);
      }
    };

    checkProfile();
  }, [navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasProfile) {
    return null;
  }

  return <>{children}</>;
}
