// ============================================================
// lib/miniAudit.js — Mini SEO audit liviano para usar como
//                     gancho en outreach emails de Empírika.
//
// NO es el audit full (eso lo hace dataforseo-claude con 5 sub-
// agentes). Esto es 3-4 llamadas livianas que Helena corre por
// CADA lead nuevo, suficientes para que Ángela tenga 3 hallazgos
// específicos para el cuerpo del email.
//
// Costo target: ≤$0.05/audit. Latencia target: ≤15 s.
//
// Output shape — { domain, hallazgos[], top_competitor, run_at, cost_usd }
//   hallazgos: [
//     { kind: 'low_ranking_keyword'|'broken_backlinks'|'no_authority'|...,
//       headline: 'string corto pitch-able',
//       detail: 'string explicativo',
//       data: {...números crudos para que Ángela pueda citarlos}
//     }
//   ]
// ============================================================

const API_BASE = 'https://api.dataforseo.com/v3';
const TIMEOUT_MS = 15000;
const LOC_US = 2840;
const LANG_EN = 'en';

function authHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const pass  = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) {
    throw new Error('Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD env vars');
  }
  // Use pre-encoded if provided (avoids re-encoding cost / locale issues)
  const pre = process.env.DATAFORSEO_AUTH_BASIC;
  if (pre) return `Basic ${pre}`;
  const b64 = Buffer.from(`${login}:${pass}`).toString('base64');
  return `Basic ${b64}`;
}

