// ===========================================================================
// TribalScholar — gov-gateway Edge Function
// Server-side gateway for government integrations. Partner credentials stay
// here; the browser only ever sees document metadata and payment status.
//
//   DigiLocker (Requester / Partner API, OAuth 2.0 + PKCE)
//     Secrets: DIGILOCKER_CLIENT_ID, DIGILOCKER_CLIENT_SECRET,
//              DIGILOCKER_REDIRECT_URIS (comma-separated allow-list),
//              DIGILOCKER_BASE_URL (optional)
//
//   PFMS (DBT payment status) — PFMS has no public REST API; agencies get an
//   integration spec (web service / SFTP XML) on onboarding. This adapter
//   calls a configurable endpoint and maps the response in mapPfmsResponse().
//     Secrets: PFMS_BASE_URL, PFMS_API_KEY, PFMS_AGENCY_CODE
//
// Without credentials each service reports "sandbox" and the browser runs
// the clearly-labelled simulation in js/gov-integrations.js.
//
// POST { action: "config" }
// POST { action: "digilocker-authorize", redirectUri }
// POST { action: "digilocker-token", code, codeVerifier, redirectUri }
// POST { action: "pfms-status", payment: { id, sanctionOrder, applicationId, amount } }
// ===========================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const env = (k: string) => Deno.env.get(k) ?? "";

const DL_CLIENT_ID = env("DIGILOCKER_CLIENT_ID");
const DL_CLIENT_SECRET = env("DIGILOCKER_CLIENT_SECRET");
// Verify these paths against the DigiLocker partner documentation you are issued.
const DL_BASE = env("DIGILOCKER_BASE_URL") || "https://digilocker.meripehchaan.gov.in/public/oauth2";
const DL_REDIRECTS = env("DIGILOCKER_REDIRECT_URIS").split(",").map((s) => s.trim()).filter(Boolean);
const DL_LIVE = Boolean(DL_CLIENT_ID && DL_CLIENT_SECRET && DL_REDIRECTS.length);

const PFMS_BASE = env("PFMS_BASE_URL");
const PFMS_KEY = env("PFMS_API_KEY");
const PFMS_AGENCY = env("PFMS_AGENCY_CODE");
const PFMS_LIVE = Boolean(PFMS_BASE && PFMS_KEY && PFMS_AGENCY);

const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

/* Audit trail — best effort, never blocks the response. */
async function log(service: string, action: string, mode: string, status: string, detail: Record<string, unknown> = {}) {
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
      body: JSON.stringify({ service, action, mode, status, detail, user_id: null }),
    });
  } catch (e) {
    console.warn("integration log failed", e);
  }
}

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkcePair() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge: base64url(digest) };
}

/* DigiLocker doctype → TribalScholar form field */
function targetFor(doctype: string): string | null {
  const t = doctype.toUpperCase();
  if (["CASTE", "STCER", "CSTCR"].includes(t)) return "stCertificate";
  if (["INCER", "INCMC"].includes(t)) return "incomeCertificate";
  if (["HSCER", "SSCER", "MARKS", "DGCER", "PGCER"].includes(t)) return "marksheet";
  return null;
}

