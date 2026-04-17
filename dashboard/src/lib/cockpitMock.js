// Mock data generator for the Creator Cockpit.
// Shape matches the /api/cockpit/stats and /api/cockpit/events contracts.
// Flip USE_MOCK in CockpitView.jsx to false once the backend stream lands.

const AGENTS = [
  'scout', 'angela', 'helena', 'sam', 'kai',
  'carlos', 'davinci', 'manager', 'verifier',
];

const EVENT_TYPES = ['tool_call', 'tool_result', 'zod_error', 'decision', 'recall_hit'];
const TOOLS = ['save_lead', 'email_sequence', 'enrich_company', 'draft_email', 'verify_lead', 'schedule_send'];
const STATUSES = ['ok', 'ok', 'ok', 'ok', 'blocked', 'fail'];
const BUSINESSES = [
  'Acevedo Roofing', 'Bright Dental', 'CasaVerde Landscaping', 'Delgado Auto',
  'ElPollo Express', 'Flores HVAC', 'Gomez Plumbing', 'Hidalgo Electric',
  'Iberia Cafe', 'Juarez Law', 'Kinetic Gym', 'Luna Bakery',
];
const TIERS = ['HOT', 'WARM', 'COOL', 'COOL', 'COOL'];

let eventIdSeed = 10000;

function randPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function nowIso(offsetMs = 0) {
  return new Date(Date.now() - offsetMs).toISOString();
}

export function generateMockEvent(offsetMs = 0) {
  eventIdSeed += 1;
  const agent = randPick(AGENTS);
  const eventType = randPick(EVENT_TYPES);
  const status = eventType === 'zod_error' ? 'fail' : randPick(STATUSES);
  const tool = eventType.startsWith('tool') ? randPick(TOOLS) : null;
  const business = randPick(BUSINESSES);
  const tier = randPick(TIERS);

  return {
    id: eventIdSeed,
    ts: nowIso(offsetMs),
    trace_id: `trace_${Math.random().toString(36).slice(2, 8)}`,
    agent,
    event_type: eventType,
    tool,
    status,
    metadata: {
      lead_tier: tier,
      business_name: business,
      touch: tool === 'email_sequence' ? Math.ceil(Math.random() * 3) : undefined,
      note: eventType === 'zod_error' ? 'auto_enrich string' : undefined,
    },
  };
}

export function getMockStats() {
  // Small random drift so numbers feel alive on 5s poll.
  const drift = () => Math.floor(Math.random() * 4);
  const baseTotal = 142 + drift();
  return {
    window: '24h',
    leads: {
      total: baseTotal,
      hot: 12 + drift(),
      warm: 30 + drift(),
      cool: 100 + drift(),
    },
    funnel: {
      prospected: 180 + drift(),
      saved: 142 + drift(),
      enriched: 89 + drift(),
      drafted: 68 + drift(),
      sent: 56 + drift(),
      replied: 3 + Math.floor(Math.random() * 2),
    },
    agents: AGENTS.map((a) => ({
      agent: a,
      calls: 20 + Math.floor(Math.random() * 50),
      success_rate: 0.6 + Math.random() * 0.35,
      avg_duration_ms: 900 + Math.floor(Math.random() * 2000),
      zod_errors: Math.random() > 0.7 ? Math.floor(Math.random() * 3) : 0,
      last_seen: nowIso(Math.floor(Math.random() * 120000)),
    })),
    verifier: {
      pass_rate: 0.78 + Math.random() * 0.1,
      blocked_low_quality: 5 + Math.floor(Math.random() * 5),
      total_evaluated: 40 + Math.floor(Math.random() * 10),
    },
    cost: {
      tokens_in: 120000 + Math.floor(Math.random() * 5000),
      tokens_out: 35000 + Math.floor(Math.random() * 2000),
      estimated_usd: 0.42 + Math.random() * 0.1,
    },
    memory: {
      total_rows: 37 + Math.floor(Math.random() * 2),
      last_24h_added: 4,
      recall_hits: 12 + Math.floor(Math.random() * 3),
      // 7d sparkline for the memory growth curve (stubbed)
      sparkline: [22, 26, 28, 30, 33, 35, 37],
    },
  };
}

export function getMockBootstrapEvents(count = 30) {
  // Oldest → newest; CockpitView prepends newest so we return descending-in-time.
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(generateMockEvent(i * 1500));
  }
  return out;
}

// Subscribe to a simulated SSE stream. Returns an unsubscribe fn.
export function subscribeMockStream(onEvent) {
  const interval = setInterval(() => {
    onEvent(generateMockEvent(0));
  }, 1800);
  return () => clearInterval(interval);
}
