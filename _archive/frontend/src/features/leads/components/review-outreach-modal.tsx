'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { RefreshCw, Save, Send, Sparkles, Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Lead } from '../api/types';

interface ReviewOutreachModalProps {
  lead: Lead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApproved?: () => void;
}

export function ReviewOutreachModal({
  lead,
  open,
  onOpenChange,
  onApproved,
}: ReviewOutreachModalProps) {
  const [activeTab, setActiveTab] = useState('email');
  const [isApproving, setIsApproving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // State for editable content
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [whatsappMsg, setWhatsappMsg] = useState('');
  const [instagramMsg, setInstagramMsg] = useState('');
  const [status, setStatus] = useState<string>('PENDING');
  const [notes, setNotes] = useState('');

  // Sync state with lead data when modal opens
  useEffect(() => {
    if (open) {
      setStatus(lead.status || 'PENDING');
      setNotes(lead.notes || lead.mega_profile?.internal_notes || '');

      // ── Check campaign_enriched_data first (where Angela/DaVinci actually write) ──
      const campaign = (lead as any).campaign_enriched_data?.[0] || {};
      const magnetData = campaign.lead_magnets_data || {};

      // Priority 1: Dedicated DB columns
      let resolvedSubject = campaign.email_draft_subject || '';
      let resolvedBody = campaign.email_draft_html || '';
      let resolvedWhatsapp = '';
      let resolvedInstagram = '';

      // Priority 2: DaVinci's JSONB fields inside lead_magnets_data
      if (!resolvedSubject) resolvedSubject = magnetData.angela_email_subject || '';
      if (!resolvedBody) resolvedBody = magnetData.angela_email_body || '';

      // Priority 3: mega_profile.outreach (structured)
      const outreach = lead.mega_profile?.outreach;
      if (!resolvedSubject && outreach) resolvedSubject = outreach.subject || outreach.asunto || '';
      if (!resolvedBody && outreach) resolvedBody = outreach.body || outreach.cuerpo || outreach.email_draft_html || '';
      if (outreach) {
        resolvedWhatsapp = outreach.whatsapp || '';
        resolvedInstagram = outreach.instagram || '';
      }

      // Priority 4: Parse from outreach_copy text (Angela's plain text output)
      if (!resolvedSubject && !resolvedBody) {
        const copy = campaign.outreach_copy || lead.mega_profile?.outreach_copy;
        if (copy) {
          const copyText = typeof copy === 'string' ? copy : copy.cold_email || '';
          if (copyText) {
            const subjectMatch = copyText.match(/(?:Subject|Asunto):\s*(.+?)(?:\n|$)/i);
            if (subjectMatch) {
              resolvedSubject = subjectMatch[1].trim();
              resolvedBody = copyText.replace(subjectMatch[0], '').trim();
            } else {
              resolvedSubject = `Propuesta para ${lead.business_name}`;
              resolvedBody = copyText;
            }
          }
          // Also try whatsapp/instagram from unstructured copy
          if (typeof copy !== 'string') {
            resolvedWhatsapp = resolvedWhatsapp || copy.whatsapp_message || '';
            resolvedInstagram = resolvedInstagram || copy.instagram_dm || '';
          }
        }
      }

      // WhatsApp from magnetData fallback
      resolvedWhatsapp = resolvedWhatsapp || magnetData.whatsapp_draft || '';

      setEmailSubject(resolvedSubject);
      setEmailBody(resolvedBody);
      setWhatsappMsg(resolvedWhatsapp);
      setInstagramMsg(resolvedInstagram);
    }
  }, [open, lead]);

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const response = await fetch(`/api/leads/${lead.id}/regenerate-outreach`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to regenerate');
      const data = await response.json();
      
      if (data.outreach) {
        setEmailSubject(data.outreach.subject || emailSubject);
        setEmailBody(data.outreach.body || emailBody);
        setWhatsappMsg(data.outreach.whatsapp || whatsappMsg);
        setInstagramMsg(data.outreach.instagram || instagramMsg);
        toast.success('¡Angela ha redactado una nueva versión!');
      }
    } catch (error) {
      console.error(error);
      toast.error('Error al regenerar el contenido');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const outreachData = {
        subject: emailSubject,
        body: emailBody,
        whatsapp: whatsappMsg,
        instagram: instagramMsg
      };

      const response = await fetch(`/api/leads/${lead.id}/outreach`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          outreachData,
          status,
          notes
        }),
      });

      if (!response.ok) throw new Error('Failed to save');
      toast.success('Lead y borrador actualizados correctamente');
    } catch (error) {
      console.error(error);
      toast.error('Error al guardar los cambios');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      // In a real app, we'd send the edited content to the backend
      // Using the structure from the backend routes
      const response = await fetch('/api/approve-email', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId: lead.id,
          action: 'approve',
          notes: notes,
          outreach: {
            subject: emailSubject,
            body: emailBody,
            whatsapp: whatsappMsg,
            instagram: instagramMsg
          }
        }),
      });

      if (!response.ok) throw new Error('Failed to approve');

      toast.success('¡Outreach aprobado y en cola para envío!');
      onApproved?.();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error('Error al aprobar el outreach');
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden border-slate-800 bg-slate-950/90 backdrop-blur-2xl">
        <div className="flex flex-col h-[85vh]">
          {/* Header Area */}
          <DialogHeader className="p-6 border-b border-slate-800/50 bg-slate-900/20">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-2xl font-bold tracking-tight text-white">
                  Revisar Propuesta de Angela
                </DialogTitle>
                <p className="mt-1 text-sm text-slate-400">
                  Refina y aprueba el mensaje para <span className="text-blue-400 font-medium">{lead.business_name}</span>
                </p>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-widest">IA Activa</span>
              </div>
            </div>
          </DialogHeader>

          {/* Main Content Area */}
          <div className="flex flex-1 overflow-hidden">
            <Tabs 
              value={activeTab} 
              onValueChange={setActiveTab} 
              className="flex flex-col w-full"
            >
              <div className="px-6 py-2 bg-slate-900/40 border-b border-slate-800/50">
                <TabsList className="bg-slate-950/50 border border-slate-800">
                  <TabsTrigger value="email" className="data-[state=active]:bg-blue-600/20 data-[state=active]:text-blue-400">
                    📧 Email Cold
                  </TabsTrigger>
                  <TabsTrigger value="whatsapp" className="data-[state=active]:bg-green-600/20 data-[state=active]:text-green-400">
                    💬 WhatsApp
                  </TabsTrigger>
                  <TabsTrigger value="instagram" className="data-[state=active]:bg-pink-600/20 data-[state=active]:text-pink-400">
                    📷 Instagram DM
                  </TabsTrigger>
                </TabsList>
              </div>

                {/* Email View */}
                <TabsContent value="email" className="m-0 space-y-6 animate-in fade-in slide-in-from-bottom-2">
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Estado del Lead</label>
                        <Select value={status} onValueChange={setStatus}>
                          <SelectTrigger className="bg-slate-900/50 border-slate-800 text-white">
                            <SelectValue placeholder="Seleccionar estado" />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                            <SelectItem value="PENDING">Pendiente</SelectItem>
                            <SelectItem value="CONTACTED">Contactado</SelectItem>
                            <SelectItem value="RESPONDED">Respondió</SelectItem>
                            <SelectItem value="MEETING_SET">Reunión Agendada</SelectItem>
                            <SelectItem value="NURTURING">Nutriendo</SelectItem>
                            <SelectItem value="CLOSED">Cerrado (Ganado)</SelectItem>
                            <SelectItem value="DEAD">Descartado (Perdido)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Asunto del Email</label>
                        <Input 
                          value={emailSubject}
                          onChange={(e) => setEmailSubject(e.target.value)}
                          className="bg-slate-900/50 border-slate-800 text-white font-medium focus:ring-blue-500/50"
                        />
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cuerpo del Mensaje</label>
                      <div className="relative group">
                        <div className="absolute -inset-0.5 bg-gradient-to-b from-blue-500/20 to-transparent rounded-lg blur opacity-50 transition duration-1000 group-hover:opacity-100" />
                        <Textarea 
                          value={emailBody}
                          onChange={(e) => setEmailBody(e.target.value)}
                          className="relative min-h-[300px] bg-slate-950/80 border-slate-800 text-slate-200 leading-relaxed resize-none focus:ring-blue-500/30"
                          placeholder="Escribe el cuerpo del email..."
                        />
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Notas Internas</label>
                      <Textarea 
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="min-h-[100px] bg-slate-900/30 border-slate-800 text-slate-400 text-sm italic"
                        placeholder="Agregar notas sobre este lead (estilo de negocio, puntos de dolor, etc...)"
                      />
                    </div>
                  </div>
                </TabsContent>

                {/* WhatsApp View */}
                <TabsContent value="whatsapp" className="m-0 animate-in fade-in slide-in-from-bottom-2">
                  <div className="max-w-md mx-auto relative pt-4 pb-12">
                     <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-green-500/10 blur-[100px] rounded-full -z-10" />
                     
                     <div className="space-y-4">
                       <label className="text-xs font-bold text-slate-500 uppercase tracking-wider text-center block">Vista previa de WhatsApp</label>
                       
                       <div className="bg-[#075e54]/20 border border-[#075e54]/30 rounded-2xl p-4 shadow-2xl backdrop-blur-md">
                         <div className="flex items-center gap-3 mb-4 pb-3 border-b border-white/5">
                            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-lg">👤</div>
                            <div>
                                <div className="text-sm font-semibold text-white">{lead.owner_name || lead.business_name}</div>
                                <div className="text-[10px] text-green-400">en línea</div>
                            </div>
                         </div>
                         
                         <div className="bg-[#056162] text-white p-3 rounded-lg rounded-tl-none shadow-sm relative text-sm leading-relaxed mb-6">
                            <Textarea 
                              value={whatsappMsg}
                              onChange={(e) => setWhatsappMsg(e.target.value)}
                              className="bg-transparent border-none p-0 focus-visible:ring-0 min-h-[150px] resize-none text-white placeholder:text-white/50"
                            />
                            <div className="text-[10px] text-white/50 text-right mt-1">10:45 AM ✓✓</div>
                         </div>
                       </div>
                     </div>
                  </div>
                </TabsContent>

                {/* Instagram View */}
                <TabsContent value="instagram" className="m-0 animate-in fade-in slide-in-from-bottom-2">
                   <div className="max-w-md mx-auto pt-4">
                      <div className="bg-slate-900/50 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl h-[500px] flex flex-col">
                        <div className="p-4 border-b border-slate-800 flex items-center gap-3">
                           <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 p-[2px]">
                              <div className="w-full h-full rounded-full bg-black border-2 border-black overflow-hidden flex items-center justify-center text-xs">📷</div>
                           </div>
                           <span className="text-sm font-bold text-white">Mensaje Directo</span>
                        </div>
                        
                        <div className="flex-1 p-6 flex flex-col justify-end gap-4 overflow-y-auto">
                           <div className="self-end bg-blue-600 text-white px-4 py-2.5 rounded-2xl rounded-br-sm text-sm max-w-[85%] shadow-lg">
                              <Textarea 
                                value={instagramMsg}
                                onChange={(e) => setInstagramMsg(e.target.value)}
                                className="bg-transparent border-none p-0 focus-visible:ring-0 min-h-[100px] resize-none text-white placeholder:text-white/30"
                              />
                           </div>
                        </div>
                        
                        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex items-center gap-3">
                           <div className="flex-1 bg-slate-900 border border-slate-800 rounded-full px-4 py-2 text-xs text-slate-500">
                              Enviar mensaje...
                           </div>
                           <div className="text-blue-500 font-bold text-xs cursor-pointer hover:text-blue-400">Enviar</div>
                        </div>
                      </div>
                   </div>
                </TabsContent>
            </Tabs>
          </div>

          {/* Footer Area */}
          <DialogFooter className="p-6 border-t border-slate-800/50 bg-slate-900/40 backdrop-blur-xl">
             <div className="flex flex-col sm:flex-row items-center justify-between w-full gap-4">
                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <Button 
                      variant="outline" 
                      onClick={() => onOpenChange(false)}
                      className="border-slate-800 bg-transparent text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                        Cancelar
                    </Button>
                    <Button 
                      variant="secondary"
                      onClick={handleSave}
                      disabled={isSaving || isRegenerating}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 flex items-center gap-2"
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {isSaving ? 'Guardando...' : 'Guardar'}
                    </Button>
                    <Button 
                      variant="ghost" 
                      onClick={handleRegenerate}
                      disabled={isRegenerating || isSaving}
                      className="text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 flex items-center gap-2"
                    >
                        {isRegenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-blue-400" />}
                        {isRegenerating ? 'Redactando...' : 'Regenerar con Angela'}
                    </Button>
                </div>
                
                <Button 
                  onClick={handleApprove}
                  disabled={isApproving || isRegenerating || isSaving}
                  className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 shadow-[0_0_20px_rgba(37,99,235,0.4)] transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
                >
                  {isApproving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {isApproving ? 'Aprobando...' : 'Aprobar y Enviar Propuesta'}
                  {!isApproving && <span>🚀</span>}
                </Button>
             </div>
          </DialogFooter>
        </div>
      </DialogContent>

      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </Dialog>
  );
}