async function digilockerAuthorize(redirectUri: string) {
  if (!DL_LIVE) return json({ error: "DigiLocker credentials not configured" }, 503);
  if (!DL_REDIRECTS.includes(redirectUri)) return json({ error: "redirectUri is not in DIGILOCKER_REDIRECT_URIS" }, 400);

  const state = crypto.randomUUID();
  const { verifier, challenge } = await pkcePair();
  const url = new URL(`${DL_BASE}/1/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: DL_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  await log("digilocker", "authorize", "live", "ok");
  return json({ authorizeUrl: url.toString(), state, codeVerifier: verifier });
}

async function digilockerToken(code: string, codeVerifier: string, redirectUri: string) {
  if (!DL_LIVE) return json({ error: "DigiLocker credentials not configured" }, 503);
  if (!code || !codeVerifier) return json({ error: "code and codeVerifier are required" }, 400);
  if (!DL_REDIRECTS.includes(redirectUri)) return json({ error: "redirectUri is not in DIGILOCKER_REDIRECT_URIS" }, 400);

  const tokenRes = await fetch(`${DL_BASE}/1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: DL_CLIENT_ID,
      client_secret: DL_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  if (!tokenRes.ok) {
    await log("digilocker", "token", "live", "error", { status: tokenRes.status });
    return json({ error: `DigiLocker token exchange failed (${tokenRes.status})` }, 502);
  }
  const token = await tokenRes.json();
  const auth = { Authorization: `Bearer ${token.access_token}` };

  const [filesRes, userRes] = await Promise.all([
    fetch(`${DL_BASE}/2/files/issued`, { headers: auth }),
    fetch(`${DL_BASE}/1/user`, { headers: auth }),
  ]);
  if (!filesRes.ok) {
    await log("digilocker", "issued-files", "live", "error", { status: filesRes.status });
    return json({ error: `Could not list issued documents (${filesRes.status})` }, 502);
  }
  const files = await filesRes.json();
  const user = userRes.ok ? await userRes.json() : {};
  const holder = user?.name ?? token?.name ?? "";

  const documents = (files?.items ?? []).map((item: Record<string, string>) => ({
    target: targetFor(item.doctype ?? ""),
    name: item.name ?? item.description ?? item.doctype,
    issuer: item.issuer ?? item.issuerid ?? "Issuer",
    uri: item.uri,
    issuedOn: item.date ?? null,
    // Structured values (income, percentage) need the per-document XML
    // endpoint for each doctype; name is enough for identity cross-checks.
    fields: { name: holder, certificateNumber: item.uri?.split("-").pop() ?? null, issueDate: item.date ?? null },
  }));

  await log("digilocker", "issued-files", "live", "ok", { count: documents.length });
  // The access token is deliberately NOT returned to the browser.
  return json({ documents, holder });
}

/* Adapt this to the PFMS integration spec issued to your agency. */
function mapPfmsResponse(raw: Record<string, unknown>) {
  const stageByStatus: Record<string, number> = {
    SANCTIONED: 0,
    PAYMENT_INITIATED: 1,
    SENT_TO_BANK: 1,
    DBT_PROCESSED: 2,
    PROCESSED: 2,
    CREDITED: 3,
    SUCCESS: 3,
  };
  const status = String(raw.status ?? raw.paymentStatus ?? "").toUpperCase();
  return {
    stage: stageByStatus[status],
    reference: (raw.utr ?? raw.transactionId ?? raw.batchId ?? null) as string | null,
    message: (raw.remarks ?? raw.failureReason ?? null) as string | null,
    beneficiary: raw.beneficiary
      ? {
        beneficiaryCode: (raw.beneficiary as Record<string, unknown>).code,
        bankName: (raw.beneficiary as Record<string, unknown>).bankName,
        ifsc: (raw.beneficiary as Record<string, unknown>).ifsc,
        accountMasked: (raw.beneficiary as Record<string, unknown>).accountMasked,
        aadhaarSeeded: Boolean((raw.beneficiary as Record<string, unknown>).aadhaarSeeded),
        validation: "Validated by PFMS",
        validatedAt: new Date().toISOString(),
      }
      : undefined,
  };
}

async function pfmsStatus(payment: Record<string, unknown>) {
  if (!PFMS_LIVE) return json({ error: "PFMS credentials not configured" }, 503);
  if (!payment?.sanctionOrder) return json({ error: "payment.sanctionOrder is required" }, 400);

  const url = new URL(`${PFMS_BASE.replace(/\/$/, "")}/payment-status`);
  url.search = new URLSearchParams({
    agencyCode: PFMS_AGENCY,
    sanctionOrder: String(payment.sanctionOrder),
    referenceId: String(payment.id ?? ""),
  }).toString();

  const res = await fetch(url, { headers: { "x-api-key": PFMS_KEY, Accept: "application/json" } });
  if (!res.ok) {
    await log("pfms", "status", "live", "error", { status: res.status, payment: payment.id });
    return json({ error: `PFMS returned ${res.status}` }, 502);
  }
  const mapped = mapPfmsResponse(await res.json());
  await log("pfms", "status", "live", "ok", { payment: payment.id, stage: mapped.stage });
  return json(mapped);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  try {
    switch (body?.action) {
      case "config":
        return json({ digilocker: DL_LIVE ? "live" : "sandbox", pfms: PFMS_LIVE ? "live" : "sandbox" });
      case "digilocker-authorize":
        return await digilockerAuthorize(String(body.redirectUri ?? ""));
      case "digilocker-token":
        return await digilockerToken(String(body.code ?? ""), String(body.codeVerifier ?? ""), String(body.redirectUri ?? ""));
      case "pfms-status":
        return await pfmsStatus(body.payment ?? {});
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("gov-gateway error", e);
    return json({ error: "Gateway error" }, 500);
  }
});
