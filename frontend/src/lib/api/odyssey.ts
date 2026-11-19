// Typed fetch wrapper for the Odyssey FastAPI backend (api.py).
// For authenticated requests, we use the Supabase auth token.

import { supabase } from "../supabase";

export interface StatsData {
  total_scraped: number;
  status_counts: {
    new: number;
    approved: number;
    applied: number;
    interview: number;
    rejected: number;
  };
  pipeline_count: number;
  success_rate: number;
  monthly_progress: Array<{ date: string; applications: number }>;
}

const API_BASE_URL = import.meta.env.VITE_ODYSSEY_API_URL;

if (!API_BASE_URL) {
  console.error("CRITICAL: VITE_ODYSSEY_API_URL is undefined!");
}

function readConfig(): { baseUrl: string } {
  if (typeof window === "undefined") return { baseUrl: "" };
  try {
    const raw = window.localStorage.getItem("odyssey.settings");
    if (!raw) return { baseUrl: "" };
    const parsed = JSON.parse(raw) as { apiBaseUrl?: unknown };
    return {
      baseUrl: typeof parsed.apiBaseUrl === "string" ? parsed.apiBaseUrl : "",
    };
  } catch {
    return { baseUrl: "" };
  }
}

const BASE = () => {
  // Prioritize environment variable, fall back to localStorage config
  const envBaseUrl = API_BASE_URL || "";
  if (envBaseUrl) {
    return envBaseUrl.replace(/\/$/, "");
  }

  const configBaseUrl = readConfig().baseUrl;
  // Return empty string for relative paths (same domain)
  return configBaseUrl ? configBaseUrl.replace(/\/$/, "") : "";
};

