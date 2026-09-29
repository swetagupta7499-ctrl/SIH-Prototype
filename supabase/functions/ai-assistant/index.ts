// ===========================================================================
// TribalScholar — ai-assistant Edge Function
// Multilingual (English / हिंदी / Hinglish) Study Buddy backed by the
// Google Gemini API free tier. The API key stays here, never in the browser.
//
// Secrets:  GEMINI_API_KEY   (required)  — from https://aistudio.google.com
//           GEMINI_MODEL     (optional)  — default "gemini-3.5-flash-lite"
//           ALLOWED_ORIGINS  (optional)  — comma-separated, default "*"
//
// POST { ping: true }                         → { ok, configured, model }
// POST { messages: [{role, content}], lang, rules? }  → { reply, model }
//      rules = { NFST: { minMarks, maxIncome }, NOS: { … } } (live Rule Engine values)
// ===========================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const MAX_MESSAGES = 6;
const MAX_CHARS = 1000;
const RATE_LIMIT = 20; // requests per minute per IP (best effort, per instance)

// Fallback eligibility numbers — mirror DEFAULT_RULE_CONFIG in script.js.
const DEFAULT_RULES: Record<Scheme, SchemeRule> = {
  NFST: { minMarks: 55, maxIncome: 800000 },
  NOS: { minMarks: 60, maxIncome: 800000 },
};

const SYSTEM_PROMPT = `You are "Study Buddy" in TribalScholar, a prototype scholarship portal for Scheduled Tribe (ST) students in India.

LANGUAGE: reply in the student's language and script (Devanagari → simple Hindi, Latin-script Hinglish → Hinglish, else simple English); follow any preferred-language hint. Short sentences, everyday words — readers are often first-generation learners on a phone.

FACTS
- Schemes: NFST (National Fellowship for ST Students, PhD/research in India); NOS (National Overseas Scholarship, Master's/PhD abroad, needs a university offer letter). Officers set eligibility in the Rule Engine (current values below).
- Documents: ST certificate, marksheet, income certificate (+ offer letter for NOS). Upload photos/PDFs (blur/lighting check + OCR) or fetch verified copies via DigiLocker.
- Steps: log in → choose scheme → fill details → upload/DigiLocker → "Check My Application" → submit → Application ID (e.g. TS260001).
- Track: "Track Application" tab + ID. Statuses: Submitted, Under Review, Deficient (needs a fix), Approved.
- Payments tab: Sanctioned → Payment Initiated (PFMS) → DBT Processed → Credited; bank account must be Aadhaar-seeded (NPCI mapper).
- Grievance tab: pick category → ticket ID, auto-routed with a target date; resolved tickets can be reopened.
- Wallet: one profile with all schemes, applications, documents, payments, grievances.

RULES
- Only scholarships, applying, documents, payments, grievances, study guidance; politely decline the rest.
- Never ask for or repeat Aadhaar, bank account numbers, passwords or OTPs; if shared, tell them not to.
- Never promise approval, amounts or dates. If unsure, say so and suggest the scheme helpdesk / state nodal office.
- If the student seems distressed, be kind; suggest someone they trust or Tele-MANAS 14416.
- When stating eligibility numbers, note they are prototype rules; check official guidelines.
- PLAIN TEXT only, no Markdown (no **, #, or "* "); list lines start with "• " or "1.".
- Under ~120 words unless asked for detail.
- Answer directly; don't open with "Hello" or another greeting unless the student greets you.`;

const hits = new Map<string, { count: number; reset: number }>();

