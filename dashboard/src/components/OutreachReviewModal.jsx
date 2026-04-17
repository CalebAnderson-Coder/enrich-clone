import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, Send, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function OutreachReviewModal({ lead, isOpen, onClose, onSave, onApprove, onRegenerate, onReject }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [agentNotes, setAgentNotes] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);

  useEffect(() => {
    if (lead) {
      const campaign = lead.campaign_enriched_data?.[0] || {};
      const magnetData = campaign.lead_magnets_data || {};
      const outreach = lead.mega_profile?.outreach || {};

      let resolvedSubject = magnetData.email_draft_subject
        || magnetData.angela_email_subject
        || outreach.subject
        || outreach.asunto
        || '';

      let resolvedBody = magnetData.email_draft_html
        || magnetData.angela_email_body
        || outreach.body
        || outreach.cuerpo
        || '';

      if (!resolvedSubject && !resolvedBody && campaign.outreach_copy) {
        const copyText = campaign.outreach_copy;
        const subjectMatch = copyText.match(/(?:Subject|Asunto):\s*(.+?)(?:\n|$)/i);
        if (subjectMatch) {
          resolvedSubject = subjectMatch[1].trim();
          resolvedBody = copyText.replace(subjectMatch[0], '').trim();
        } else {
          resolvedBody = copyText;
          resolvedSubject = `Proposal for ${lead.business_name}`;
        }
      }

      const resolvedWhatsapp = magnetData.whatsapp_draft
        || outreach.whatsapp
        || '';

      setSubject(resolvedSubject);
      setBody(resolvedBody);
      setWhatsapp(resolvedWhatsapp);
      setAgentNotes('');
    }
  }, [lead]);

  if (!lead) return null;

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const result = await onRegenerate(lead.id, agentNotes);
      if (result && result.outreach) {
        setSubject(result.outreach.subject || '');
        setBody(result.outreach.body || '');
        setWhatsapp(result.outreach.whatsapp || '');
        setAgentNotes('');
      }
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleApprove = () => {
    onApprove(lead.id, { subject, body, whatsapp });
  };

  const handleSave = () => {
    onSave(lead.id, { subject, body, whatsapp });
  };

  const handleReject = () => {
    if (onReject) {
      onReject(lead.id, agentNotes);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl p-0 gap-0 bg-surface-900 border-surface-700 text-surface-50 shadow-elevation-3">
        <DialogHeader className="px-6 py-5 border-b border-surface-700 text-left">
          <DialogTitle className="text-xl font-semibold tracking-tight bg-gradient-to-r from-white to-surface-400 bg-clip-text text-transparent">
            Revisar outreach — {lead.business_name}
          </DialogTitle>
          <DialogDescription className="text-surface-400 mt-1">
            {lead.owner_name || 'Dueño/Mánager'} • {lead.industry}
            {lead.qualification_score ? (
              <Badge variant="outline" className="ml-2 border-primary-500/40 text-primary-500">
                Score {lead.qualification_score}/100
              </Badge>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh]">
          <div className="px-6 py-5 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email-subject" className="text-xs font-semibold uppercase tracking-wider text-surface-400">
                Email Subject
                <span className="ml-2 text-[10px] font-normal text-surface-500 normal-case tracking-normal">(must be in English)</span>
              </Label>
              <Input
                id="email-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Quick Win for Your Business in Orlando"
                className="bg-surface-950/60 border-surface-700 text-surface-50 placeholder:text-surface-500 h-11"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="email-body" className="text-xs font-semibold uppercase tracking-wider text-surface-400">
                Email Body
                <span className="ml-2 text-[10px] font-normal text-surface-500 normal-case tracking-normal">(English only — goes directly to the lead)</span>
              </Label>
              <textarea
                id="email-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder="Write the email body in English..."
                className="rounded-md bg-surface-950/60 border border-surface-700 text-surface-50 placeholder:text-surface-500 p-3 text-sm font-sans resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="whatsapp-msg" className="text-xs font-semibold uppercase tracking-wider text-surface-400">
                Mensaje de WhatsApp
              </Label>
              <textarea
                id="whatsapp-msg"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                rows={4}
                placeholder="Escribe el mensaje de WhatsApp..."
                className="rounded-md bg-surface-950/60 border border-surface-700 text-surface-50 placeholder:text-surface-500 p-3 text-sm font-sans resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500"
              />
            </div>

            <div className="rounded-lg border border-dashed border-primary-500/30 bg-primary-500/5 p-4 flex flex-col gap-2">
              <Label htmlFor="agent-notes" className="flex items-center gap-2 text-primary-500 text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Feedback para Angela (AI)
              </Label>
              <textarea
                id="agent-notes"
                value={agentNotes}
                onChange={(e) => setAgentNotes(e.target.value)}
                rows={3}
                placeholder="Ej: 'Usa un tono más agresivo', 'Hazlo más corto', o 'El link correcto es x...'"
                className="rounded-md bg-transparent border border-surface-700 text-surface-50 placeholder:text-surface-500 p-3 text-sm font-sans resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500"
              />
              <p className="text-xs text-surface-400">
                Si algo no te gusta, escribelo aqui y pidele a Angela que lo vuelva a generar.
              </p>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t border-surface-700 bg-surface-950/40 flex-row sm:justify-between gap-2">
          <div className="flex gap-2 items-center">
            <Button
              variant="outline"
              onClick={handleRegenerate}
              disabled={isRegenerating}
              className={cn(
                'border-primary-500/40 text-primary-500 hover:bg-primary-500/10 hover:text-primary-500',
                isRegenerating && 'opacity-70'
              )}
            >
              {isRegenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Angela escribiendo...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Volver a Generar
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={handleReject}
              className="text-semantic-danger hover:text-semantic-danger hover:bg-semantic-danger/10"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Rechazar Lead
            </Button>
          </div>
          <div className="flex gap-2 items-center">
            <Button variant="ghost" onClick={onClose} className="text-surface-400 hover:text-surface-50">
              Cancelar
            </Button>
            <Button variant="outline" onClick={handleSave} className="border-surface-700 text-surface-50 hover:bg-surface-800">
              Guardar Borrador
            </Button>
            <Button onClick={handleApprove} className="bg-primary-500 hover:bg-primary-600 text-white shadow-glow">
              <Send className="h-4 w-4" aria-hidden="true" />
              Aprobar y Enviar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
