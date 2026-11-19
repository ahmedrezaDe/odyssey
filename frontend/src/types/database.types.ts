export type JobLeadStatus = 'new' | 'approved' | 'applied' | 'interview' | 'rejected';
export type WorkSetting = 'remote' | 'hybrid' | 'onsite';

export interface JobLead {
  id: string;
  url: string;
  company_name: string;
  role_title: string;
  match_score: number;
  status: JobLeadStatus;
  raw_content: string;
  created_at: string;
  tech_stack: string[];
  detected_language: string;
  salary_min?: number;
  salary_max?: number;
  currency: string;
  job_location?: string;
  work_setting?: WorkSetting;
  contact_email?: string;
  contact_name?: string;
  hiring_manager_linkedin?: string;
  user_id?: string;
}

export interface FilterCriteria {
  allowed_keywords: string[];
  blocked_keywords: string[];
  min_match_score: number;
  profile_name?: string;
  location?: string;
  tech_stack?: string[];
}