async function getAuthHeaders(): Promise<Record<string, string>> {
  // Get Supabase auth token for user-specific requests
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  // Only add Authorization header if we have a valid token
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }

  // No session - return empty headers (will trigger 401)
  return {};
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  // 1. Force the client to await the real session from Supabase
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  // 2. STRICT VALIDATION: Never attach a malformed string
  if (token && token !== "undefined" && token !== "null") {
    // Strip any potential whitespace and validate token format
    const cleanToken = token.trim();

    // Validate JWT format (3 segments separated by dots)
    const segmentCount = cleanToken.split(".").length;
    if (segmentCount !== 3) {
      console.error(`🚨 Invalid token format: Expected 3 segments, got ${segmentCount}`);
      console.error(
        `Token length: ${cleanToken.length}, First 50 chars: ${cleanToken.substring(0, 50)}...`,
      );
      console.error(`Root cause: Token has ${segmentCount} dot separators instead of 2 (expected format: header.payload.signature)`);
      throw new Error("Invalid token format");
    }

    headers["Authorization"] = `Bearer ${cleanToken}`;
    console.log(`✅ Token validated: Length=${cleanToken.length}, Segments=${segmentCount}`);
  } else {
    console.error("🚨 API Request Blocked: No valid token available. Waiting for auth...");
    console.error(`Root cause: ${!token ? "Token is null/undefined" : token === "undefined" ? "Token is string 'undefined'" : token === "null" ? "Token is string 'null'" : "Unknown token issue"}`);
    // Stop the request completely so we don't spam the backend with 401s
    throw new Error("Unauthorized: Token not ready");
  }

  // 3. Make the actual request with retry logic for 401 errors
  try {
    const res = await fetch(`${BASE()}${path}`, {
      ...init,
      headers,
    });

    if (res.status === 401) {
      console.warn("⚠️ 401 Unauthorized received, attempting token refresh...");
      
      // Attempt to refresh the session
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError) {
        console.error("🚨 Token refresh failed:", refreshError);
        // Refresh failed - redirect to login
        window.location.href = "/login";
        throw new Error("Unauthorized - Session expired");
      }
      
      if (!refreshData.session) {
        console.error("🚨 No session returned from refresh");
        window.location.href = "/login";
        throw new Error("Unauthorized - No active session");
      }
      
      // Get the new token
      const newToken = refreshData.session.access_token;
      if (!newToken) {
        console.error("🚨 No access token in refreshed session");
        window.location.href = "/login";
        throw new Error("Unauthorized - No access token");
      }
      
      // Validate the new token format
      const newCleanToken = newToken.trim();
      const newSegmentCount = newCleanToken.split(".").length;
      if (newSegmentCount !== 3) {
        console.error(`🚨 Refreshed token has invalid format: ${newSegmentCount} segments`);
        window.location.href = "/login";
        throw new Error("Unauthorized - Invalid refreshed token");
      }
      
      console.log("✅ Token refreshed successfully, retrying original request...");
      
      // Retry the original request with the new token
      const retryHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...((init?.headers as Record<string, string>) ?? {}),
        "Authorization": `Bearer ${newCleanToken}`,
      };
      
      const retryRes = await fetch(`${BASE()}${path}`, {
        ...init,
        headers: retryHeaders,
      });
      
      if (retryRes.status === 401) {
        console.error("🚨 Retry still returned 401 after token refresh");
        window.location.href = "/login";
        throw new Error("Unauthorized - Invalid credentials");
      }
      
      if (!retryRes.ok) {
        // Handle other errors after retry
        if (retryRes.status === 429) {
          try {
            const errorData = await retryRes.json();
            if (errorData.detail) {
              throw new Error(`429 Rate Limit: ${errorData.detail}`);
            }
          } catch (e) {
            // If parsing fails, fall through to generic error
          }
        }
        throw new Error(`${retryRes.status} ${retryRes.statusText}`);
      }
      
      return retryRes.json() as Promise<T>;
    }

    if (!res.ok) {
      // For 429 rate limit errors, try to extract the creative message from the response body
      if (res.status === 429) {
        try {
          const errorData = await res.json();
          if (errorData.detail) {
            throw new Error(`429 Rate Limit: ${errorData.detail}`);
          }
        } catch (e) {
          // If parsing fails, fall through to generic error
        }
      }
      // Surface only status + statusText; backend already maps upstream errors
      // to generic messages, but defensively avoid leaking arbitrary bodies.
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  } catch (error) {
    // If the error is not a 401, re-throw it
    if (error instanceof Error && !error.message.includes("Unauthorized")) {
      throw error;
    }
    // For auth errors, we've already handled the redirect above
    throw error;
  }
}

