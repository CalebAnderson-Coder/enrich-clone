// ============================================================
// Lead Types — Complete Supabase Schema + AI Analysis
// ============================================================

export type MegaProfile = {
  situational_summary?: string;
  digital_radiography?: {
    seo_score?: number;
    speed_score?: number;
    has_ssl?: boolean;
    mobile_friendly?: boolean;
    social_presence?: string[];
    tech_stack?: string[];
    ads_detected?: boolean;
    summary?: string;
  };
  attack_angle?: string;
  marketing_signals?: {
    facebook_ads?: boolean;
    google_ads?: boolean;
    email_marketing?: boolean;
    summary?: string;
  };
  outreach_copy?: {
    cold_email?: string;
    instagram_dm?: string;
    whatsapp_message?: string;
  };
  [key: string]: unknown;
};

export type ScoreBreakdown = {
  review_score?: number;
  web_presence?: number;
  industry_fit?: number;
  location_score?: number;
  engagement_signals?: number;
  [key: string]: unknown;
};

export type Lead = {
  id: string;
  business_name: string;
  owner_name?: string;
  industry: string;
  metro_area?: string;
  lead_tier: string;
  outreach_status: string;
  website?: string;
  email?: string;
  phone?: string;
  google_maps_url?: string;
  facebook_url?: string;
  instagram_url?: string;
  linkedin_url?: string;
  rating?: number;
  review_count?: number;
  qualification_score?: number;
  notes?: string;
  has_mega_profile?: boolean;
  mega_profile?: MegaProfile;
  score_breakdown?: ScoreBreakdown;
  profiled_by?: string;
  created_at: string;
};

export type LeadFilters = {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  sort?: string;
};

export type LeadsResponse = {
  success: boolean;
  time: string;
  message: string;
  total_leads: number;
  offset: number;
  limit: number;
  leads: Lead[];
};

export type LeadMutationPayload = Partial<Omit<Lead, 'id' | 'created_at'>>;
