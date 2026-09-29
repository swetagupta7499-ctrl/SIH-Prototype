// ===========================================================================
// TribalScholar — aadhaar-qr Edge Function
// Real identity check without an eKYC licence: the student scans the Secure
// QR printed on their Aadhaar letter / e-Aadhaar / PVC card / mAadhaar app and
// this function verifies UIDAI's digital signature on it (see qr.ts).
//
// Privacy: the QR never holds the full Aadhaar number (only its last 4
// digits). The response carries only what the form needs; the photo and full
// address are discarded. The audit log stores no name or date of birth.
//
// POST { qr: "<decimal digits read from the QR>" }
//   → 200 { verified: true, keyId, name, dob, gender, district, state, pincode,
//           aadhaarLast4, generatedAt }
//   → 422 { verified: false, error }
// ===========================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { QrError, verifyAadhaarQr } from "./qr.ts";
import { UIDAI_KEYS } from "./uidai-keys.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAX_QR_CHARS = 20_000; // real Secure QRs are ~3–7k digits
const RATE_LIMIT = 10; // checks per minute per IP (best effort, per instance)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const hits = new Map<string, { count: number; reset: number }>();
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

/* The signed-in student, if the browser sent a user JWT (demo logins don't). */
async function userIdFrom(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: auth },
    });
    if (!res.ok) return null;
    return (await res.json())?.id ?? null;
  } catch {
    return null;
  }
}

/* Audit trail — best effort, never blocks the response. */
async function log(userId: string | null, status: string, detail: Record<string, unknown>) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/integration_logs`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ service: "aadhaar", action: "secure-qr", mode: "live", status, detail, user_id: userId }),
    });
  } catch (e) {
    console.warn("integration log failed", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) return json({ verified: false, error: "Too many attempts — please wait a minute." }, 429);

  const body = await req.json().catch(() => null);
  const qr = typeof body?.qr === "string" ? body.qr : "";
  if (!qr || qr.length > MAX_QR_CHARS) {
    return json({ verified: false, error: "Send the text read from the Aadhaar Secure QR." }, 400);
  }

  const userId = await userIdFrom(req);
  try {
    const r = await verifyAadhaarQr(qr, UIDAI_KEYS);
    if (!r.signatureValid) {
      await log(userId, "signature-invalid", { version: r.version });
      return json({
        verified: false,
        error: "UIDAI's digital signature on this QR is not valid. The QR may be edited, printed from an unofficial source, or damaged.",
      }, 422);
    }
    await log(userId, "verified", { keyId: r.keyId, version: r.version, aadhaarLast4: r.aadhaarLast4 });
    const { signatureValid: _s, ...fields } = r;
    return json({ verified: true, ...fields });
  } catch (e) {
    if (e instanceof QrError) {
      await log(userId, "unreadable", {});
      return json({ verified: false, error: e.message }, 422);
    }
    console.error("aadhaar-qr error", e);
    return json({ verified: false, error: "Verification failed — please try again." }, 500);
  }
});