async function jOptional<T>(path: string, init?: RequestInit): Promise<T | null> {
  // 1. Force the client to await the real session from Supabase
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  // 2. STRICT VALIDATION: Never attach a malformed string
  if (token && token !== "undefined" && token !== "null") {
    // Strip any potential whitespace and validate token format
    const cleanToken = token.trim();

    // Validate JWT format (3 segments separated by dots)
    const segmentCount = cleanToken.split(".").length;
    if (segmentCount !== 3) {
      console.error(`🚨 Invalid token format: Expected 3 segments, got ${segmentCount}`);
      console.error(
        `Token length: ${cleanToken.length}, First 50 chars: ${cleanToken.substring(0, 50)}...`,
      );
      console.error(`Root cause: Token has ${segmentCount} dot separators instead of 2 (expected format: header.payload.signature)`);
      throw new Error("Invalid token format");
    }

    headers["Authorization"] = `Bearer ${cleanToken}`;
    console.log(`✅ Token validated: Length=${cleanToken.length}, Segments=${segmentCount}`);
  } else {
    console.error("🚨 API Request Blocked: No valid token available. Waiting for auth...");
    console.error(`Root cause: ${!token ? "Token is null/undefined" : token === "undefined" ? "Token is string 'undefined'" : token === "null" ? "Token is string 'null'" : "Unknown token issue"}`);
    // Stop the request completely so we don't spam the backend with 401s
    throw new Error("Unauthorized: Token not ready");
  }

  // 3. Make the actual request with retry logic for 401 errors
  try {
    const res = await fetch(`${BASE()}${path}`, {
      ...init,
      headers,
    });

    if (res.status === 401) {
      console.warn("⚠️ 401 Unauthorized received in jOptional, attempting token refresh...");
      
      // Attempt to refresh the session
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError) {
        console.error("🚨 Token refresh failed:", refreshError);
        window.location.href = "/login";
        throw new Error("Unauthorized - Session expired");
      }
      
      if (!refreshData.session) {
        console.error("🚨 No session returned from refresh");
        window.location.href = "/login";
        throw new Error("Unauthorized - No active session");
      }
      
      const newToken = refreshData.session.access_token;
      if (!newToken) {
        console.error("🚨 No access token in refreshed session");
        window.location.href = "/login";
        throw new Error("Unauthorized - No access token");
      }
      
      const newCleanToken = newToken.trim();
      const newSegmentCount = newCleanToken.split(".").length;
      if (newSegmentCount !== 3) {
        console.error(`🚨 Refreshed token has invalid format: ${newSegmentCount} segments`);
        window.location.href = "/login";
        throw new Error("Unauthorized - Invalid refreshed token");
      }
      
      console.log("✅ Token refreshed successfully, retrying original request...");
      
      const retryHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...((init?.headers as Record<string, string>) ?? {}),
        "Authorization": `Bearer ${newCleanToken}`,
      };
      
      const retryRes = await fetch(`${BASE()}${path}`, {
        ...init,
        headers: retryHeaders,
      });
      
      if (retryRes.status === 401) {
        console.error("🚨 Retry still returned 401 after token refresh");
        window.location.href = "/login";
        throw new Error("Unauthorized - Invalid credentials");
      }
      
      if (retryRes.status === 404) {
        return null;
      }
      
      if (!retryRes.ok) {
        throw new Error(`${retryRes.status} ${retryRes.statusText}`);
      }
      
      return retryRes.json() as Promise<T>;
    }

    if (res.status === 404) {
      return null; // Return null for 404 - "not found" is expected for optional resources
    }
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  } catch (error) {
    if (error instanceof Error && !error.message.includes("Unauthorized")) {
      throw error;
    }
    throw error;
  }
}

