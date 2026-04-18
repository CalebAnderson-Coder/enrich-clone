// ============================================================
// dashboard/src/components/LinkCell.jsx
//
// Sprint 5 — reusable clickable link cell used across LeadsView
// and LeadDetailView. Zero external icon deps (inline SVGs) so
// it works without lucide-react import in the test runner.
// ============================================================

import React from 'react';

const ICONS = {
  phone:     '📞',
  sms:       '💬',
  whatsapp:  '🟢',
  email:     '✉️',
  web:       '🌐',
  linkedin:  'in',
  ig:        '📷',
  instagram: '📷',
  fb:        'f',
  facebook:  'f',
  maps:      '📍',
};

const TYPE_LABELS = {
  phone: 'phone', sms: 'sms', whatsapp: 'whatsapp',
  email: 'email', web: 'website', linkedin: 'linkedin',
  ig: 'instagram', instagram: 'instagram',
  fb: 'facebook', facebook: 'facebook', maps: 'google maps',
};

export function truncateString(str, max) {
  if (!str || !max) return str || '';
  if (str.length <= max) return str;
  return str.slice(0, Math.max(1, max - 1)) + '…';
}

export default function LinkCell({
  url,
  type = 'web',
  label,
  truncate,
  icon,
  className = '',
}) {
  if (!url) return null;

  const displayIcon = icon || ICONS[type] || '🔗';
  const rawLabel = label || url;
  const shown = truncate ? truncateString(rawLabel, truncate) : rawLabel;
  const typeLabel = TYPE_LABELS[type] || type;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${typeLabel} link: ${rawLabel}`}
      title={rawLabel}
      className={`link-cell link-cell-${type} ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        textDecoration: 'none',
        color: 'inherit',
        padding: '2px 6px',
        borderRadius: 4,
      }}
    >
      <span aria-hidden="true" className="link-cell-icon" style={{ fontSize: '0.9em', fontWeight: 700 }}>
        {displayIcon}
      </span>
      <span className="link-cell-label" style={{ fontSize: '0.85rem' }}>
        {shown}
      </span>
    </a>
  );
}
