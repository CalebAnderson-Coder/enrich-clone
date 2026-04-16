export type Lead = {
  id: string;
  name: string;
  company: string;
  email: string;
  source: string;
  score: 'Caliente' | 'Tibio' | 'Frío' | 'Radar';
  addedAt: string;
  context: string;
};

export const leadsMockData: Lead[] = [
  {
    id: 'l-001',
    name: 'Juan Pérez',
    company: 'Tech Solutions SA',
    email: 'juan@techsolutions.com',
    source: 'LinkedIn Inbound',
    score: 'Caliente',
    addedAt: '2023-11-20T10:00:00Z',
    context: 'Buscan automatizar su proceso de onboarding de clientes.'
  },
  {
    id: 'l-002',
    name: 'María García',
    company: 'Finanzas Rápidas',
    email: 'maria@finanzasrapidas.com',
    source: 'Webinar Lead',
    score: 'Tibio',
    addedAt: '2023-11-19T14:30:00Z',
    context: 'Interesados en integrar n8n con su CRM actual (Salesforce).'
  },
  {
    id: 'l-003',
    name: 'Carlos Ruiz',
    company: 'Agencia Digital Pro',
    email: 'carlos@agenciadigitalpro.com',
    source: 'Direct Search',
    score: 'Frío',
    addedAt: '2023-11-18T09:15:00Z',
    context: 'Preguntou precios sobre desarrollo de agentes a medida, sin detalles.'
  },
  {
    id: 'l-004',
    name: 'Ana López',
    company: 'E-commerce Beta',
    email: 'ana@ecommercebeta.com',
    source: 'Referral',
    score: 'Caliente',
    addedAt: '2023-11-21T11:45:00Z',
    context: 'Problemas graves de abandonos de carrito. Quieren un agente en WhatsApp.'
  },
  {
    id: 'l-005',
    name: 'Pedro Martínez',
    company: 'Logística Total',
    email: 'pedro@logisticatotal.com',
    source: 'Cold Email',
    score: 'Radar',
    addedAt: '2023-11-15T16:20:00Z',
    context: 'Abrió el correo pero no respondió. Mantenemos en radar.'
  } as Lead
];
