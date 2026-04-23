// ============================================================
// tests/spanish_only_linter.spec.js — Week 0 P1
//
// Native node test style (no Vitest/Jest) per repo convention.
// Run: node tests/spanish_only_linter.spec.js
// ============================================================

import { lintSpanishOnly } from '../lib/spanishOnlyLinter.js';

let failed = 0;
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

console.log('\n[spanishOnlyLinter] positive — Spanish samples should pass');
const positives = [
  'Hola Juan, vi que tu restaurante está en Miami y quería compartirte una idea rápida.',
  'Buenas tardes, soy Carlos de Empírika. Me gustaría coordinar una llamada breve con usted.',
  '¡Hola! Te escribo porque noté que tu negocio podría beneficiarse de nuestro servicio.',
  'Estimado cliente, le envío nuestra propuesta comercial adjunta para su revisión.',
  'Gracias por tu tiempo. Quedo atento a tu respuesta.',
  'Sabemos que dirigir un restaurante latino en Miami no es fácil; por eso te escribo.',
  '¿Tienes cinco minutos esta semana para revisar cómo podríamos ayudar?',
  'Nuestra plataforma está diseñada específicamente para negocios de la comunidad hispana.',
  'Atentamente,\nEl equipo de Empírika',
  'Hola María, espero que estés muy bien. Te comparto el enlace: https://empirika.com/demo',
  'Le escribo con relación al proyecto que comentamos la semana pasada.',
  'Quisiera confirmar nuestra cita para el próximo martes a las diez de la mañana.',
  'Su negocio tiene un perfil ideal para nuestra propuesta, por favor cuéntenos más.',
  'Disculpe la demora en responder; estábamos recopilando toda la información solicitada.',
  'Saludos cordiales desde Miami. Esperamos poder colaborar pronto.',
  'Nos encantaría conocer más sobre los objetivos de tu empresa este trimestre.',
  'Por favor, confírmame si el horario funciona para ti.',
  'Aquí tienes el resumen de nuestra reunión y los próximos pasos acordados.',
  'Nuestro equipo puede ayudarte a duplicar las reservas en tu restaurante.',
  '¿Te parece si agendamos una llamada de quince minutos este jueves?',
];
for (let i = 0; i < positives.length; i++) {
  test(`pos[${i}]`, () => {
    const r = lintSpanishOnly(positives[i]);
    assert(r.ok, `expected ok, got violations=${JSON.stringify(r.violations)}\n  text: ${positives[i]}`);
  });
}

console.log('\n[spanishOnlyLinter] negative — English/mixed should fail');
const negatives = [
  'Hi there, I wanted to reach out about your business.',
  "Hey, just following up on my last email. Let's connect soon.",
  'Hello, I hope this email finds you well. Best regards, Carlos.',
  'Good morning, quick question about your restaurant in Miami.',
  'Thanks for your time. Looking forward to hearing back.',
  'Hola, thanks for reading this email. Best regards.',
  'Estimado Juan, thanks for your time. Please let me know.',
  'Sincerely, the Empirika team.',
  'This is a completely English message without any Spanish content at all.',
  'Feel free to schedule a call at your convenience.',
  'Hi there! Wanted to share a quick preview with you.',
  'Hey John, quick question — do you have 15 minutes this week?',
  'Please find attached our proposal. Cheers, Carlos.',
  "Just wanted to follow up on my previous message. Let's chat.",
  'Sent from my iPhone',
  'Hello there! This is a friendly reminder about our meeting.',
  "I'm writing to you today to discuss a potential partnership.",
  'Warm regards and thank you for your continued support.',
  'P.S. Feel free to forward this to anyone interested.',
  'Book a time on my calendar whenever it works for you.',
];
for (let i = 0; i < negatives.length; i++) {
  test(`neg[${i}]`, () => {
    const r = lintSpanishOnly(negatives[i]);
    assert(!r.ok, `expected FAIL, got ok=true\n  text: ${negatives[i]}`);
  });
}

console.log('\n[spanishOnlyLinter] edge cases');
test('empty string fails', () => {
  const r = lintSpanishOnly('');
  assert(!r.ok);
  assert(r.violations.includes('empty_or_trivial_text'));
});
test('html tags stripped before lint', () => {
  const r = lintSpanishOnly('<p>Hola Juan, ¿cómo estás? Te escribo desde Miami.</p>');
  assert(r.ok, `violations=${JSON.stringify(r.violations)}`);
});
test('url-only short sentinel exempt from R2', () => {
  const r = lintSpanishOnly('https://empirika.com/demo');
  assert(r.ok, `violations=${JSON.stringify(r.violations)}`);
});
test('english forbidden phrase inside html fails', () => {
  const r = lintSpanishOnly('<div>Hi there, ¿cómo estás?</div>');
  assert(!r.ok);
});

console.log(`\n[spanishOnlyLinter] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