function corsHeaders(origin: string | null): HeadersInit {
  const allowAll = ALLOWED_ORIGINS.includes("*");
  const allowed = allowAll ? "*" : origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.reset < now) {
    hits.set(ip, { count: 1, reset: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

type ChatMessage = { role: "user" | "assistant"; content: string };
type Scheme = "NFST" | "NOS";
type SchemeRule = { minMarks: number; maxIncome: number };

/* Live officer rules from the client ({ NFST: { minMarks, maxIncome }, NOS: … }).
   Each number is range-checked; anything missing or invalid falls back to the default. */
function eligibilityLine(raw: unknown): string {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, Partial<SchemeRule>>;
  const num = (v: unknown, min: number, max: number, dflt: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : dflt;
  const parts = (Object.keys(DEFAULT_RULES) as Scheme[]).map((s) => {
    const d = DEFAULT_RULES[s];
    const marks = num(src[s]?.minMarks, 0, 100, d.minMarks);
    const income = Math.round(num(src[s]?.maxIncome, 0, 100_000_000, d.maxIncome));
    return `${s} marks ≥ ${marks}%, income ≤ ₹${income.toLocaleString("en-IN")}`;
  });
  return `\n\nCurrent eligibility (prototype rules): ${parts.join("; ")}.`;
}

/* Cut a reply that hit maxOutputTokens back to its last complete sentence / line. */
function trimToLastSentence(text: string): string {
  let cut = -1;
  for (const m of text.matchAll(/[.!?।](?=\s|$)|\n/g)) cut = (m.index ?? -1) + (m[0] === "\n" ? 0 : 1);
  const trimmed = cut > text.length * 0.4 ? text.slice(0, cut) : text;
  return trimmed.trimEnd() + " …";
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  if (!ALLOWED_ORIGINS.includes("*") && origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: "Origin not allowed" }, 403, origin);
  }

  const body = await req.json().catch(() => null);
  if (body?.ping) return json({ ok: true, configured: Boolean(GEMINI_API_KEY), model: MODEL }, 200, origin);
  if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY is not configured" }, 503, origin);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) return json({ error: "Too many requests — please wait a minute." }, 429, origin);

  const raw: unknown[] = Array.isArray(body?.messages) ? body.messages : [];
  const messages: ChatMessage[] = raw
    .filter((m): m is ChatMessage =>
      typeof m === "object" && m !== null &&
      ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
      typeof (m as ChatMessage).content === "string" && (m as ChatMessage).content.trim().length > 0
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json({ error: "Send at least one user message." }, 400, origin);
  }

  // The script of the latest message decides the reply script: Devanagari in → Devanagari out.
  const devanagari = /[\u0900-\u097F]/.test(messages[messages.length - 1].content);
  const langHint = devanagari
    ? "\n\nThe student wrote in Devanagari: reply in simple Hindi written in Devanagari script, not in Latin-script Hinglish."
    : body?.lang === "hi"
    ? "\n\nThe student wrote Hinglish in Latin script: reply in Hinglish (Latin script)."
    : body?.lang === "en"
    ? "\n\nPreferred language: English."
    : "";

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT + eligibilityLine(body?.rules) + langHint }] },
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 800, // headroom for Devanagari, which costs more tokens
        },
      }),
    },
  ).catch((e) => {
    console.error("Gemini request failed", e);
    return null;
  });

  if (!geminiRes) return json({ error: "AI service unreachable" }, 502, origin);
  if (geminiRes.status === 429) return json({ error: "AI free-tier limit reached" }, 429, origin);
  if (!geminiRes.ok) {
    console.error("Gemini error", geminiRes.status, await geminiRes.text());
    return json({ error: `AI service error (${geminiRes.status})` }, 502, origin);
  }

  const data = await geminiRes.json();
  const candidate = data?.candidates?.[0];
  const finish: string = candidate?.finishReason ?? "";
  let reply: string = (candidate?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("")
    .trim();

  // Blocked or empty → error, so the client falls back to its built-in guide.
  if (!reply || data?.promptFeedback?.blockReason || ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(finish)) {
    return json({ error: "The AI could not answer that question." }, 502, origin);
  }
  if (finish === "MAX_TOKENS") reply = trimToLastSentence(reply);

  return json({ reply, model: MODEL }, 200, origin);
});
