import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// Create a single supabase client for interacting with your database
const supabaseUrl = process.env.SUPABASE_URL || 'https://tu-proyecto.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'tu-anon-key';
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * DB Module: Interacciones nativas a la Base de Datos CRM
 * Sustituye enteramente al CRM de GHL
 */
export const db = {
  /**
   * Guarda un montón de leads extraídos (Ej. desde Bright Data)
   */
  async insertLeads(leadsArray) {
    const { data, error } = await supabase
      .from('smart_agency_leads')
      .insert(leadsArray)
      .select();
      
    if (error) throw error;
    return data;
  },

  /**
   * Actualiza el Stage del CRM para un Lead específico
   */
  async updatePipelineStage(leadId, newStage, demoUrl = null) {
    const updateData = { pipeline_stage: newStage, updated_at: new Date() };
    if (demoUrl) updateData.demo_website_url = demoUrl;

    const { data, error } = await supabase
      .from('smart_agency_leads')
      .update(updateData)
      .eq('id', leadId)
      .select();
      
    if (error) throw error;
    return data;
  },

  /**
   * Actualiza estatus de Email tras disparo SMTP
   */
  async updateEmailOutreachStatus(leadId, status, messageId) {
    const { data, error } = await supabase
      .from('smart_agency_leads')
      .update({
        email_outreach_status: status,
        updated_at: new Date()
      })
      .eq('id', leadId)
      .select();
      
    if (error) throw error;
    return data;
  }
};