async function uploadFile<T>(path: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append("file", file);

  // 1. Force the client to await the real session from Supabase
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  const headers: Record<string, string> = {};

  // 2. STRICT VALIDATION: Never attach a malformed string
  if (token && token !== "undefined" && token !== "null") {
    // Strip any potential whitespace and validate token format
    const cleanToken = token.trim();

    // Validate JWT format (3 segments separated by dots)
    const segmentCount = cleanToken.split(".").length;
    if (segmentCount !== 3) {
      console.error(`🚨 Invalid token format: Expected 3 segments, got ${segmentCount}`);
      console.error(
        `Token length: ${cleanToken.length}, First 50 chars: ${cleanToken.substring(0, 50)}...`,
      );
      console.error(`Root cause: Token has ${segmentCount} dot separators instead of 2 (expected format: header.payload.signature)`);
      throw new Error("Invalid token format");
    }

    headers["Authorization"] = `Bearer ${cleanToken}`;
    console.log(`✅ Token validated: Length=${cleanToken.length}, Segments=${segmentCount}`);
  } else {
    console.error("🚨 API Request Blocked: No valid token available. Waiting for auth...");
    console.error(`Root cause: ${!token ? "Token is null/undefined" : token === "undefined" ? "Token is string 'undefined'" : token === "null" ? "Token is string 'null'" : "Unknown token issue"}`);
    // Stop the request completely so we don't spam the backend with 401s
    throw new Error("Unauthorized: Token not ready");
  }

  // 3. Make the actual request with retry logic for 401 errors
  try {
    const res = await fetch(`${BASE()}${path}`, {
      method: "POST",
      headers: headers, // Don't set Content-Type - let browser set multipart/form-data boundary
      body: formData,
    });

    if (res.status === 401) {
      console.warn("⚠️ 401 Unauthorized received in uploadFile, attempting token refresh...");
      
      // Attempt to refresh the session
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError) {
        console.error("🚨 Token refresh failed:", refreshError);
        window.location.href = "/login";
        throw new Error("Unauthorized - Session expired");
      }
      
      if (!refreshData.session) {
        console.error("🚨 No session returned from refresh");
        window.location.href = "/login";
        throw new Error("Unauthorized - No active session");
      }
      
      const newToken = refreshData.session.access_token;
      if (!newToken) {
        console.error("🚨 No access token in refreshed session");
        window.location.href = "/login";
        throw new Error("Unauthorized - No access token");
      }
      
      const newCleanToken = newToken.trim();
      const newSegmentCount = newCleanToken.split(".").length;
      if (newSegmentCount !== 3) {
        console.error(`🚨 Refreshed token has invalid format: ${newSegmentCount} segments`);
        window.location.href = "/login";
        throw new Error("Unauthorized - Invalid refreshed token");
      }
      
      console.log("✅ Token refreshed successfully, retrying original request...");
      
      const retryHeaders: Record<string, string> = {
        "Authorization": `Bearer ${newCleanToken}`,
      };
      
      const retryRes = await fetch(`${BASE()}${path}`, {
        method: "POST",
        headers: retryHeaders,
        body: formData,
      });
      
      if (retryRes.status === 401) {
        console.error("🚨 Retry still returned 401 after token refresh");
        window.location.href = "/login";
        throw new Error("Unauthorized - Invalid credentials");
      }
      
      if (!retryRes.ok) {
        throw new Error(`${retryRes.status} ${retryRes.statusText}`);
      }
      
      return retryRes.json() as Promise<T>;
    }

    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  } catch (error) {
    if (error instanceof Error && !error.message.includes("Unauthorized")) {
      throw error;
    }
    throw error;
  }
}

// Synchronous version for contexts that need immediate headers
// DEPRECATED: All auth should use async Supabase JWT tokens
export function getSyncAuthHeaders(): Record<string, string> {
  // This function is deprecated and should not be used
  // All authentication should use Supabase JWT tokens via async getAuthHeaders()
  console.warn("getSyncAuthHeaders is deprecated - use async Supabase auth instead");
  return {};
}

export const processDocument = async (file: File) => {
  return uploadFile<{ matchScore: number; missingSkills: string[]; feedback: string }>(
    "/api/triage/process",
    file,
  );
};

