// Provider wrappers + role-based model policy
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
// import { getSecret } from "../libs/utils.js";

const GEMINI_MODEL_DEFAULT = process.env.AI_DEFAULT_MODEL || "gemini-1.5-flash";

export function enforceModelPolicy(role, requestedModel) {
  // employees & clients: force gemini
  if (role === "employee" || role === "client") return { provider: "gemini", model: GEMINI_MODEL_DEFAULT };
  // admin: allow toggle; default gemini
  if (role === "admin") {
    const m = (requestedModel || "gemini").toLowerCase();
    if (m.startsWith("chatgpt") || m.startsWith("gpt")) return { provider: "openai", model: "gpt-4o-mini" };
    return { provider: "gemini", model: GEMINI_MODEL_DEFAULT };
  }
  // fallback
  return { provider: "gemini", model: GEMINI_MODEL_DEFAULT };
}

export async function runGemini({ model, prompt, context, files = [] }) {
  // let genAI = await getSecret(process.env.GEMINI_API_KEY);
  let genAI = process.env.GEMINI_API_KEY;
  genAI = new GoogleGenerativeAI(genAI);
  if (!genAI) throw new Error("GEMINI_API_KEY missing");

  const sys = `You are vSuite AI. Answer using ONLY the provided context when possible.\n` +
              `If data is missing, say what you need. Keep answers concise and cite context sections by title.`;
  
  // Create content parts array starting with system and context
  const contentParts = [];
  
  // Add files if provided
  if (files && files.length > 0) {
    for (const file of files) {
      if (file.mimeType && file.data) {
        contentParts.push({
          inlineData: {
            mimeType: file.mimeType,
            data: file.data
          }
        });
      }
    }
  }
  
  // Add the text content
  const full = `SYSTEM:\n${sys}\n\nCONTEXT:\n${context}\n\nUSER:\n${prompt}`;
  contentParts.push({ text: full });

  const gModel = genAI.getGenerativeModel({ model });
  const resp = await gModel.generateContent(contentParts);
  return resp.response.text();
}

export async function runOpenAI({ model, prompt, context, files = [] }) {
  // let openai = await getSecret(process.env.OPENAI_API_KEY);
  let openai = process.env.OPENAI_API_KEY;
  openai = new OpenAI({ apiKey: openai});
  if (!openai) throw new Error("OPENAI_API_KEY missing");

  const messages = [
    { role: "system", content: "You are vSuite AI. Prefer facts found in the provided context. Be concise." },
    { role: "system", content: `Context:\n${context}` }
  ];

  // Add files if provided
  if (files && files.length > 0) {
    for (const file of files) {
      if (file.mimeType && file.data) {
        messages.push({
          role: "user",
          content: [
            { type: "image", image_url: { url: `data:${file.mimeType};base64,${file.data}` } }
          ]
        });
      }
    }
  }

  // Add the user prompt
  messages.push({ role: "user", content: prompt });

  const chat = await openai.chat.completions.create({
    model, messages, temperature: 0.2
  });
  return chat.choices?.[0]?.message?.content || "";
}