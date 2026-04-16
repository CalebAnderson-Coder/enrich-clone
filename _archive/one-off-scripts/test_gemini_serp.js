import dotenv from "dotenv";
dotenv.config();
import { GoogleGenerativeAI } from "@google/generative-ai";

async function testGemini() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });

  const query = "landscaping Miami FL";
  const prompt = `You are a Google Maps API simulator. Provide a JSON list of real businesses matching: "${query}". 
Return an array of objects. Each object must have exactly these keys:
{
  "name": "String (Business Name)",
  "address": "String (Full Address)",
  "phone": "String (Phone number)",
  "website": "String (URL or null)",
  "rating": "Number (e.g. 4.8)",
  "reviewCount": "Number (e.g. 150)",
  "googleMapsUrl": "String (Google Maps URL or just string)"
}
Return ONLY the JSON array. Give me 5 real businesses.`;

  const result = await model.generateContent(prompt);
  console.log(result.response.text());
}
testGemini();