async function dfsCall(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Authorization': authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([body]),
      signal: ctrl.signal,
    });
    const json = await res.json();
    if (json.status_code !== 20000) {
      throw new Error(`DataForSEO ${path} → ${json.status_code} ${json.status_message}`);
    }
    const task = json.tasks?.[0];
    return { ok: true, result: task?.result?.[0] ?? null, cost: task?.cost ?? 0 };
  } catch (err) {
    return { ok: false, error: err.message, cost: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeDomain(input) {
  if (!input) return null;
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '');
  // Trim path/query — keep host only
  d = d.split('/')[0].split('?')[0];
  return d;
}

/**
 * Run a lightweight audit against a domain. Returns up to 3 sales-grade
 * findings with concrete numbers Ángela can quote in the cold email body.
 *
 * @param {string} domain  e.g. "atlasheating.com" (will be normalized)
 * @param {object} [opts]
 * @param {number} [opts.locationCode=2840] — DataForSEO location code (US default)
 * @param {string} [opts.languageCode='en']
 * @returns {Promise<{
 *   domain: string,
 *   ok: boolean,
 *   hallazgos: Array,
 *   top_competitor: object|null,
 *   run_at: string,
 *   cost_usd: number,
 *   errors: string[]
 * }>}
 */
export async function runMiniAudit(domain, opts = {}) {
  const target = normalizeDomain(domain);
  const out = {
    domain: target,
    ok: false,
    hallazgos: [],
    top_competitor: null,
    run_at: new Date().toISOString(),
    cost_usd: 0,
    errors: [],
  };
  if (!target) { out.errors.push('invalid_domain'); return out; }

  const locationCode = opts.locationCode ?? LOC_US;
  const languageCode = opts.languageCode ?? LANG_EN;

  // ── 3 llamadas en paralelo ───────────────────────────────
  // a) ranked_keywords — top keyword + posición + tráfico estimado
  // b) competitors_domain — quién le come el tráfico
  // c) backlinks/summary — perfil de links + referring domains
  const [rankResp, compResp, blResp] = await Promise.all([
    dfsCall('/dataforseo_labs/google/ranked_keywords/live', {
      target,
      location_code: locationCode,
      language_code: languageCode,
      limit: 5,
      order_by: ['keyword_data.keyword_info.search_volume,desc'],
    }),
    dfsCall('/dataforseo_labs/google/competitors_domain/live', {
      target,
      location_code: locationCode,
      language_code: languageCode,
      limit: 3,
    }),
    dfsCall('/backlinks/summary/live', {
      target,
      internal_list_limit: 10,
      backlinks_status_type: 'live',
      include_subdomains: true,
    }),
  ]);

  out.cost_usd = (rankResp.cost || 0) + (compResp.cost || 0) + (blResp.cost || 0);

  // ── Hallazgo 1: keyword con mejor potencial ─────────────
  if (rankResp.ok && rankResp.result) {
    const items = rankResp.result.items || [];
    const totalKws = rankResp.result.total_count ?? items.length;
    // Buscar la keyword con mayor search_volume donde la posición es >= 5
    // (oportunidad real de subir, no top-1 que ya está consolidada).
    const ops = items
      .map((it) => ({
        keyword: it.keyword_data?.keyword,
        search_volume: it.keyword_data?.keyword_info?.search_volume ?? 0,
        cpc: it.keyword_data?.keyword_info?.cpc ?? 0,
        position: it.ranked_serp_element?.serp_item?.rank_absolute ?? null,
      }))
      .filter((x) => x.keyword && x.search_volume > 0);

    const opportunity = ops.find((x) => x.position >= 5 && x.position <= 50)
      || ops[0]
      || null;

    if (opportunity) {
      out.hallazgos.push({
        kind: 'keyword_opportunity',
        headline: `Posición ${opportunity.position} para "${opportunity.keyword}" (${opportunity.search_volume.toLocaleString('es-MX')} búsquedas/mes)`,
        detail: `Esta keyword vale ${opportunity.cpc ? '$' + opportunity.cpc.toFixed(2) + '/click' : 'tráfico orgánico'}. Subir de posición ${opportunity.position} al top 3 puede multiplicar el tráfico orgánico 5-8×.`,
        data: opportunity,
      });
    }
    if (totalKws > 0) {
      out.hallazgos.push({
        kind: 'kw_inventory',
        headline: `Tu sitio rankea para ${totalKws.toLocaleString('es-MX')} keywords en Google`,
        detail: `Inventario actual de keywords donde apareces en los resultados orgánicos.`,
        data: { total_count: totalKws },
      });
    }
  } else if (rankResp.error) {
    out.errors.push(`ranked_keywords: ${rankResp.error}`);
  }

  // ── Hallazgo 2: competidor principal ────────────────────
  if (compResp.ok && compResp.result) {
    const items = compResp.result.items || [];
    const top = items.find((c) => normalizeDomain(c.domain) !== target) || items[0];
    if (top) {
      out.top_competitor = {
        domain: top.domain,
        intersections: top.intersections,
        avg_position: top.avg_position,
        median_position: top.median_position,
      };
      out.hallazgos.push({
        kind: 'competitor_pressure',
        headline: `${top.domain} te compite directo en ${top.intersections} keywords`,
        detail: `Posición promedio del competidor: ${top.avg_position?.toFixed?.(1) ?? '—'}. Está apareciendo arriba tuyo en búsquedas que vos también querés capturar.`,
        data: top,
      });
    }
  } else if (compResp.error) {
    out.errors.push(`competitors: ${compResp.error}`);
  }

  // ── Hallazgo 3: salud de backlinks ──────────────────────
  if (blResp.ok && blResp.result) {
    const summary = blResp.result;
    const refDomains = summary.referring_domains ?? 0;
    const totalLinks = summary.backlinks ?? 0;
    const brokenPct = totalLinks > 0 && summary.broken_backlinks
      ? Math.round((summary.broken_backlinks / totalLinks) * 100)
      : 0;
    const spamScore = summary.referring_domains_nofollow ?? 0;

    if (brokenPct >= 20) {
      out.hallazgos.push({
        kind: 'broken_backlinks',
        headline: `${brokenPct}% de tus backlinks apuntan a páginas rotas`,
        detail: `${summary.broken_backlinks} de ${totalLinks} backlinks llegan a URLs muertas. Eso es autoridad SEO desperdiciada que se recupera con redirects 301.`,
        data: { broken: summary.broken_backlinks, total: totalLinks, broken_pct: brokenPct },
      });
    } else if (refDomains < 30) {
      out.hallazgos.push({
        kind: 'low_authority',
        headline: `Solo ${refDomains} dominios apuntan a tu sitio`,
        detail: `Para competir en tu industria necesitás 100-300 dominios refiriéndote. Estás muy por debajo del piso de autoridad.`,
        data: { referring_domains: refDomains, backlinks: totalLinks },
      });
    } else {
      out.hallazgos.push({
        kind: 'backlink_inventory',
        headline: `${refDomains} dominios apuntan a tu sitio (${totalLinks} backlinks totales)`,
        detail: `Perfil de links saludable. La oportunidad ahora es convertir esa autoridad en rankings concretos.`,
        data: { referring_domains: refDomains, backlinks: totalLinks },
      });
    }
  } else if (blResp.error) {
    out.errors.push(`backlinks: ${blResp.error}`);
  }

  // Limit to top 3 hallazgos and prioritize the most actionable kinds.
  const priority = ['keyword_opportunity', 'broken_backlinks', 'competitor_pressure', 'low_authority', 'kw_inventory', 'backlink_inventory'];
  out.hallazgos.sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind));
  out.hallazgos = out.hallazgos.slice(0, 3);

  out.ok = out.hallazgos.length > 0;
  return out;
}
