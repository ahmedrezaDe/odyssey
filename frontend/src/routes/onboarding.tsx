import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { odyssey } from "@/lib/api/odyssey";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, User, MapPin, Briefcase, Settings } from "lucide-react";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Complete Your Profile — Odyssey AI" },
      { name: "description", content: "Set up your profile to get personalized job recommendations." },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const [loading, setLoading] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    location: "",
    job_titles: "",
    resume_text: "",
    tech_stack: "",
    preferences: {
      remote_only: false,
      min_salary: "",
      job_types: [] as string[],
    },
  });

  useEffect(() => {
    checkExistingProfile();
  }, []);

  const checkExistingProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/login";
        return;
      }

      const response = await odyssey.userProfile.get();
      // response will be null if profile doesn't exist (404), which is expected for new users
      if (response && response.success && response.data) {
        setHasProfile(true);
        toast.success("Profile already exists, redirecting...");
        setTimeout(() => {
          window.location.href = "/";
        }, 1000);
      }
      // If response is null (404), user has no profile - allow them to proceed with creation
    } catch (error) {
      console.error("Error checking profile:", error);
      // Treat errors as "no profile found" to allow creation
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Not authenticated");
        return;
      }

      // Convert comma-separated string fields to arrays
      const techStackArray = formData.tech_stack
        .split(",")
        .map(t => t.trim())
        .filter(Boolean);

      const jobTitlesArray = formData.job_titles
        .split(",")
        .map(t => t.trim())
        .filter(Boolean);

      // Convert numeric fields to integers
      const minSalaryValue = formData.preferences.min_salary 
        ? parseInt(formData.preferences.min_salary, 10) 
        : undefined;

      const profileData = {
        user_id: user.id,
        resume_text: formData.resume_text || `${formData.name} - ${formData.job_titles}\nLocation: ${formData.location}`,
        tech_stack: techStackArray,
        preferences: {
          ...formData.preferences,
          name: formData.name,
          location: formData.location,
          job_titles: jobTitlesArray,
          min_salary: minSalaryValue,
        },
      };

      console.log("Submitting profile data:", profileData);

      const response = await odyssey.userProfile.upsert(profileData);
      
      if (response.success) {
        toast.success("Profile created successfully!");
        setTimeout(() => {
          window.location.href = "/";
        }, 1000);
      } else {
        toast.error("Failed to create profile");
      }
    } catch (error: any) {
      console.error("FORM SUBMIT ERROR:", error);
      if (error.response) console.error("DATA:", error.response.data);
      toast.error("Error creating profile");
    } finally {
      setLoading(false);
    }
  };

  if (hasProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-2xl p-8 border-2 border-border shadow-playful">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Complete Your Profile</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Tell us about yourself to get personalized job recommendations
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Full Name
              </Label>
              <Input
                id="name"
                placeholder="John Doe"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="border-2 border-border"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location" className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Location
              </Label>
              <Input
                id="location"
                placeholder="San Francisco, CA"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                required
                className="border-2 border-border"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="job_titles" className="flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Job Titles (comma-separated)
            </Label>
            <Input
              id="job_titles"
              placeholder="Software Engineer, Frontend Developer, Full Stack"
              value={formData.job_titles}
              onChange={(e) => setFormData({ ...formData, job_titles: e.target.value })}
              required
              className="border-2 border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tech_stack">Tech Stack (comma-separated)</Label>
            <Input
              id="tech_stack"
              placeholder="React, TypeScript, Python, PostgreSQL"
              value={formData.tech_stack}
              onChange={(e) => setFormData({ 
                ...formData, 
                tech_stack: e.target.value
              })}
              className="border-2 border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="resume_text">Resume / Bio (optional)</Label>
            <Textarea
              id="resume_text"
              placeholder="Tell us about your experience, skills, and career goals..."
              value={formData.resume_text}
              onChange={(e) => setFormData({ ...formData, resume_text: e.target.value })}
              rows={4}
              className="border-2 border-border"
            />
          </div>

          <div className="space-y-4">
            <Label className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Preferences
            </Label>
            
            <div className="space-y-2">
              <Label htmlFor="min_salary">Minimum Salary (optional)</Label>
              <Input
                id="min_salary"
                type="number"
                placeholder="80000"
                value={formData.preferences.min_salary}
                onChange={(e) => setFormData({
                  ...formData,
                  preferences: { ...formData.preferences, min_salary: e.target.value }
                })}
                className="border-2 border-border"
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full h-11 border-2 border-primary/60 bg-primary/15 font-bold text-primary-foreground shadow-playful-sm hover:shadow-playful hover:-translate-y-0.5 hover:animate-wiggle active:scale-95 transition-all duration-200"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Complete Setup"
            )}
          </Button>
        </form>
      </Card>
    </div>
  );
}
