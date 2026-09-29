/* ===========================================================================
   TRIBALSCHOLAR — GOVERNMENT INTEGRATIONS (DigiLocker + PFMS)

   Both services run through the `gov-gateway` Supabase Edge Function, which
   holds the real partner credentials server-side. Each service reports its
   own mode:

     live     – partner credentials configured on the gateway
     sandbox  – gateway reachable but no credentials, or gateway not
                deployed: realistic simulated responses in the browser

   Nothing here pretends to be real: every screen shows which mode it ran in.

   Loads AFTER script.js and data-service.js. Uses globals from script.js:
   ocrData, currentUser, currentProfile, escapeHTML, formatDate,
   runCrossVerification, runEligibilityPreCheck, updateOcrSummary,
   formatFieldLabel.
   =========================================================================== */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const esc = s => escapeHTML(s);
  const SANDBOX_OTP = "123456";

  /* ---------------------------------------------------------
     0. GATEWAY MODE DETECTION
     --------------------------------------------------------- */
  const modes = { gateway: "checking", digilocker: "sandbox", pfms: "sandbox" };
  let modesPromise = null;

  function detectModes() {
    if (modesPromise) return modesPromise;
    modesPromise = DataService.callFunction("gov-gateway", { action: "config" }, { timeoutMs: 6000 })
      .then(res => {
        if (res.ok && res.data) {
          modes.gateway = "online";
          modes.digilocker = res.data.digilocker === "live" ? "live" : "sandbox";
          modes.pfms = res.data.pfms === "live" ? "live" : "sandbox";
        } else {
          modes.gateway = "not-deployed";
        }
        return modes;
      });
    return modesPromise;
  }

  function modeBadge(mode) {
    return mode === "live"
      ? `<span class="gov-badge live">● LIVE</span>`
      : `<span class="gov-badge sandbox">● SANDBOX</span>`;
  }

  /* Small deterministic hash so sandbox data is stable per user/payment. */
  function seedOf(str) {
    let h = 2166136261;
    for (const ch of String(str)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }
  const digits = (seed, len) => String(seed).padStart(len, "7").slice(-len);

  function daysAgo(n) {
    const d = new Date(Date.now() - n * 86400000);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }

  /* =========================================================
     1. DIGILOCKER
     ========================================================= */
  const DOC_TARGETS = {
    stCertificate: { label: "ST Certificate", doctype: "CASTE" },
    incomeCertificate: { label: "Income Certificate", doctype: "INCER" },
    marksheet: { label: "Marksheet", doctype: "HSCER" }
  };

  // Documents fetched from DigiLocker, keyed by the form field they satisfy.
  // Read by script.js (readiness, eligibility, pre-check, submission).
  window.digiLockerDocs = {};

  function sandboxDocuments(holderName) {
    const seed = seedOf(currentUser?.email || holderName);
    const state = ["jharkhand", "odisha", "chhattisgarh", "madhyapradesh"][seed % 4];
    const stateName = { jharkhand: "Jharkhand", odisha: "Odisha", chhattisgarh: "Chhattisgarh", madhyapradesh: "Madhya Pradesh" }[state];
    return [
      {
        target: "stCertificate",
        name: "Scheduled Tribe Certificate",
        issuer: `Revenue Department, Government of ${stateName}`,
        uri: `in.gov.${state}-CASTE-${digits(seed, 10)}`,
        issuedOn: daysAgo(400 + (seed % 300)),
        fields: { name: holderName, certificateNumber: `ST/${digits(seed, 6)}`, issueDate: daysAgo(400 + (seed % 300)) }
      },
      {
        target: "incomeCertificate",
        name: "Income Certificate",
        issuer: `Revenue Department, Government of ${stateName}`,
        uri: `in.gov.${state}-INCER-${digits(seed * 3, 10)}`,
        issuedOn: daysAgo(40 + (seed % 90)),
        fields: {
          name: holderName,
          certificateNumber: `INC/${digits(seed * 3, 6)}`,
          issueDate: daysAgo(40 + (seed % 90)),
          annualIncome: String(180000 + (seed % 12) * 20000)
        }
      },
      {
        target: "marksheet",
        name: "Degree Marksheet",
        issuer: "University Grants Commission — National Academic Depository",
        uri: `in.gov.nad-HSCER-${digits(seed * 7, 10)}`,
        issuedOn: daysAgo(500 + (seed % 200)),
        fields: {
          name: holderName,
          certificateNumber: `NAD/${digits(seed * 7, 8)}`,
          issueDate: daysAgo(500 + (seed % 200)),
          percentage: 62 + (seed % 25) + 0.5
        }
      }
    ];
  }

  function ensureDigiLockerModal() {
    if ($("digilockerModal")) return;
    const modal = document.createElement("div");
    modal.id = "digilockerModal";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="modal-box digilocker-box" role="dialog" aria-label="DigiLocker">
        <div class="digilocker-head">
          <span class="digilocker-logo">🔒 DigiLocker</span>
          <span id="dlModeBadge"></span>
        </div>
        <div id="dlBody"></div>
        <button type="button" class="text-btn" data-dl-action="close">Cancel</button>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", onDigiLockerClick);
  }

  function dlRender(html) {
    $("dlModeBadge").innerHTML = modeBadge(modes.digilocker);
    $("dlBody").innerHTML = html;
  }

  function closeDigiLocker() {
    $("digilockerModal")?.classList.add("hidden");
  }

  async function startDigiLocker() {
    ensureDigiLockerModal();
    $("digilockerModal").classList.remove("hidden");
    dlRender(`<p class="muted">Connecting to DigiLocker…</p>`);
    await detectModes();

    dlRender(`
      <h3>TribalScholar is requesting access</h3>
      <p class="muted">You will be asked to sign in to DigiLocker. TribalScholar will be able to read:</p>
      <ul class="dl-scopes">
        <li>📄 Issued documents — ST certificate, income certificate, marksheet</li>
        <li>👤 Basic profile — name and date of birth</li>
      </ul>
      <p class="muted small">Documents are fetched directly from the issuing department, so they count as issuer-verified. You can revoke access any time from your DigiLocker account.</p>
      <div class="dl-actions">
        <button type="button" class="primary-btn" data-dl-action="allow">Allow &amp; continue</button>
        <button type="button" class="secondary-btn" data-dl-action="close">Deny</button>
      </div>
      ${modes.digilocker === "sandbox" ? `<p class="notice small">Sandbox mode: no real DigiLocker account is used. Real access needs DigiLocker partner (Requester) credentials configured on the gateway.</p>` : ""}
    `);
  }

  async function allowDigiLocker() {
    if (modes.digilocker === "live") {
      const res = await DataService.callFunction("gov-gateway", {
        action: "digilocker-authorize",
        redirectUri: window.location.origin + window.location.pathname
      });
      if (res.ok && res.data?.authorizeUrl && res.data?.state) {
        sessionStorage.setItem("tsDigiLockerState", res.data.state);
        sessionStorage.setItem("tsDigiLockerVerifier", res.data.codeVerifier || "");
        DataService.logIntegration("digilocker", "authorize", "live", "redirect");
        window.location.href = res.data.authorizeUrl;
        return;
      }
      dlRender(`<div class="message error">Could not start DigiLocker sign-in (${esc(res.data?.error || res.status)}). Please try again.</div>`);
      return;
    }

    dlRender(`
      <h3>Sign in to DigiLocker</h3>
      <label>Mobile number linked to DigiLocker
        <input id="dlMobile" inputmode="numeric" maxlength="10" placeholder="10-digit mobile number">
      </label>
      <div class="dl-actions">
        <button type="button" class="primary-btn" data-dl-action="send-otp">Send OTP</button>
      </div>
      <div id="dlError" class="dl-error" aria-live="polite"></div>
    `);
    $("dlMobile")?.focus();
  }

  function sendSandboxOtp() {
    const mobile = $("dlMobile")?.value.trim();
    if (!/^[6-9]\d{9}$/.test(mobile || "")) {
      $("dlError").textContent = "Enter a valid 10-digit Indian mobile number.";
      return;
    }
    dlRender(`
      <h3>Enter OTP</h3>
      <p class="muted">OTP sent to XXXXXX${esc(mobile.slice(-4))}. <span class="small">(Sandbox OTP: <code>${SANDBOX_OTP}</code>)</span></p>
      <label>6-digit OTP
        <input id="dlOtp" inputmode="numeric" maxlength="6" placeholder="••••••">
      </label>
      <div class="dl-actions">
        <button type="button" class="primary-btn" data-dl-action="verify-otp">Verify</button>
      </div>
      <div id="dlError" class="dl-error" aria-live="polite"></div>
    `);
    $("dlOtp")?.focus();
  }

  function verifySandboxOtp() {
    const otp = $("dlOtp")?.value.trim();
    if (otp !== SANDBOX_OTP) {
      $("dlError").textContent = "Incorrect OTP. Please try again.";
      return;
    }
    const holder =
      $("fullName")?.value.trim() ||
      currentProfile?.full_name?.replace(/\s*\(Demo\)\s*$/i, "") ||
      "Student";
    showDocumentPicker(sandboxDocuments(holder), "sandbox");
  }

  function showDocumentPicker(documents, mode) {
    pendingDocs = documents;
    const rows = documents.map((d, i) => `
      <label class="dl-doc">
        <input type="checkbox" data-dl-doc="${i}" ${d.target ? "checked" : "disabled"}>
        <div>
          <strong>${esc(d.name)}</strong>
          <span>${esc(d.issuer)}</span>
          <small>URI ${esc(d.uri)} · issued ${esc(d.issuedOn || "—")}</small>
        </div>
      </label>`).join("");
    dlRender(`
      <h3>Your issued documents</h3>
      <p class="muted">Select the documents to attach to this application.</p>
      <div class="dl-docs">${rows || `<p class="muted">No issued documents found in this DigiLocker account.</p>`}</div>
      <div class="dl-actions">
        <button type="button" class="primary-btn" data-dl-action="attach" ${documents.length ? "" : "disabled"}>Attach selected</button>
      </div>
    `);
    DataService.logIntegration("digilocker", "list-documents", mode, "ok", { count: documents.length });
  }

  let pendingDocs = [];

  function attachSelected() {
    const chosen = [...document.querySelectorAll("[data-dl-doc]:checked")]
      .map(el => pendingDocs[Number(el.dataset.dlDoc)])
      .filter(d => d && d.target);

    chosen.forEach(d => attachDocument(d));
    closeDigiLocker();

    if (typeof setIdentityStatus === "function") {
      setIdentityStatus(
        `✓ DigiLocker (${modes.digilocker}) — ${chosen.length} issuer-verified document(s) attached: ${chosen.map(d => DOC_TARGETS[d.target].label).join(", ")}.`,
        "success"
      );
    }
    DataService.logIntegration("digilocker", "attach", modes.digilocker, "ok", { documents: chosen.map(d => d.uri) });
  }

  function attachDocument(doc) {
    const target = doc.target;
    const input = $(target);
    window.digiLockerDocs[target] = {
      name: `${DOC_TARGETS[target].label.replace(/\s+/g, "_")}_DigiLocker.pdf`,
      uri: doc.uri,
      issuer: doc.issuer,
      issuedOn: doc.issuedOn,
      mode: modes.digilocker
    };
    if (input) {
      input.value = "";
      input.required = false;
    }

    // Issuer-verified fields feed the same cross-verification as OCR.
    ocrData[target] = { ...doc.fields, confidence: 100, source: "DigiLocker" };

    // Auto-fill empty form fields from issuer data.
    const fill = (id, value) => {
      const el = $(id);
      if (el && !el.value && value != null) el.value = value;
    };
    fill("fullName", doc.fields.name);
    if (target === "incomeCertificate") fill("income", doc.fields.annualIncome);
    if (target === "marksheet") fill("marks", doc.fields.percentage);

    const box = $(`ocr-${target}`);
    if (box) {
      box.classList.remove("hidden");
      box.innerHTML = `
        <div class="ocr-result-card digilocker-verified">
          <div class="ocr-result-header"><span>✓ Fetched from DigiLocker — issuer-verified ${modeBadge(modes.digilocker)}</span></div>
          <div class="ocr-field-row"><span>Issuer</span><strong>${esc(doc.issuer)}</strong></div>
          <div class="ocr-field-row"><span>Document URI</span><strong>${esc(doc.uri)}</strong></div>
          ${Object.entries(doc.fields).map(([k, v]) => `
            <div class="ocr-field-row"><span>${esc(formatFieldLabel(k))}</span><strong>${esc(v)}</strong></div>`).join("")}
          <button type="button" class="text-btn" data-dl-detach="${esc(target)}">Remove and upload a file instead</button>
        </div>`;
    }

    updateOcrSummary();
    runCrossVerification();
    runEligibilityPreCheck();
  }

  function detachDocument(target) {
    delete window.digiLockerDocs[target];
    delete ocrData[target];
    const input = $(target);
    if (input) input.required = true;
    const box = $(`ocr-${target}`);
    if (box) {
      box.innerHTML = "";
      box.classList.add("hidden");
    }
    updateOcrSummary();
    runCrossVerification();
    runEligibilityPreCheck();
  }

  function clearDigiLockerDocs() {
    Object.keys(window.digiLockerDocs).forEach(target => {
      const input = $(target);
      if (input) input.required = true;
    });
    window.digiLockerDocs = {};
  }

  function onDigiLockerClick(event) {
    const action = event.target.closest("[data-dl-action]")?.dataset.dlAction;
    if (action === "close") closeDigiLocker();
    if (action === "allow") allowDigiLocker();
    if (action === "send-otp") sendSandboxOtp();
    if (action === "verify-otp") verifySandboxOtp();
    if (action === "attach") attachSelected();
  }

  /* Live mode: DigiLocker redirects back with ?code=&state= */
  async function handleDigiLockerReturn() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) return;

    const expected = sessionStorage.getItem("tsDigiLockerState");
    const codeVerifier = sessionStorage.getItem("tsDigiLockerVerifier") || "";
    sessionStorage.removeItem("tsDigiLockerState");
    sessionStorage.removeItem("tsDigiLockerVerifier");
    history.replaceState(null, "", window.location.pathname);
    if (state !== expected) {
      console.warn("DigiLocker state mismatch — ignoring callback.");
      return;
    }

    await detectModes();
    ensureDigiLockerModal();
    $("digilockerModal").classList.remove("hidden");
    dlRender(`<p class="muted">Fetching your documents from DigiLocker…</p>`);

    const res = await DataService.callFunction("gov-gateway", {
      action: "digilocker-token",
      code,
      codeVerifier,
      redirectUri: window.location.origin + window.location.pathname
    }, { timeoutMs: 25000 });

    if (!res.ok || !Array.isArray(res.data?.documents)) {
      dlRender(`<div class="message error">DigiLocker returned an error: ${esc(res.data?.error || "unknown error")}</div>`);
      DataService.logIntegration("digilocker", "token", "live", "error", { status: res.status });
      return;
    }
    await showPage("apply");
    showDocumentPicker(res.data.documents, "live");
  }

  // Clear attached DigiLocker docs whenever the application form resets.
  document.addEventListener("reset", event => {
    if (event.target?.id === "applicationForm") clearDigiLockerDocs();
  }, true);

  document.addEventListener("click", event => {
    const target = event.target.closest("[data-dl-detach]")?.dataset.dlDetach;
    if (target) detachDocument(target);
  });

  // Put DigiLocker documents into the wallet's document vault on submit.
  document.addEventListener("submit", event => {
    if (event.target?.id !== "applicationForm" || !currentUser) return;
    const entries = Object.entries(window.digiLockerDocs);
    if (!entries.length) return;
    try {
      const vault = JSON.parse(localStorage.getItem("tribalScholarDocVault")) || [];
      const now = new Date().toISOString();
      entries.forEach(([target, d]) => vault.unshift({
        userId: currentUser.id,
        email: currentUser.email,
        type: DOC_TARGETS[target].label,
        filename: `${d.uri} (DigiLocker)`,
        sizeKb: 0,
        scheme: $("scheme")?.value || "",
        at: now,
        confidence: 100
      }));
      localStorage.setItem("tribalScholarDocVault", JSON.stringify(vault.slice(0, 200)));
    } catch {}
  }, true);

  /* =========================================================
     2. PFMS — beneficiary validation + DBT status
     ========================================================= */
  const BANKS = [
    ["State Bank of India", "SBIN"],
    ["Bank of India", "BKID"],
    ["Punjab National Bank", "PUNB"],
    ["Jharkhand Rajya Gramin Bank", "SBIN0RRVCGB"],
    ["India Post Payments Bank", "IPOS"]
  ];
  const SANDBOX_PROCESSING_MS = 15000; // sandbox PFMS moves one stage per sync after 15s

  function sandboxBeneficiary(p) {
    const seed = seedOf(p.id + p.applicationId);
    const [bank, code] = BANKS[seed % BANKS.length];
    return {
      beneficiaryCode: `PFMS${digits(seed, 9)}`,
      bankName: bank,
      ifsc: code.length > 4 ? code : `${code}0${digits(seed * 5, 6)}`,
      accountMasked: `XXXXXXXX${digits(seed * 11, 4)}`,
      aadhaarSeeded: true,
      validation: "Account validated by PFMS with the bank (name match: passed)",
      validatedAt: new Date().toISOString()
    };
  }

  function pfmsRef(stage) {
    const y = new Date().getFullYear();
    const r = n => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
    return [`SO/${y}/${r(5)}`, `PFMS-BATCH-${y}-${r(7)}`, `DBT-TXN-${r(10)}`, `UTR${r(12)}`][stage];
  }

  async function querySandbox(p) {
    const last = p.history[p.history.length - 1];
    const elapsed = Date.now() - new Date(last?.at || 0).getTime();
    const ready = p.stage < 3 && elapsed >= SANDBOX_PROCESSING_MS;
    return {
      beneficiary: p.pfms?.beneficiary || sandboxBeneficiary(p),
      stage: ready ? p.stage + 1 : p.stage,
      reference: ready ? pfmsRef(p.stage + 1) : null,
      message: ready
        ? null
        : p.stage >= 3
          ? "Amount already credited — no further updates."
          : `PFMS is processing the batch — next update in about ${Math.ceil((SANDBOX_PROCESSING_MS - elapsed) / 1000)}s.`
    };
  }

  async function queryLive(p) {
    const res = await DataService.callFunction("gov-gateway", {
      action: "pfms-status",
      payment: { id: p.id, sanctionOrder: p.sanctionOrder, applicationId: p.applicationId, amount: p.amount }
    }, { timeoutMs: 20000 });
    if (!res.ok) throw new Error(res.data?.error || `PFMS gateway error (${res.status})`);
    return res.data;
  }

  async function syncPayment(paymentId) {
    if (currentProfile?.role !== "officer") {
      alert("Only officers can sync payments with PFMS.");
      return;
    }
    const api = window.TSFeatures;
    if (!api) return;
    await detectModes();

    const pays = api.readPayments();
    const p = pays.find(x => x.id === paymentId);
    if (!p) return;

    const btn = document.querySelector(`[data-fx-action="pfms-sync"][data-id="${CSS.escape(paymentId)}"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Contacting PFMS…";
    }

    let result;
    try {
      result = modes.pfms === "live" ? await queryLive(p) : await querySandbox(p);
    } catch (e) {
      p.pfms = { ...(p.pfms || {}), lastSync: new Date().toISOString(), lastMessage: `Error: ${e.message}`, mode: modes.pfms };
      api.writePayments(pays);
      DataService.logIntegration("pfms", "status", modes.pfms, "error", { payment: p.id, error: e.message });
      await api.renderPayments();
      return;
    }

    p.pfms = {
      mode: modes.pfms,
      beneficiary: result.beneficiary || p.pfms?.beneficiary,
      lastSync: new Date().toISOString(),
      lastMessage: result.message || null
    };

    if (Number.isInteger(result.stage) && result.stage > p.stage && result.stage <= 3) {
      p.stage = result.stage;
      p.history.push({
        stage: p.stage,
        at: new Date().toISOString(),
        ref: result.reference || pfmsRef(p.stage),
        note: `Status received from PFMS (${modes.pfms})`
      });
    }

    api.writePayments(pays);
    DataService.logIntegration("pfms", "status", modes.pfms, "ok", { payment: p.id, stage: p.stage });
    await api.renderPayments();
  }

  async function syncAllPayments() {
    const api = window.TSFeatures;
    if (!api) return;
    for (const p of api.readPayments().filter(x => x.stage < 3)) {
      await syncPayment(p.id);
    }
  }

  /* Extra block rendered inside each payment card (called by script.js). */
  function paymentCardHtml(p, officerView) {
    const b = p.pfms?.beneficiary;
    const beneficiary = b
      ? `
        <div class="pfms-beneficiary">
          <div><span>PFMS beneficiary</span><strong>${esc(b.beneficiaryCode)}</strong></div>
          <div><span>Bank</span><strong>${esc(b.bankName)}</strong></div>
          <div><span>Account</span><strong>${esc(b.accountMasked)} · ${esc(b.ifsc)}</strong></div>
          <div><span>Aadhaar seeding (NPCI)</span><strong>${b.aadhaarSeeded ? "✓ Seeded" : "✕ Not seeded"}</strong></div>
        </div>
        <p class="muted small-note">${esc(b.validation || "")}</p>`
      : `<p class="muted small-note">Not yet validated with PFMS.</p>`;

    const syncInfo = p.pfms?.lastSync
      ? `<p class="muted small-note">Last PFMS sync ${esc(formatDate(p.pfms.lastSync))} ${modeBadge(p.pfms.mode)}${p.pfms.lastMessage ? ` — ${esc(p.pfms.lastMessage)}` : ""}</p>`
      : "";

    const syncBtn = officerView && p.stage < 3
      ? `<button type="button" class="secondary-btn" data-fx-action="pfms-sync" data-id="${esc(p.id)}">🔄 Sync with PFMS</button>`
      : "";

    return `<div class="pfms-block">${beneficiary}${syncInfo}${syncBtn}</div>`;
  }

  document.addEventListener("click", event => {
    const el = event.target.closest("[data-fx-action='pfms-sync'], [data-fx-action='pfms-sync-all']");
    if (!el) return;
    if (el.dataset.fxAction === "pfms-sync") syncPayment(el.dataset.id);
    else syncAllPayments();
  });

  /* =========================================================
     3. SERVICE STATUS PANEL (Officer Portal)
     ========================================================= */
  async function renderStatusPanel() {
    const box = $("integrationStatus");
    if (!box) return;
    box.innerHTML = `<p class="muted">Checking services…</p>`;
    await detectModes();
    const ai = window.StudyBuddyAI ? await window.StudyBuddyAI.status() : { mode: "offline", label: "Not loaded" };
    const db = DataService.status();

    const card = (icon, title, state, detail) => `
      <div class="svc-card ${state}">
        <div class="svc-head"><span>${icon} ${esc(title)}</span><span class="svc-state">${esc(state.toUpperCase())}</span></div>
        <p>${esc(detail)}</p>
      </div>`;

    const gatewayNote = modes.gateway === "online" ? "gateway online" : "gateway not deployed — browser sandbox";
    box.innerHTML = [
      card("🗄️", "Database (Supabase)", db.mode === "remote" ? "live" : db.mode === "partial" ? "partial" : "local", db.label),
      card("🤖", "AI Assistant (Gemini)", ai.mode, ai.label),
      card("🔒", "DigiLocker", modes.digilocker, modes.digilocker === "live" ? "Partner credentials configured" : `Simulated issuer documents · ${gatewayNote}`),
      card("💸", "PFMS / DBT", modes.pfms, modes.pfms === "live" ? "Agency credentials configured" : `Simulated beneficiary validation & DBT status · ${gatewayNote}`)
    ].join("");
  }

  const previousShowPage = window.showPage;
  window.showPage = async function (pageId) {
    await previousShowPage(pageId);
    if (pageId === "admin" && document.getElementById("admin")?.classList.contains("active")) {
      renderStatusPanel();
    }
  };

  document.addEventListener("DOMContentLoaded", handleDigiLockerReturn);

  window.GovIntegrations = {
    detectModes,
    modes,
    DigiLocker: { start: startDigiLocker, clear: clearDigiLockerDocs },
    PFMS: { sync: syncPayment, syncAll: syncAllPayments, cardHtml: paymentCardHtml },
    renderStatusPanel
  };
})();
