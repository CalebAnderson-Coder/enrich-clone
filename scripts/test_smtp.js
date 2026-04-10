// scripts/test_smtp.js — One-shot SMTP connection test
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
dotenv.config();

const t = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS?.trim() },
  tls:    { rejectUnauthorized: false },
});

console.log(`\nTesting SMTP as: ${process.env.SMTP_USER}`);

t.verify((err) => {
  if (err) {
    console.error('❌ SMTP ERROR:', err.message);
    process.exit(1);
  } else {
    console.log(`✅ Gmail SMTP OK — listo para enviar como ${process.env.SMTP_USER}\n`);
    process.exit(0);
  }
});
