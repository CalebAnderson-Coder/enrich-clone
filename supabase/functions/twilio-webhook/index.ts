import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const geminiApiKey = Deno.env.get("GEMINI_API_KEY") || "";
const calendlyLink = "https://calendly.com/mi-agencia-demo/15min";

const supabase = createClient(supabaseUrl, supabaseKey);

const tools = [
  {
    function_declarations: [
      {
        name: "generateCheckoutLink",
        description: "Creates and delivers the Stripe payment link for $297 USD. Use it when the lead shows clear intent to buy or pay.",
        parameters: { type: "OBJECT", properties: {} }
      },
      {
        name: "getDemoUrl",
        description: "Delivers the demo/preview link of the website we built for them. Use it when they ask to see the site or page.",
        parameters: { type: "OBJECT", properties: {} }
      },
      {
        name: "bookImplementationMeeting",
        description: "Delivers the Calendly link to schedule a meeting or call.",
        parameters: { type: "OBJECT", properties: {} }
      }
    ]
  }
];

function twiml(message: string): Response {
  const safe = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`,
    { headers: { "Content-Type": "text/xml" } }
  );
}

function resp(message: string): Response {
  if (!message) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { headers: { "Content-Type": "text/xml" } }
    );
  }
  return twiml(message);
}

serve(async (req) => {
  // Health check
  if (req.method === "GET") {
    return new Response(JSON.stringify({
      status: "ok",
      hasGeminiKey: !!geminiApiKey,
      keyPrefix: geminiApiKey ? geminiApiKey.substring(0, 8) + "..." : "MISSING"
    }), { headers: { "Content-Type": "application/json" } });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const textBody = await req.text();
  const searchParams = new URLSearchParams(textBody);
  const fromPhone = searchParams.get("From");
  const userMessage = searchParams.get("Body");

  if (!fromPhone || !userMessage) {
    return resp("");
  }

  // 1. Find Lead
  const { data: leads, error: dbErr } = await supabase
    .from("smart_agency_leads")
    .select("*")
    .eq("phone", fromPhone)
    .limit(1);

  if (dbErr || !leads || leads.length === 0) {
    console.log(`[DB] phone=${fromPhone} not found or error:`, dbErr);
    return resp("");
  }

  const lead = leads[0];

  // 2. System prompt — English only
  const sys = `You are the Co-Founder of a premium web design agency.
Keep replies short — max 2 sentences, SMS-friendly. Be persuasive, casual, and human.
You're talking to "${lead.business_name}" (industry: ${lead.industry || "services"}).
Your goal: sell the website for $297 USD.
If they want to see the demo → use getDemoUrl.
If they want to pay → use generateCheckoutLink.
If they want a meeting or call → use bookImplementationMeeting.
NEVER invent links. Always use the provided functions. Reply in English only.`;

  // 3. Call Gemini
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;

  let geminiReply: string | null = null;
  let toolUsed: string | null = null;

  try {
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: sys }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        tools: tools
      })
    });

    const geminiJson = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error("[Gemini] Error:", JSON.stringify(geminiJson));
      return resp("Hey! Give me a sec, something went wrong on our end. Try again in a moment.");
    }

    const candidate = geminiJson?.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    for (const part of parts) {
      if (part.functionCall) {
        toolUsed = part.functionCall.name;
        break;
      }
      if (part.text) {
        geminiReply = part.text.trim();
      }
    }
  } catch (err) {
    console.error("[Gemini] Fetch error:", err);
    return resp("Hey! Give me a sec, something went wrong on our end. Try again in a moment.");
  }

  // 4. Execute tool
  if (toolUsed === "getDemoUrl") {
    const demoUrl = lead.demo_website_url || `https://preview.agency/${lead.id}`;
    return resp(`Here's the preview we built for ${lead.business_name}: ${demoUrl} — What do you think? 👀`);
  }

  if (toolUsed === "generateCheckoutLink") {
    await supabase
      .from("smart_agency_leads")
      .update({ pipeline_stage: "NEGOTIATION" })
      .eq("phone", fromPhone);
    return resp(`Perfect. Here's your secure payment link for $297: https://buy.stripe.com/demo123 — We transfer the domain instantly.`);
  }

  if (toolUsed === "bookImplementationMeeting") {
    return resp(`Of course! Book 15 min here: ${calendlyLink}`);
  }

  // 5. Fallback to text reply
  if (geminiReply) {
    return resp(geminiReply);
  }

  return resp("Hey! Something went wrong on my end. Could you repeat that?");
});
