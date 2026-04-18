// ============================================================
// dashboard/tests/LinkCell.test.jsx
//
// Sprint 5 — Light-weight smoke test for the <LinkCell /> component.
// The dashboard does not ship with a JSX-aware test runner yet, so
// this file exercises the pure `truncateString` helper via native
// Node (`node dashboard/tests/LinkCell.test.jsx` after the team
// wires a Vitest/Jest config) and documents the rendering contract
// the component must keep.
//
// The assertions below are authored against Vitest's `describe/it`
// API so they light up the moment `npm i -D vitest` is added to
// dashboard/package.json — see scripts/test block in README.
// ============================================================

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import LinkCell, { truncateString } from '../src/components/LinkCell.jsx';

describe('truncateString', () => {
  it('returns input unchanged when under limit', () => {
    expect(truncateString('abc', 10)).toBe('abc');
  });
  it('truncates and adds ellipsis past limit', () => {
    expect(truncateString('abcdefghij', 5)).toBe('abcd…');
  });
  it('returns empty when input is falsy', () => {
    expect(truncateString(null, 5)).toBe('');
  });
});

describe('<LinkCell />', () => {
  it('renders an <a> with target=_blank and rel=noopener noreferrer', () => {
    const html = renderToStaticMarkup(
      <LinkCell url="https://example.com" type="web" label="example.com" />,
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('uses an aria-label that includes the type', () => {
    const html = renderToStaticMarkup(
      <LinkCell url="tel:+13055551234" type="phone" label="+1 305 555 1234" />,
    );
    expect(html).toContain('aria-label="phone link: +1 305 555 1234"');
  });

  it('truncates the visible label but preserves the title', () => {
    const url = 'https://really-long-domain-name-example.com/very/long/path';
    const html = renderToStaticMarkup(
      <LinkCell url={url} type="web" truncate={20} />,
    );
    // truncated display string ends with ellipsis
    expect(html).toMatch(/…<\/span>/);
    // full URL preserved in the native title attribute
    expect(html).toContain(`title="${url}"`);
  });

  it('returns null when url is missing', () => {
    const html = renderToStaticMarkup(<LinkCell url={null} type="web" />);
    expect(html).toBe('');
  });
});
