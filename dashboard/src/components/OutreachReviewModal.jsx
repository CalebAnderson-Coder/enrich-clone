import React, { useState, useEffect } from 'react';
import './OutreachReviewModal.css';

export default function OutreachReviewModal({ lead, isOpen, onClose, onSave, onApprove, onRegenerate, onReject }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [agentNotes, setAgentNotes] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);

  useEffect(() => {
    if (lead) {
      // ── Read from ALL data sources where Angela/DaVinci write ──
      const campaign = lead.campaign_enriched_data?.[0] || {};
      const magnetData = campaign.lead_magnets_data || {};
      const outreach = lead.mega_profile?.outreach || {};

      // SUBJECT priority: dedicated column → DaVinci JSONB → mega_profile → parse from outreach_copy
      let resolvedSubject = campaign.email_draft_subject
        || magnetData.angela_email_subject
        || outreach.subject
        || outreach.asunto
        || '';

      // BODY priority: dedicated column → DaVinci JSONB → mega_profile → outreach_copy text
      let resolvedBody = campaign.email_draft_html
        || magnetData.angela_email_body
        || outreach.body
        || outreach.cuerpo
        || '';

      // If still empty, try to parse subject/body from outreach_copy (plain text format)
      if (!resolvedSubject && !resolvedBody && campaign.outreach_copy) {
        const copyText = campaign.outreach_copy;
        // Try parsing "Subject: ..." or "Asunto: ..." from the copy
        const subjectMatch = copyText.match(/(?:Subject|Asunto):\s*(.+?)(?:\n|$)/i);
        if (subjectMatch) {
          resolvedSubject = subjectMatch[1].trim();
          resolvedBody = copyText.replace(subjectMatch[0], '').trim();
        } else {
          // Use entire outreach_copy as body, generate a default subject
          resolvedBody = copyText;
          resolvedSubject = `Proposal for ${lead.business_name}`;
        }
      }

      // WhatsApp: magnetData → mega_profile → empty
      const resolvedWhatsapp = magnetData.whatsapp_draft
        || outreach.whatsapp
        || '';

      setSubject(resolvedSubject);
      setBody(resolvedBody);
      setWhatsapp(resolvedWhatsapp);
      setAgentNotes('');
    }
  }, [lead]);

  if (!isOpen || !lead) return null;

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const result = await onRegenerate(lead.id, agentNotes);
      if (result && result.outreach) {
        setSubject(result.outreach.subject || '');
        setBody(result.outreach.body || '');
        setWhatsapp(result.outreach.whatsapp || '');
        setAgentNotes(''); // clear notes after regen
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="lead-info">
            <h2>Revisar Outreach — {lead.business_name}</h2>
            <p>{lead.owner_name || 'Dueño/Mánager'} • {lead.industry}</p>
          </div>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          <div className="field-group">
            <label>Email Subject <span style={{color:'#6b7280',fontWeight:400,fontSize:'0.75rem'}}>(must be in English)</span></label>
            <input 
              type="text" 
              value={subject} 
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Quick Win for Your Business in Orlando"
            />
          </div>

          <div className="field-group">
            <label>Email Body <span style={{color:'#6b7280',fontWeight:400,fontSize:'0.75rem'}}>(English only — this goes directly to the lead)</span></label>
            <textarea 
              value={body} 
              onChange={e => setBody(e.target.value)}
              rows={8}
              placeholder="Write the email body in English..."
            />
          </div>

          <div className="field-group">
            <label>Mensaje de WhatsApp</label>
            <textarea 
              value={whatsapp} 
              onChange={e => setWhatsapp(e.target.value)}
              rows={4}
              placeholder="Escribe el mensaje de WhatsApp..."
            />
          </div>
          
          <div className="field-group" style={{ marginTop: '16px', background: 'rgba(255,0,102,0.05)', padding: '12px', borderRadius: '8px', border: '1px dashed rgba(255,0,102,0.3)' }}>
            <label style={{ color: '#ff0066', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="angela-avatar" style={{width: 24, height: 24}}>
                <img src="https://ui-avatars.com/api/?name=Angela&background=ff0066&color=fff" alt="Angela" />
              </div>
              Feedback para Angela (AI)
            </label>
            <textarea 
              value={agentNotes} 
              onChange={e => setAgentNotes(e.target.value)}
              rows={3}
              placeholder="Ej: 'Usa un tono más agresivo', 'Hazlo más corto', o 'El link correcto es x...'"
              style={{ background: 'transparent' }}
            />
            <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '8px' }}>
              Si algo no te gusta, escríbelo aquí y pídele a Angela que lo vuelva a generar.
            </small>
          </div>
        </div>

        <div className="modal-footer">
          <div className="left-actions">
            <button 
              className={`action-btn secondary regenerate-btn ${isRegenerating ? 'loading' : ''}`}
              onClick={handleRegenerate}
              disabled={isRegenerating}
            >
              <div className="angela-avatar">
                <img src="https://ui-avatars.com/api/?name=Angela&background=ff0066&color=fff" alt="Angela" />
              </div>
              {isRegenerating ? 'Angela escribiendo...' : 'Volver a Generar'}
            </button>
            <button className="action-btn link" onClick={handleReject} style={{ color: '#ef4444' }}>
              Rechazar Lead
            </button>
          </div>
          <div className="right-actions">
            <button className="action-btn link" onClick={onClose}>Cancelar</button>
            <button className="action-btn secondary" onClick={handleSave}>Guardar Borrador</button>
            <button className="action-btn primary" onClick={handleApprove}>Aprobar y Enviar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
