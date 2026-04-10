import dotenv from 'dotenv';
dotenv.config();

const WEBHOOK = 'https://pzxlgpnnizdambzepngf.supabase.co/functions/v1/twilio-webhook';
const PHONE = '+16179938515';

async function sendIncoming(message) {
    const form = new URLSearchParams();
    form.append("From", PHONE);
    form.append("To", process.env.TWILIO_PHONE_NUMBER);
    form.append("Body", message);

    const r = await fetch(WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString()
    });

    const xml = await r.text();
    const match = xml.match(/<Message>([\s\S]*?)<\/Message>/);
    return match ? match[1] : xml;
}

const conversations = [
    "Hey, show me the site you built",
    "Looks good, I want to pay",
    "Can you book me a call?"
];

console.log("🧪 Simulando conversación de Brian Anderson con el agente...\n");

for (const msg of conversations) {
    console.log(`📱 Brian: "${msg}"`);
    const reply = await sendIncoming(msg);
    console.log(`🤖 Agente: "${reply}"\n`);
}
