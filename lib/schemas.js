import { z } from 'zod';

export const leadSchema = z.object({
  business_name: z.string().min(1, "Business name is required"),
  owner_name: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  metro_area: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  google_maps_url: z.string().nullable().optional(),
  gmb_active: z.boolean().nullable().optional(),
  review_count: z.number().nullable().optional(),
  rating: z.number().nullable().optional(),
  has_website: z.boolean().nullable().optional(),
  qualification_score: z.number().nullable().optional(),
  lead_tier: z.enum(['HOT', 'WARM', 'COOL', 'COLD']).nullable().optional(),
  score_breakdown: z.unknown().nullable().optional(),
  scraped_by: z.string().nullable().optional(),
  mega_profile: z.unknown().nullable().optional(),
  profiled_by: z.string().nullable().optional(),
  outreach_status: z.string().nullable().optional(),
  facebook_url: z.string().nullable().optional(),
  instagram_url: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  email_address: z.string().nullable().optional(),
});

export const campaignDataSchema = z.object({
  prospect_id: z.string().uuid("Invalid prospect ID"),
  radiography_technical: z.string().nullable().optional(),
  attack_angle: z.string().nullable().optional(),
  outreach_copy: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  lead_magnet_status: z.string().nullable().optional()
});

// Output schemas tailored for LLM instructions
export const radarOutputSchema = z.object({
  business_name: z.string().describe("Nombre exacto y oficial de la empresa"),
  website: z.string().nullable().describe("Sitio web real, O null si no tiene"),
  phone: z.string().nullable().describe("Número de teléfono de contacto"),
  rating: z.number().nullable().describe("Calificación en Google Maps (ej. 4.5)"),
  review_count: z.number().nullable().describe("Cantidad total de reseñas"),
  google_maps_url: z.string().nullable().describe("Link exacto de Google Maps"),
  facebook_url: z.string().nullable().describe("Link exacto de Facebook"),
  instagram_url: z.string().nullable().describe("Link exacto de Instagram"),
  linkedin_url: z.string().nullable().describe("Link exacto de LinkedIn"),
  radar_summary: z.string().describe("Resumen general de lo que encontraste")
});

export const enrichOutputSchema = z.object({
  radiography_technical: z.string().describe("1-2 Párrafos reales de la evaluación técnica web, redes, y presencia local"),
  attack_angle: z.string().describe("El ángulo de ventas táctico en 1 párrafo directo"),
  outreach_copy: z.string().describe("El asunto y cuerpo original para contactarlos")
});