export const odyssey = {
  configured: () => Boolean(BASE()),
  stats: {
    get: () => j<{ success: boolean; data: StatsData }>("/api/stats"),
  },
  fleet: {
    start: () => j<{ status: string }>("/api/fleet/start", { method: "POST" }),
    stop: () => j<{ status: string }>("/api/fleet/stop", { method: "POST" }),
    health: () => j<{ ok: boolean; status: string; uptime: number }>("/api/fleet/health"),
    // Note: EventSource cannot set custom headers — pass the token via query string
    // and have the backend accept either Authorization or ?token=… if you need
    // SSE auth in the browser. For now we require JWT authentication.
    logsUrl: () => {
      // SSE cannot set custom headers, so we need to use query param with JWT token
      // This requires backend support for token query parameter
      const { data } = supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return null;
      return `${BASE()}/api/fleet/logs?token=${encodeURIComponent(token)}`;
    },
  },
  webhooks: {
    get: () => j<{ n8n_url: string; make_url: string; enabled: boolean }>("/api/webhooks/config"),
    set: (cfg: { n8n_url: string; make_url: string; enabled: boolean }) =>
      j("/api/webhooks/config", { method: "POST", body: JSON.stringify(cfg) }),
  },
  ats: {
    match: (resume: string, jd: string) =>
      j<{ score: number; gaps: string[]; matched: string[] }>("/api/ats/match", {
        method: "POST",
        body: JSON.stringify({ resume, jd }),
      }),
  },
  triage: {
    process: (file: File) =>
      uploadFile<{ matchScore: number; missingSkills: string[]; feedback: string }>(
        "/api/triage/process",
        file,
      ),
  },
  roaster: {
    analyze: (resume: string) =>
      j<{ critique: string; flawed_bullets: { text: string; issues: string[] }[]; total: number }>(
        "/api/roaster/analyze",
        { method: "POST", body: JSON.stringify({ resume }) },
      ),
    fix: (flawed_bullets: string[]) =>
      j<{ fixed_bullets: string[] }>("/api/roaster/fix", {
        method: "POST",
        body: JSON.stringify({ flawed_bullets }),
      }),
  },
  interview: {
    generate: (job_description: string, count = 8) =>
      j<{ questions: string[] }>("/api/interview/generate", {
        method: "POST",
        body: JSON.stringify({ job_description, count }),
      }),
    evaluate: (question: string, answer: string, job_description: string) =>
      j<{ score: number; feedback: string; improvement_suggestion: string }>(
        "/api/interview/evaluate",
        {
          method: "POST",
          body: JSON.stringify({ question, answer, job_description }),
        },
      ),
    speak: async (text: string, voice_id?: string): Promise<Blob> => {
      // Get auth token using the same pattern as other functions
      const { data, error } = await supabase.auth.getSession();
      const token = data?.session?.access_token;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // STRICT VALIDATION: Never attach a malformed string
      if (token && token !== "undefined" && token !== "null") {
        const cleanToken = token.trim();
        const segmentCount = cleanToken.split(".").length;
        if (segmentCount !== 3) {
          console.error(`🚨 Invalid token format: Expected 3 segments, got ${segmentCount}`);
          throw new Error("Invalid token format");
        }
        headers["Authorization"] = `Bearer ${cleanToken}`;
      } else {
        console.error("🚨 API Request Blocked: No valid token available");
        throw new Error("Unauthorized: Token not ready");
      }

      // Make the request with retry logic for 401 errors
      try {
        const res = await fetch(`${BASE()}/api/interview/speak`, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ text, voice_id }),
        });

        if (res.status === 401) {
          console.warn("⚠️ 401 Unauthorized received in interview.speak, attempting token refresh...");
          
          // Attempt to refresh the session
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
          
          if (refreshError) {
            console.error("🚨 Token refresh failed:", refreshError);
            window.location.href = "/login";
            throw new Error("Unauthorized - Session expired");
          }
          
          if (!refreshData.session) {
            console.error("🚨 No session returned from refresh");
            window.location.href = "/login";
            throw new Error("Unauthorized - No active session");
          }
          
          const newToken = refreshData.session.access_token;
          if (!newToken) {
            console.error("🚨 No access token in refreshed session");
            window.location.href = "/login";
            throw new Error("Unauthorized - No access token");
          }
          
          const newCleanToken = newToken.trim();
          const newSegmentCount = newCleanToken.split(".").length;
          if (newSegmentCount !== 3) {
            console.error(`🚨 Refreshed token has invalid format: ${newSegmentCount} segments`);
            window.location.href = "/login";
            throw new Error("Unauthorized - Invalid refreshed token");
          }
          
          console.log("✅ Token refreshed successfully, retrying original request...");
          
          const retryHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${newCleanToken}`,
          };
          
          const retryRes = await fetch(`${BASE()}/api/interview/speak`, {
            method: "POST",
            headers: retryHeaders,
            body: JSON.stringify({ text, voice_id }),
          });
          
          if (retryRes.status === 401) {
            console.error("🚨 Retry still returned 401 after token refresh");
            window.location.href = "/login";
            throw new Error("Unauthorized - Invalid credentials");
          }
          
          if (!retryRes.ok) {
            throw new Error(`${retryRes.status} ${retryRes.statusText}`);
          }
          
          return retryRes.blob();
        }

        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        return res.blob();
      } catch (error) {
        if (error instanceof Error && !error.message.includes("Unauthorized")) {
          throw error;
        }
        throw error;
      }
    },
  },
  networking: {
    draft: (
      input: {
        contact_name: string;
        contact_email?: string;
        company: string;
        role?: string;
        context?: string;
        extra_context?: Record<string, string>;
        angle?: string;
        sign_off: string;
        language: string;
      },
      mode: "talent" | "career" = "career",
    ) =>
      j<{ id: string; status: string; subject: string; body: string }>(
        `/api/networking/draft?mode=${mode}`,
        { method: "POST", body: JSON.stringify(input) },
      ),

    listDrafts: () => j<Record<string, any>>("/api/networking/drafts"),

    editDraft: (id: string, patch: { subject?: string; body?: string }) =>
      j(`/api/networking/drafts/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

    sendDraft: (id: string, override_to?: string) =>
      j(`/api/networking/drafts/${id}/send`, {
        method: "POST",
        body: JSON.stringify({ override_to }),
      }),

    enrich: (input: {
      contact_name: string;
      company?: string;
      email?: string;
      linkedin_url?: string;
    }) =>
      j<{ contact_name: string; enrichment: Record<string, unknown> }>("/api/networking/enrich", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  },
  data: {
    exportUrl: (format: "json" | "csv" = "json") => `${BASE()}/api/data/export?format=${format}`,
  },
  jobLeads: {
    process: (
      url: string,
      user_profile?: string,
      user_id?: string,
      filter_criteria?: {
        allowed_keywords: string[];
        blocked_keywords: string[];
        min_match_score: number;
      },
    ) =>
      j<{
        success: boolean;
        action?: string;
        id?: string;
        match_score?: number;
        tech_stack?: string[];
        error?: string;
        reason?: string;
        suggestion?: string;
      }>("/api/job-leads/process", {
        method: "POST",
        body: JSON.stringify({ url, user_profile, user_id, filter_criteria }),
      }),
    list: (status?: string, min_score?: number) =>
      j<{ success: boolean; data: any[] }>(
        `/api/job-leads${status ? `?status=${status}` : ""}${min_score !== undefined ? `${status ? "&" : "?"}min_score=${min_score}` : ""}`,
      ),
    get: (lead_id: string) => j<{ success: boolean; data: any }>(`/api/job-leads/${lead_id}`),
    update: (lead_id: string, status: string) =>
      j<{ success: boolean; data: any }>(`/api/job-leads/${lead_id}?status=${status}`, {
        method: "PATCH",
      }),
    ship: (lead_id: string, to_email?: string, custom_body?: string) =>
      j<{ success: boolean; data?: any; email_sent?: any; message?: string; error?: string }>(
        `/api/job-leads/${lead_id}/ship`,
        {
          method: "POST",
          body: JSON.stringify({ to_email, custom_body }),
        },
      ),
    generateCV: (lead_id: string) =>
      j<{ success: boolean; data: any }>(`/api/job-leads/${lead_id}/generate-cv`, {
        method: "POST",
      }),
    generatePrepGuide: (lead_id: string) =>
      j<{ success: boolean; data: any }>(`/api/job-leads/${lead_id}/generate-prep-guide`, {
        method: "POST",
      }),
  },
  userProfile: {
    upsert: (profile: {
      user_id: string;
      resume_text: string;
      tech_stack: string[];
      preferences: Record<string, any>;
    }) =>
      j<{ success: boolean; action: string; data: any }>("/api/user/profile", {
        method: "POST",
        body: JSON.stringify(profile),
      }),
    get: () => jOptional<{ success: boolean; data: any }>(`/api/user/profile`),
  },
};
