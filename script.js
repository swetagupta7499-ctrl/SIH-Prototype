/* ===========================================================================
   TRIBALSCHOLAR — FINAL MERGED SCRIPT (SIH RATE-LIMIT SAFE EDITION)
   Supabase Auth, DB & Storage + Auto Rate-Limit Bypass + AI OCR +
   Cross-Verification + AI Eligibility Engine + Smart Deficiency Alerts +
   AI Priority Queue + Dynamic Rule Engine + Study Buddy
   =========================================================================== */

/* =========================================================
   1. SUPABASE CONFIGURATION
   ========================================================= */
const SUPABASE_URL = "https://uieigcolfhexqqqmzydk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_zy7ToyexAbIKxEsbwYmkKw_nA7ReHgD";

if (!window.supabase) {
  throw new Error("Supabase JS library failed to load. Check index.html.");
}

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

/* =========================================================
   2. GLOBAL STATE & LOCAL CACHES (RATE-LIMIT FALLBACK READY)
   ========================================================= */
let currentUser = null;
let currentProfile = null;
let authMode = "login";

const ocrData = {}; // { stCertificate: {...fields}, marksheet: {...fields}, incomeCertificate: {...fields} }
const ALERT_CACHE_KEY = "tribalScholarDeficiencyAlerts";
const DEMO_SESSION_KEY = "tribalScholarFallbackSession";
const LOCAL_APPS_KEY = "tribalScholarLocalApplications";

function getAlertCache() {
  try {
    return JSON.parse(localStorage.getItem(ALERT_CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveAlertToCache(appId, alertObj) {
  const cache = getAlertCache();
  cache[appId] = alertObj;
  localStorage.setItem(ALERT_CACHE_KEY, JSON.stringify(cache));
}

function getFallbackSession() {
  try {
    return JSON.parse(localStorage.getItem(DEMO_SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

function setFallbackSession(userObj, profileObj) {
  localStorage.setItem(
    DEMO_SESSION_KEY,
    JSON.stringify({ user: userObj, profile: profileObj })
  );
}

function clearFallbackSession() {
  localStorage.removeItem(DEMO_SESSION_KEY);
}

function getLocalApplications() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_APPS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveLocalApplications(apps) {
  localStorage.setItem(LOCAL_APPS_KEY, JSON.stringify(apps));
}

/* =========================================================
   3. AI-POWERED OCR ENGINE (Tesseract.js + PDF.js)
   ========================================================= */
async function pdfFirstPageToImage(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport
  }).promise;

  return canvas.toDataURL("image/png");
}

async function handleDocumentOCR(inputEl, docType, displayName) {
  const file = inputEl.files[0];
  const box = document.getElementById(`ocr-${docType}`);

  if (!file || !box) return;

  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="ocr-loading">
      🔎 Reading ${escapeHTML(displayName)}… analyzing document…
    </div>
  `;

  // A new upload replaces any DigiLocker document attached to this field.
  if (window.digiLockerDocs?.[docType]) delete window.digiLockerDocs[docType];

  try {
    const rawSource = file.type === "application/pdf"
      ? await pdfFirstPageToImage(file)
      : file;

    // Image pre-processing: blur/exposure check + auto-contrast before OCR
    let source = rawSource;
    let prepared = null;
    if (window.OcrPreprocess) {
      box.innerHTML = `<div class="ocr-loading">🪄 Checking image quality &amp; enhancing ${escapeHTML(displayName)}…</div>`;
      try {
        prepared = await OcrPreprocess.prepare(rawSource);
        source = prepared.dataUrl;
      } catch (prepError) {
        console.warn("Pre-processing skipped:", prepError);
      }
    }

    const { data } = await Tesseract.recognize(source, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          box.innerHTML = `
            <div class="ocr-loading">
              🔎 Reading ${escapeHTML(displayName)}… ${Math.round(m.progress * 100)}%
            </div>
          `;
        }
      }
    });

    const fields = extractStructuredFields(data.text, docType);
    ocrData[docType] = {
      ...fields,
      confidence: Math.round(data.confidence),
      quality: prepared?.quality || null,
      rawText: data.text || ""
    };

    renderOcrBox(docType, displayName, ocrData[docType], prepared?.previews);
    updateOcrSummary();
    runCrossVerification();
    runEligibilityPreCheck();
  } catch (err) {
    box.innerHTML = `
      <div class="ocr-error">
        ⚠ Could not read this document (${escapeHTML(err.message)}).
        You can still submit — an officer will verify it manually.
      </div>
    `;
  }
}

/* --- OCR text helpers: tolerate the noise Tesseract introduces ---------- */

const OCR_MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12
};

/* Clean common OCR mistakes so labels and separators match reliably:
   ';' misread for ':', stray spaces around separators, O/o -> 0 inside
   digit runs, l/I -> 1 inside digit runs. */
function normalizeOcrText(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  t = t.replace(/;/g, ":");
  // Join spaced-out numeric dates: "15 / 08 / 2003" -> "15/08/2003",
  // "15 08 2003" -> "15/08/2003".
  t = t.replace(/\b(\d{1,2})\s*([\/\-.])\s*(\d{1,2})\s*\2\s*(\d{2,4})\b/g, "$1$2$3$2$4");
  t = t.replace(/\b(\d{1,2})\s+(\d{1,2})\s+(\d{4})\b/g, "$1/$2/$3");
  return t;
}

/* Turn any recognised date string into DD/MM/YYYY (best effort). */
function normalizeDate(str) {
  if (!str) return null;
  const s = str.trim().replace(/(\d)(st|nd|rd|th)\b/gi, "$1");

  // ISO: YYYY-MM-DD
  let m = s.match(/\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (m) return pad2(m[3]) + "/" + pad2(m[2]) + "/" + m[1];

  // Numeric: DD/MM/YYYY or DD-MM-YY
  m = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (m) return pad2(m[1]) + "/" + pad2(m[2]) + "/" + fullYear(m[3]);

  // "12 Jan 2005" / "12-Jan-2005"
  m = s.match(/\b(\d{1,2})[\s\-]([A-Za-z]{3,9})[\s\-](\d{2,4})\b/);
  if (m && OCR_MONTHS[m[2].toLowerCase()]) {
    return pad2(m[1]) + "/" + pad2(OCR_MONTHS[m[2].toLowerCase()]) + "/" + fullYear(m[3]);
  }

  // "January 12, 2005" / "Jan 12 2005"
  m = s.match(/\b([A-Za-z]{3,9})[\s.]+(\d{1,2}),?\s+(\d{2,4})\b/);
  if (m && OCR_MONTHS[m[1].toLowerCase()]) {
    return pad2(m[2]) + "/" + pad2(OCR_MONTHS[m[1].toLowerCase()]) + "/" + fullYear(m[3]);
  }
  return null;
}

function pad2(n) {
  return String(parseInt(n, 10)).padStart(2, "0");
}

function fullYear(y) {
  const n = parseInt(y, 10);
  if (String(y).length <= 2) return String(n < 30 ? 2000 + n : 1900 + n);
  return String(n);
}

/* Any date token (numeric, month-name or ISO) plus its position in `text`. */
const ANY_DATE_SOURCE =
  "(\\d{1,2}(?:st|nd|rd|th)?[\\/\\-.\\s]\\d{1,2}[\\/\\-.\\s]\\d{2,4}" +
  "|\\d{4}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{1,2}" +
  "|\\d{1,2}(?:st|nd|rd|th)?[\\s\\-][A-Za-z]{3,9}[\\s\\-,]+\\d{2,4}" +
  "|[A-Za-z]{3,9}[\\s.]+\\d{1,2},?\\s+\\d{2,4})";

/* First date that follows any of the given label words. Returns the raw match
   and its index so the issue date can avoid re-using the DOB. */
function findLabeledDate(text, labels) {
  const re = new RegExp(
    "(?:" + labels.join("|") + ")\\s*[:\\-]?\\s*" + ANY_DATE_SOURCE,
    "i"
  );
  const m = text.match(re);
  if (!m) return null;
  return { raw: m[1], index: m.index };
}

function extractStructuredFields(rawText, docType) {
  const text = normalizeOcrText(rawText);

  // --- Name: labelled first, then a fallback for an all-caps name line. ---
  // Words that are never a person's name (watermarks, headers, table labels).
  const NAME_STOP = /(BOARD|CERTIFICATE|MARKSHEET|MARK SHEET|GOVERNMENT|EXAMINATION|SECONDARY|SENIOR|HIGHER|UNIVERSITY|COUNCIL|EDUCATION|SCHOOL|COLLEGE|RESULT|STATEMENT|INCOME|CASTE|TRIBE|SCHEDULED|DIVISION|PASS|INDIA|STATE|DEPARTMENT|OFFICE|OFFICIAL|DOCUMENT|SAMPLE|DEMO|SPECIMEN|SUBJECT|MARKS|GRADE|TOTAL|CLASS|ROLL|SESSION|FATHER|MOTHER|GUARDIAN)/i;

  let name = null;
  const nameMatch = text.match(
    /(?:(?:Student|Candidate|Applicant|Holder|Pupil)['’s]*\s*)?Name(?:\s*of\s*(?:the\s*)?(?:Student|Candidate|Applicant|Holder))?\s*[:\-]?\s*([A-Z][A-Za-z.\s]{2,40}?)(?=\s{2,}|\s+(?:S\/o|D\/o|W\/o|Son|Daughter|Father|Mother|DOB|D\.O\.B|Date|Born|Roll|Caste|Reg|Class|Subject|Marks|Grade|Total|Session|$))/i
  );
  if (nameMatch && !NAME_STOP.test(nameMatch[1])) {
    name = nameMatch[1];
  }
  if (!name) {
    // Fallback: scan all-caps word groups (typical printed names) and take the
    // first that is not a header/watermark/table label.
    const re = /\b([A-Z][A-Z]+(?:\s+[A-Z][A-Z.]+){1,3})\b/g;
    let mm;
    while ((mm = re.exec(text)) !== null) {
      if (!NAME_STOP.test(mm[1])) { name = mm[1]; break; }
    }
  }

  // --- Date of birth — many label spellings and date styles. ---
  const dobHit = findLabeledDate(text, [
    "D\\.?\\s*O\\.?\\s*B\\.?", "Date\\s*of\\s*Birth", "Birth\\s*Date", "Born\\s*on", "Born"
  ]);
  const dob = dobHit ? normalizeDate(dobHit.raw) : null;

  // --- Issue date — its own labels; never reuse the DOB token. ---
  const issueHit = findLabeledDate(text, [
    "Issue\\s*Date", "Date\\s*of\\s*Issue", "Issued\\s*on", "Issued", "Dated", "Date"
  ]);
  let issueDate = null;
  if (issueHit && (!dobHit || issueHit.index !== dobHit.index)) {
    issueDate = normalizeDate(issueHit.raw);
  }
  if (!issueDate) {
    const re = new RegExp(ANY_DATE_SOURCE, "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      const d = normalizeDate(m[1]);
      if (d && d !== dob) { issueDate = d; break; }
    }
  }
  // If DOB label was missing but exactly one date exists, treat it as DOB.
  let dobFinal = dob;
  if (!dobFinal) {
    const all = (text.match(new RegExp(ANY_DATE_SOURCE, "gi")) || [])
      .map(normalizeDate).filter(Boolean);
    if (all.length === 1) dobFinal = all[0];
  }

  // --- Certificate / registration / roll number. ---
  const certNoMatch = text.match(
    /(?:Certificate\s*No\.?|Cert\.?\s*No\.?|Registration\s*No\.?|Regn?\.?\s*No\.?|Serial\s*No\.?|Roll\s*(?:No\.?|Number)?|Ref(?:erence)?\s*No\.?|Enrol(?:l?ment)?\s*No\.?)\s*[:\-]?\s*([A-Za-z0-9\/\-]{4,20})/i
  );

  const fields = {
    name: name ? name.trim().replace(/\s{2,}/g, " ") : null,
    dateOfBirth: dobFinal,
    certificateNumber: certNoMatch ? certNoMatch[1] : null,
    issueDate
  };

  if (docType === "marksheet") {
    // Percentage: prefer a value anchored to a label, else any NN.NN% token,
    // else "Percentage 78.5" without a % sign. Reject impossible values.
    let percentage = null;
    const pctLabeled = text.match(
      /(?:Percentage(?:\s*of\s*Marks)?|Overall\s*Percentage|Aggregate|Result|Total)\s*(?:of\s*Marks)?\s*[:\-]?\s*(\d{1,3}(?:\.\d{1,3})?)\s*%?/i
    );
    const pctSign = text.match(/(\d{1,3}(?:\.\d{1,3})?)\s*%/);
    const pctCand = pctLabeled ? pctLabeled[1] : (pctSign ? pctSign[1] : null);
    if (pctCand !== null) {
      const v = parseFloat(pctCand);
      if (v > 0 && v <= 100) percentage = v;
    }

    // CGPA / GPA (e.g. "CGPA : 8.6" or "GPA 9.2/10").
    let cgpa = null;
    const cgpaMatch = text.match(/(?:CGPA|GPA|Grade\s*Point(?:\s*Average)?)\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?)(?:\s*\/\s*10)?/i);
    if (cgpaMatch) {
      const g = parseFloat(cgpaMatch[1]);
      if (g > 0 && g <= 10) cgpa = g;
    }
    // If no percentage but we have a 10-point CGPA, offer the common ×9.5 estimate.
    if (percentage === null && cgpa !== null) {
      percentage = Math.round(cgpa * 9.5 * 100) / 100;
    }

    // Marks obtained X/Y — prefer a label, and reject date-like pairs
    // (e.g. day/month) by requiring the total to look like a marks total.
    let marksObtained = null;
    const marksLabeled = text.match(/(?:Total(?:\s*Marks)?|Marks\s*Obtained|Grand\s*Total|Obtained)\s*[:\-]?\s*(\d{2,4})\s*\/\s*(\d{2,4})/i);
    const marksAny = text.match(/\b(\d{2,4})\s*\/\s*(\d{2,4})\b/);
    const pick = marksLabeled || marksAny;
    if (pick) {
      const got = parseInt(pick[1], 10);
      const outOf = parseInt(pick[2], 10);
      // Plausible marks: out-of is a round-ish total >= obtained, not a year.
      if (outOf >= got && outOf >= 50 && outOf <= 5000 && !(outOf > 1900 && outOf < 2100)) {
        marksObtained = `${got}/${outOf}`;
        if (percentage === null) {
          const p = Math.round((got / outOf) * 10000) / 100;
          if (p > 0 && p <= 100) percentage = p;
        }
      }
    }

    fields.percentage = percentage;
    fields.cgpa = cgpa;
    fields.marksObtained = marksObtained;
  }

  if (docType === "incomeCertificate") {
    const incomeMatch = text.match(
      /(?:Annual\s*(?:Family\s*)?Income|Total\s*Income|Income)\s*(?:is|:|\-|of)?\s*(?:Rs\.?|₹|INR)?\s*([\d,]{4,12})/i
    );
    fields.annualIncome = incomeMatch ? incomeMatch[1].replace(/,/g, "") : null;
  }

  return fields;
}

function renderOcrBox(docType, displayName, fields, previews) {
  const box = document.getElementById(`ocr-${docType}`);
  if (!box) return;

  const rows = Object.entries(fields)
    .filter(([key]) => !["confidence", "quality", "source", "rawText"].includes(key))
    .filter(([key, value]) => !(key === "cgpa" && (value === null || value === undefined)))
    .map(([key, value]) => `
      <div class="ocr-field-row">
        <span>${formatFieldLabel(key)}</span>
        <strong>${value ? escapeHTML(String(value)) : "<em>not detected</em>"}</strong>
      </div>
    `)
    .join("");

  // Raw OCR text: lets the student (and support) see exactly what was read,
  // which is invaluable when a field is missed.
  const raw = (fields.rawText || "").trim();
  const rawPanel = raw ? `
    <details class="ocr-rawtext">
      <summary>Show text read from document</summary>
      <pre>${escapeHTML(raw)}</pre>
    </details>` : "";

  box.innerHTML = `
    <div class="ocr-result-card">
      <div class="ocr-result-header">
        <span>✓ ${escapeHTML(displayName)} — OCR ${fields.confidence}% confidence</span>
      </div>
      ${window.OcrPreprocess ? OcrPreprocess.qualityHtml(fields.quality, previews) : ""}
      ${rows}
      ${rawPanel}
    </div>
  `;
}

function formatFieldLabel(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, c => c.toUpperCase());
}

function crossCheckExtractedNames() {
  const typedName = document.getElementById("fullName")?.value.trim();
  if (!typedName) return null;

  const mismatches = [];
  Object.entries(ocrData).forEach(([docType, fields]) => {
    if (!fields.name) return;
    if (!namesRoughlyMatch(typedName, fields.name)) {
      mismatches.push({ docType, ocrName: fields.name });
    }
  });

  return mismatches;
}

function namesRoughlyMatch(a, b) {
  const norm = s => s.toUpperCase().replace(/[^A-Z]/g, "");
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  return levenshtein(na, nb) <= 2;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0)
  ]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function updateOcrSummary() {
  const summary = document.getElementById("ocrSummary");
  if (!summary) return;

  const docs = Object.keys(ocrData);
  if (!docs.length) {
    summary.innerHTML = "No documents processed yet — upload a document above to run OCR.";
    return;
  }

  const rows = docs.map(docType => {
    const f = ocrData[docType];
    return `
      <tr>
        <td>${escapeHTML(formatFieldLabel(docType))}</td>
        <td>${f.name ? escapeHTML(f.name) : "—"}</td>
        <td>${escapeHTML(f.certificateNumber || f.issueDate || "—")}</td>
        <td>${f.confidence}%</td>
        <td>${
          f.source === "DigiLocker"
            ? "Issuer-verified"
            : f.quality
              ? `<span class="quality-chip ${escapeHTML(f.quality.level)}">${f.quality.score}/100</span>`
              : "—"
        }</td>
      </tr>
    `;
  }).join("");

  const mismatches = crossCheckExtractedNames();
  const mismatchHtml = mismatches && mismatches.length
    ? `
      <div class="ocr-mismatch-warning">
        ⚠ Potential name mismatch: your application name doesn't closely match
        the name read from ${mismatches.map(m => formatFieldLabel(m.docType)).join(", ")}
        (OCR read: "${escapeHTML(mismatches[0].ocrName)}").
        This will be flagged for officer review — please double-check spelling.
      </div>
    `
    : `
      <div class="ocr-match-ok">
        ✓ Names appear consistent across processed documents.
      </div>
    `;

  summary.innerHTML = `
    <table class="ocr-summary-table">
      <thead>
        <tr>
          <th>Document</th>
          <th>Name (OCR)</th>
          <th>Cert No. / Date</th>
          <th>Confidence</th>
          <th>Image Quality</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${mismatchHtml}
  `;
}

/* =========================================================
   4. AI CROSS-VERIFICATION (Form vs OCR)
   ========================================================= */
const CROSS_CHECK_FIELDS = [
  {
    formId: "marks",
    ocrKey: "percentage",
    label: "Marks / Percentage",
    sourceDoc: "marksheet"
  },
  {
    formId: "income",
    ocrKey: "annualIncome",
    label: "Annual Income",
    sourceDoc: "incomeCertificate"
  }
];

function runCrossVerification() {
  const panel = document.getElementById("crossVerificationResult");
  if (!panel) return;

  if (!Object.keys(ocrData).length) {
    panel.innerHTML = "Upload documents and fill the form fields above to run verification.";
    clearFieldCheck("fullName");
    clearFieldCheck("marks");
    clearFieldCheck("income");
    return;
  }

  const rows = [];
  const typedName = document.getElementById("fullName")?.value.trim() || "";
  const nameSources = Object.entries(ocrData).filter(([, f]) => f.name);

  if (typedName && nameSources.length) {
    const allMatch = nameSources.every(([, f]) => namesRoughlyMatch(typedName, f.name));

    setFieldCheck(
      "fullName",
      allMatch,
      allMatch
        ? "Matches the name on your uploaded document(s)."
        : `Doesn't closely match OCR name read from ${
            nameSources
              .filter(([, f]) => !namesRoughlyMatch(typedName, f.name))
              .map(([d]) => formatFieldLabel(d))
              .join(", ")
          }.`
    );

    nameSources.forEach(([docType, f]) => {
      rows.push(
        comparisonRowHtml(
          "Full Name",
          typedName,
          f.name,
          formatFieldLabel(docType),
          namesRoughlyMatch(typedName, f.name)
        )
      );
    });
  } else {
    clearFieldCheck("fullName");
  }

  CROSS_CHECK_FIELDS.forEach(({ formId, ocrKey, label, sourceDoc }) => {
    const input = document.getElementById(formId);
    if (!input) return;

    const typedRaw = input.value;
    const ocrFields = ocrData[sourceDoc];

    if (typedRaw === "" || !ocrFields || ocrFields[ocrKey] == null) {
      clearFieldCheck(formId);
      return;
    }

    const typedNum = parseFloat(typedRaw);
    const ocrNum = parseFloat(ocrFields[ocrKey]);
    const tolerance = formId === "income" ? Math.max(ocrNum * 0.02, 500) : 1;
    const isMatch = Math.abs(typedNum - ocrNum) <= tolerance;

    const typedDisplay = formId === "income"
      ? `₹${typedNum.toLocaleString("en-IN")}`
      : `${typedNum}%`;
    const ocrDisplay = formId === "income"
      ? `₹${ocrNum.toLocaleString("en-IN")}`
      : `${ocrNum}%`;

    setFieldCheck(
      formId,
      isMatch,
      isMatch
        ? `Matches ${label.toLowerCase()} read from ${formatFieldLabel(sourceDoc)}.`
        : `${formatFieldLabel(sourceDoc)} OCR shows ${ocrDisplay}, you entered ${typedDisplay}.`
    );

    rows.push(
      comparisonRowHtml(
        label,
        typedDisplay,
        ocrDisplay,
        formatFieldLabel(sourceDoc),
        isMatch
      )
    );
  });

  if (!rows.length) {
    panel.innerHTML = "No comparable OCR data yet — fill in the fields and upload the matching document(s).";
    return;
  }

  panel.innerHTML = `
    <table class="ocr-summary-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>You Entered</th>
          <th>OCR Read</th>
          <th>Source Document</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;

  // Raise a mentor alert when the cross-check finds a mismatch, so a mentor
  // can guide the student (Mentor page). Guarded so it never breaks OCR flow.
  try {
    if (typeof mentorRaiseDiscrepancy === "function") {
      const mismatch = crossCheckExtractedNames();
      if (mismatch && mismatch.length) {
        const appId = document.getElementById("fullName")?.value?.trim() || "current application";
        mentorRaiseDiscrepancy(
          appId,
          `Name mismatch: form vs document (OCR read "${mismatch[0].ocrName}"). Student may need help correcting the name or re-uploading.`
        );
      }
    }
  } catch (e) {
    console.warn("Mentor discrepancy hook skipped:", e);
  }
}

function comparisonRowHtml(label, typedVal, ocrVal, source, isMatch) {
  return `
    <tr>
      <td>${escapeHTML(label)}</td>
      <td>${escapeHTML(String(typedVal))}</td>
      <td>${escapeHTML(String(ocrVal))}</td>
      <td>${escapeHTML(source)}</td>
      <td>
        <span class="match-badge ${isMatch ? "match" : "mismatch"}">
          ${isMatch ? "✓ Match" : "✗ Mismatch"}
        </span>
      </td>
    </tr>
  `;
}

function setFieldCheck(fieldId, isMatch, message) {
  const input = document.getElementById(fieldId);
  const note = document.getElementById(`check-${fieldId}`);

  if (input) {
    input.classList.remove("field-match", "field-mismatch");
    input.classList.add(isMatch ? "field-match" : "field-mismatch");
  }
  if (note) {
    note.textContent = (isMatch ? "✓ " : "✗ ") + message;
    note.className = `field-check-note ${isMatch ? "match" : "mismatch"}`;
  }
}

function clearFieldCheck(fieldId) {
  const input = document.getElementById(fieldId);
  const note = document.getElementById(`check-${fieldId}`);

  if (input) input.classList.remove("field-match", "field-mismatch");
  if (note) {
    note.textContent = "";
    note.className = "field-check-note";
  }
}

/* =========================================================
   5. AI ELIGIBILITY ENGINE
   ========================================================= */
const ELIGIBILITY_RULES = {
  NFST: {
    name: "National Fellowship for ST Students",
    criteria: [
      { key: "stCertificate", label: "ST status document", type: "document", required: true },
      { key: "education", label: "Education / research level", type: "education", allowed: ["PhD"] },
      { key: "marks", label: "Academic percentage", type: "number", min: 55, unit: "%" },
      { key: "income", label: "Annual family income", type: "number", max: 800000, unit: "₹" }
    ]
  },
  NOS: {
    name: "National Overseas Scholarship",
    criteria: [
      { key: "stCertificate", label: "ST status document", type: "document", required: true },
      { key: "education", label: "Higher-study level", type: "education", allowed: ["Masters", "PhD"] },
      { key: "marks", label: "Academic percentage", type: "number", min: 60, unit: "%" },
      { key: "income", label: "Annual family income", type: "number", max: 800000, unit: "₹" },
      { key: "offerLetter", label: "University offer letter", type: "document", required: true }
    ]
  }
};

function getValue(id) {
  const element = document.getElementById(id);
  return element ? element.value.trim() : "";
}

function getNumber(id) {
  const value = getValue(id);
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getDocumentStatus(documentKey) {
  const fromDigiLocker = window.digiLockerDocs?.[documentKey];
  if (fromDigiLocker) return { uploaded: true, name: fromDigiLocker.name };

  const input = document.getElementById(documentKey);
  if (!input) return { uploaded: false, name: "" };
  const uploaded = input.files && input.files.length > 0;
  return { uploaded, name: uploaded ? input.files[0].name : "" };
}

function evaluateEligibilityCriterion(criterion) {
  const key = criterion.key;

  if (criterion.type === "document") {
    const doc = getDocumentStatus(key);
    if (doc.uploaded) return { status: "pass", message: `${criterion.label} uploaded` };
    if (criterion.required) return { status: "fail", message: `${criterion.label} is required` };
    return { status: "review", message: `${criterion.label} not provided` };
  }

  if (criterion.type === "education") {
    const education = getValue("education");
    if (!education) return { status: "review", message: "Education level not selected" };
    if (criterion.allowed.includes(education)) {
      return { status: "pass", message: `${education} is accepted` };
    }
    return { status: "fail", message: `${education} does not meet the configured education rule` };
  }

  if (criterion.type === "number") {
    let value = null;
    if (key === "marks") value = getNumber("marks");
    if (key === "income") value = getNumber("income");

    if (value === null) return { status: "review", message: `${criterion.label} not provided` };
    if (criterion.min !== undefined && value < criterion.min) {
      return {
        status: "fail",
        message: `${value}${criterion.unit || ""} is below the minimum ${criterion.min}${criterion.unit || ""}`
      };
    }
    if (criterion.max !== undefined && value > criterion.max) {
      return {
        status: "fail",
        message: `${value}${criterion.unit || ""} is above the maximum ${criterion.max}${criterion.unit || ""}`
      };
    }
    return { status: "pass", message: `${value}${criterion.unit || ""} satisfies the configured rule` };
  }

  return { status: "review", message: "Manual review required" };
}

function getEligibilitySnapshot() {
  const scheme = getValue("scheme");
  if (!scheme || !ELIGIBILITY_RULES[scheme]) {
    return { scheme: "", schemeName: "", criteria: [], status: "review", score: 0 };
  }

  const ruleSet = ELIGIBILITY_RULES[scheme];
  const criteria = ruleSet.criteria.map(criterion => ({
    ...criterion,
    ...evaluateEligibilityCriterion(criterion)
  }));

  const passed = criteria.filter(item => item.status === "pass").length;
  const failed = criteria.filter(item => item.status === "fail").length;
  const review = criteria.filter(item => item.status === "review").length;

  let status = "pass";
  if (failed > 0) status = "fail";
  else if (review > 0) status = "review";

  const score = criteria.length ? Math.round((passed / criteria.length) * 100) : 0;

  return {
    scheme,
    schemeName: ruleSet.name,
    criteria,
    passed,
    failed,
    review,
    status,
    score,
    checkedAt: new Date().toLocaleString()
  };
}

function runEligibilityPreCheck() {
  const resultBox = document.getElementById("eligibilityResult");
  const snapshot = getEligibilitySnapshot();

  if (!resultBox) return snapshot;

  if (!snapshot.scheme) {
    resultBox.innerHTML = `
      <div class="eligibility-banner review">
        <strong>Eligibility check pending</strong>
        <span>Select a scholarship scheme to start the AI pre-check.</span>
      </div>
    `;
    return snapshot;
  }

  let bannerTitle = "Eligible — configured rules passed";
  let bannerText = "The entered information currently satisfies the configured prototype criteria.";

  if (snapshot.status === "fail") {
    bannerTitle = "Eligibility issues detected";
    bannerText = "One or more configured eligibility criteria are not satisfied.";
  } else if (snapshot.status === "review") {
    bannerTitle = "Manual review required";
    bannerText = "Some eligibility information is missing or requires document review.";
  }

  const criteriaHTML = snapshot.criteria
    .map(item => {
      let icon = "✓";
      if (item.status === "fail") icon = "✕";
      if (item.status === "review") icon = "!";

      return `
        <div class="eligibility-item ${item.status}">
          <div class="eligibility-item-icon">${icon}</div>
          <div>
            <strong>${escapeHTML(item.label)}</strong>
            <span>${escapeHTML(item.message)}</span>
          </div>
        </div>
      `;
    })
    .join("");

  resultBox.innerHTML = `
    <div class="eligibility-head">
      <div>
        <strong>${bannerTitle}</strong>
        <span>${bannerText}</span>
      </div>
      <div class="eligibility-score">${snapshot.score}%</div>
    </div>
    <div class="eligibility-grid">${criteriaHTML}</div>
    <div class="eligibility-disclaimer">
      AI pre-check only: passing these configured rules does not establish
      official eligibility, document authenticity, or final approval.
      Officer review remains required.
    </div>
  `;

  return snapshot;
}

function getEligibilityIssues(snapshot) {
  if (!snapshot || !snapshot.criteria) return [];
  return snapshot.criteria
    .filter(item => item.status === "fail")
    .map(item => `Eligibility: ${item.label} — ${item.message}`);
}

/* =========================================================
   6. EXPIRED CERTIFICATE DETECTION & SMART DEFICIENCY ALERT
   ========================================================= */
const CERTIFICATE_VALIDITY_DAYS = {
  incomeCertificate: 365,
  stCertificate: 365 * 5
};

function parseFlexibleDate(str) {
  if (!str) return null;
  const parts = str.split(/[\/\-.]/).map(p => p.trim());
  if (parts.length !== 3) return null;

  let [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  if (y < 100) y += y < 50 ? 2000 : 1900;

  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}

function checkExpiredCertificates() {
  const expiryIssues = [];

  Object.entries(CERTIFICATE_VALIDITY_DAYS).forEach(([docType, maxDays]) => {
    const fields = ocrData[docType];
    if (!fields || !fields.issueDate) return;

    const issueDate = parseFlexibleDate(fields.issueDate);
    if (!issueDate) return;

    const ageDays = Math.floor((Date.now() - issueDate.getTime()) / 86400000);
    if (ageDays > maxDays) {
      expiryIssues.push({
        docType,
        label: formatFieldLabel(docType),
        issueDate: fields.issueDate,
        ageDays
      });
    }
  });

  return expiryIssues;
}

function generateSmartDeficiencyAlert(application, issues) {
  const emailBody = buildDeficiencyMessage(application, issues, "email");
  const smsBody = buildDeficiencyMessage(application, issues, "sms");

  const alertObj = {
    sentAt: new Date().toLocaleString(),
    email: emailBody,
    sms: smsBody,
    applicantEmail: application.email,
    applicantPhone: application.phone
  };

  const appKey = application.application_id || application.id;
  saveAlertToCache(appKey, alertObj);

  showDeficiencyAlertModal(application, emailBody, smsBody);
}

function buildDeficiencyMessage(application, issues, channel) {
  const appId = application.application_id || application.id;
  if (channel === "sms") {
    const extra = issues.length > 1
      ? ` (+${issues.length - 1} more issue${issues.length > 2 ? "s" : ""})`
      : "";
    return `TribalScholar: Your application ${appId} needs action — ${issues[0]}${extra} Please log in and correct this within 3 days.`;
  }

  const issueLines = issues.map(issue => `  • ${issue}`).join("\n");
  return `Dear ${application.name || "Applicant"},

Our AI Assistant reviewed your scholarship application (ID: ${appId}, Scheme: ${application.scheme}) and found the following issue(s) that need your attention:

${issueLines}

Please log in to TribalScholar and correct these as soon as possible so your application can move forward to officer review.

— TribalScholar Automated Notification (Demo — no real email is sent)`;
}

function showDeficiencyAlertModal(application, emailBody, smsBody) {
  const content = document.getElementById("deficiencyAlertContent");
  const modal = document.getElementById("deficiencyAlertModal");
  if (!content || !modal) return;

  content.innerHTML = `
    <div class="deficiency-alert-block">
      <strong>📧 Email → ${escapeHTML(application.email || "no email on file")}</strong>
      <pre class="deficiency-alert-text">${escapeHTML(emailBody)}</pre>
    </div>
    <div class="deficiency-alert-block">
      <strong>📱 SMS → ${escapeHTML(application.phone || "no phone on file")}</strong>
      <pre class="deficiency-alert-text">${escapeHTML(smsBody)}</pre>
    </div>
    <p class="muted small">Demo only: no real email or SMS is sent from the browser.</p>
  `;

  modal.classList.remove("hidden");
}

function closeDeficiencyAlertModal() {
  document.getElementById("deficiencyAlertModal")?.classList.add("hidden");
}

/* Match a row by its TS… application_id or its uuid id. Comparing a TS… value
   against the uuid column makes Postgres reject the whole query. */
function applicationIdFilter(appId) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(appId));
  return isUuid ? `application_id.eq.${appId},id.eq.${appId}` : `application_id.eq.${appId}`;
}

async function viewDeficiencyAlert(appId) {
  const cache = getAlertCache();
  if (cache[appId]) {
    showDeficiencyAlertModal(
      { email: cache[appId].applicantEmail, phone: cache[appId].applicantPhone },
      cache[appId].email,
      cache[appId].sms
    );
    return;
  }

  // Check local fallback applications first
  const localMatch = getLocalApplications().find(
    a => a.application_id === appId || a.id === appId
  );
  if (localMatch && Array.isArray(localMatch.issues) && localMatch.issues.length) {
    generateSmartDeficiencyAlert(localMatch, localMatch.issues);
    return;
  }

  // Fallback: build alert dynamically from Supabase application row
  try {
    const { data: app } = await supabaseClient
      .from("applications")
      .select("*")
      .or(applicationIdFilter(appId))
      .maybeSingle();

    if (app && Array.isArray(app.issues) && app.issues.length) {
      generateSmartDeficiencyAlert(app, app.issues);
    }
  } catch (e) {
    console.error("Could not load deficiency alert:", e);
  }
}

/* =========================================================
   7. IDENTITY VERIFICATION (Aadhaar Secure QR + DigiLocker)
   ========================================================= */
let identityVerified = false;

function setIdentityStatus(message, type) {
  const box = document.getElementById("identityStatus");
  if (!box) return;
  box.textContent = message;
  box.className = `identity-status ${type}`;
  box.classList.remove("hidden");
}

// Aadhaar Secure QR scan → UIDAI signature check lives in js/aadhaar-qr.js
function openAadhaarModal() {
  window.AadhaarQr?.open();
}

// DigiLocker consent → sign-in → document picker lives in js/gov-integrations.js
function startDigiLockerVerification() {
  window.GovIntegrations?.DigiLocker.start();
}

function applyVerifiedIdentity(identity) {
  identityVerified = true;
  const nameField = document.getElementById("fullName");
  if (!nameField) return;

  nameField.value = identity.name;
  nameField.readOnly = true;
  nameField.classList.add("verified-field");

  runCrossVerification();
  runEligibilityPreCheck();
}

/* =========================================================
   8. SUPABASE AUTHENTICATION & AUTO RATE-LIMIT BYPASS
   ========================================================= */
function createAuthPanel() {
  if (document.getElementById("authPanel")) return;

  const panel = document.createElement("div");
  panel.id = "authPanel";
  panel.className = "auth-panel";

  panel.innerHTML = `
    <div class="auth-panel-inner">
      <button type="button" id="closeAuthPanel" class="auth-close">×</button>
      <div class="auth-brand">
        <span class="eyebrow">TRIBALSCHOLAR ACCESS</span>
        <h2 id="authTitle">Student Login</h2>
        <p id="authSubtitle">Sign in to access your scholarship dashboard.</p>
      </div>
      <form id="authForm">
        <div id="fullNameGroup" class="form-group hidden">
          <label for="authFullName">Full Name</label>
          <input type="text" id="authFullName" placeholder="Enter your full name">
        </div>
        <div class="form-group">
          <label for="authEmail">College Email</label>
          <input type="email" id="authEmail" placeholder="Enter your college email" required>
        </div>
        <div class="form-group">
          <label for="authPassword">Password</label>
          <input type="password" id="authPassword" placeholder="Enter your password" minlength="6" required>
        </div>
        <button type="submit" id="authSubmit" class="primary-btn">Login</button>
        <div id="authMessage" class="form-message"></div>
      </form>

      <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(0,0,0,0.08); text-align: center;">
        <small style="display:block; margin-bottom: 8px; color: #666; font-size: 12px;">
          ⚡ Quick SIH Prototype Access (No Email Needed)
        </small>
        <div style="display: flex; gap: 8px; justify-content: center;">
          <button type="button" id="quickStudentBtn" class="secondary-btn" style="font-size: 12px; padding: 6px 10px;">
            🎓 Demo Student
          </button>
          <button type="button" id="quickOfficerBtn" class="secondary-btn" style="font-size: 12px; padding: 6px 10px;">
            🛡️ Demo Officer
          </button>
        </div>
      </div>

      <button type="button" id="authSwitchButton" class="text-btn auth-switch">
        Create a Student Account
      </button>
    </div>
  `;

  document.body.appendChild(panel);

  document.getElementById("closeAuthPanel")?.addEventListener("click", closeAuthPanel);
  document.getElementById("authForm")?.addEventListener("submit", handleAuthSubmit);
  document.getElementById("authSwitchButton")?.addEventListener("click", toggleAuthMode);

  document.getElementById("quickStudentBtn")?.addEventListener("click", () => {
    activateInstantFallbackLogin("student.demo@tribalscholar.in", "Aarav Gond (Demo)", "student");
  });
  document.getElementById("quickOfficerBtn")?.addEventListener("click", () => {
    activateInstantFallbackLogin("officer.demo@tribalscholar.in", "Nodal Officer (Demo)", "officer");
  });
}

function openAuthPanel(mode = "login") {
  createAuthPanel();
  authMode = mode;
  updateAuthPanel();
  document.getElementById("authPanel")?.classList.add("show");
}

function closeAuthPanel() {
  document.getElementById("authPanel")?.classList.remove("show");
}

function toggleAuthMode() {
  authMode = authMode === "login" ? "signup" : "login";
  updateAuthPanel();
}

function updateAuthPanel() {
  const title = document.getElementById("authTitle");
  const subtitle = document.getElementById("authSubtitle");
  const fullNameGroup = document.getElementById("fullNameGroup");
  const submit = document.getElementById("authSubmit");
  const switchButton = document.getElementById("authSwitchButton");
  const message = document.getElementById("authMessage");

  if (!title || !subtitle || !fullNameGroup || !submit || !switchButton) return;

  if (authMode === "signup") {
    title.textContent = "Create Student Account";
    subtitle.textContent = "Create your account to apply for scholarships.";
    fullNameGroup.classList.remove("hidden");
    submit.textContent = "Create Account";
    switchButton.textContent = "Already have an account? Login";
  } else {
    title.textContent = "Student Login";
    subtitle.textContent = "Sign in to access your scholarship dashboard.";
    fullNameGroup.classList.add("hidden");
    submit.textContent = "Login";
    switchButton.textContent = "Create a Student Account";
  }

  if (message) {
    message.textContent = "";
    message.className = "form-message";
  }
}

async function activateInstantFallbackLogin(email, fullName, forcedRole = null) {
  const inferredRole =
    forcedRole ||
    (email.toLowerCase().includes("officer") || email.toLowerCase().includes("admin")
      ? "officer"
      : "student");

  const derivedName =
    fullName ||
    email
      .split("@")[0]
      .replace(/[._-]/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase());

  const fallbackUser = {
    id: "demo-user-" + btoa(email).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12),
    email: email,
    is_fallback: true
  };

  const fallbackProfile = {
    id: fallbackUser.id,
    full_name: derivedName,
    role: inferredRole
  };

  setFallbackSession(fallbackUser, fallbackProfile);
  await loadCurrentUser();
  closeAuthPanel();
  await showPage("home");
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const fullName = document.getElementById("authFullName")?.value.trim();
  const email = document.getElementById("authEmail")?.value.trim();
  const password = document.getElementById("authPassword")?.value;
  const message = document.getElementById("authMessage");
  const submit = document.getElementById("authSubmit");

  if (message) {
    message.textContent = "";
    message.className = "form-message";
  }

  if (authMode === "signup" && !fullName) {
    message.textContent = "Please enter your full name.";
    message.classList.add("error");
    return;
  }

  if (!email || !password) {
    message.textContent = "Please enter email and password.";
    message.classList.add("error");
    return;
  }

  submit.disabled = true;
  submit.textContent = authMode === "signup" ? "Creating Account..." : "Signing In...";

  try {
    if (authMode === "signup") {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } }
      });

      if (error) {
        const errMsg = (error.message || "").toLowerCase();
        // If user already exists, try signing them in directly
        if (errMsg.includes("already registered") || errMsg.includes("already exists")) {
          const signInRes = await supabaseClient.auth.signInWithPassword({ email, password });
          if (!signInRes.error && signInRes.data?.session) {
            clearFallbackSession();
            await loadCurrentUser();
            closeAuthPanel();
            await showPage("home");
            return;
          }
        }
        // If rate limit exceeded or any email error, seamlessly bypass for SIH demo
        if (
          errMsg.includes("rate limit") ||
          errMsg.includes("exceeded") ||
          errMsg.includes("email") ||
          error.status === 429
        ) {
          console.warn("Supabase email rate limit reached — activating instant prototype session.");
          await activateInstantFallbackLogin(email, fullName);
          return;
        }
        throw error;
      }

      if (data?.session) {
        clearFallbackSession();
        await loadCurrentUser();
        closeAuthPanel();
        await showPage("home");
      } else {
        // Supabase created user but didn't return session because "Confirm email" is ON
        // Try signing in directly, or activate instant session so user isn't stuck
        const signInAttempt = await supabaseClient.auth.signInWithPassword({ email, password });
        if (!signInAttempt.error && signInAttempt.data?.session) {
          clearFallbackSession();
          await loadCurrentUser();
          closeAuthPanel();
          await showPage("home");
        } else {
          await activateInstantFallbackLogin(email, fullName);
        }
      }
      return;
    }

    // LOGIN MODE
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      const errMsg = (error.message || "").toLowerCase();
      // Bypass "Email not confirmed" or "rate limit exceeded" during login
      if (
        errMsg.includes("email not confirmed") ||
        errMsg.includes("rate limit") ||
        errMsg.includes("exceeded") ||
        error.status === 429
      ) {
        console.warn("Bypassing unconfirmed email / rate limit for prototype login.");
        await activateInstantFallbackLogin(email, fullName);
        return;
      }
      throw error;
    }

    if (!data?.session) {
      await activateInstantFallbackLogin(email, fullName);
      return;
    }

    clearFallbackSession();
    await loadCurrentUser();
    closeAuthPanel();
    await showPage("home");
  } catch (error) {
    message.textContent = error?.message || "Authentication failed.";
    message.classList.add("error");
  } finally {
    submit.disabled = false;
    submit.textContent = authMode === "signup" ? "Create Account" : "Login";
  }
}

async function loadCurrentUser() {
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (!error && data?.session) {
      currentUser = data.session.user;

      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", currentUser.id)
        .maybeSingle();

      currentProfile = profile || {
        id: currentUser.id,
        full_name: currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0],
        role: currentUser.email?.toLowerCase().includes("officer") ? "officer" : "student"
      };

      updateAuthNavigation();
      updateApplicationEmail();
      await updateHomeStats();
      return;
    }

    // Check if fallback session is active (from rate-limit bypass or Quick Demo login)
    const fallback = getFallbackSession();
    if (fallback?.user) {
      currentUser = fallback.user;
      currentProfile = fallback.profile;
      updateAuthNavigation();
      updateApplicationEmail();
      await updateHomeStats();
      return;
    }

    currentUser = null;
    currentProfile = null;
    updateAuthNavigation();
  } catch (error) {
    console.error("Session error:", error);
    const fallback = getFallbackSession();
    if (fallback?.user) {
      currentUser = fallback.user;
      currentProfile = fallback.profile;
    } else {
      currentUser = null;
      currentProfile = null;
    }
    updateAuthNavigation();
  }
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session?.user) {
    currentUser = session.user;
  }
  setTimeout(async () => {
    await loadCurrentUser();
  }, 0);
});

function updateAuthNavigation() {
  const container = document.getElementById("authNavigation");
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = `
      <button type="button" class="secondary-btn auth-nav-btn" id="loginButton">
        Login
      </button>
    `;
    document.getElementById("loginButton")?.addEventListener("click", () => openAuthPanel("login"));
    return;
  }

  const name = currentProfile?.full_name || currentUser.email || "User";
  const role = currentProfile?.role || "student";

  container.innerHTML = `
    <div class="user-menu">
      <span class="user-name">${escapeHTML(name)}</span>
      <span class="user-role">${escapeHTML(role)}</span>
      <button type="button" class="secondary-btn" id="logoutButton">Sign Out</button>
    </div>
  `;

  document.getElementById("logoutButton")?.addEventListener("click", signOut);
}

async function signOut() {
  clearFallbackSession();
  try {
    await supabaseClient.auth.signOut();
  } catch {}
  currentUser = null;
  currentProfile = null;
  updateAuthNavigation();
  await showPage("home");
}

async function requireLogin() {
  if (currentUser) return true;
  await loadCurrentUser();
  if (currentUser) return true;

  openAuthPanel("login");
  return false;
}

async function requireOfficer() {
  const loggedIn = await requireLogin();
  if (!loggedIn) return false;

  if (!currentProfile || currentProfile.role !== "officer") {
    const switchConfirm = confirm(
      "Officer access is required to open the Officer Portal.\n\nWould you like to switch to the Demo Officer account right now?"
    );
    if (switchConfirm) {
      await activateInstantFallbackLogin(
        "officer.demo@tribalscholar.in",
        "Nodal Officer (Demo)",
        "officer"
      );
      return true;
    }
    await showPage("home");
    return false;
  }
  return true;
}

function updateApplicationEmail() {
  const emailInput = document.getElementById("email");
  if (emailInput && currentUser?.email) {
    emailInput.value = currentUser.email;
    emailInput.readOnly = true;
  }
  const nameInput = document.getElementById("fullName");
  if (nameInput && !nameInput.value && currentProfile?.full_name) {
    nameInput.value = currentProfile.full_name;
  }
}

/* =========================================================
   9. PRE-CHECK, READINESS & APPLICATION SUBMISSION
   ========================================================= */
function getSelectedFile(elementId) {
  const input = document.getElementById(elementId);
  return input?.files?.[0] || null;
}

function runPreCheck(data) {
  const issues = [];

  if (!data.name.trim()) issues.push("Student name is missing.");
  if (!data.email.trim()) issues.push("Email is missing.");
  if (!data.phone.trim()) issues.push("Mobile number is missing.");
  if (!data.stCertificate) issues.push("ST certificate is missing.");
  if (!data.marksheet) issues.push("Academic record is missing.");
  if (!data.incomeCertificate) issues.push("Income certificate is missing.");
  if (data.scheme === "NOS" && !data.offerLetter) {
    issues.push("Offer letter is missing for this demo workflow.");
  }
  if (data.income < 0 || !Number.isFinite(data.income)) {
    issues.push("Income value is invalid.");
  }
  if (data.marks < 0 || data.marks > 100 || !Number.isFinite(data.marks)) {
    issues.push("Marks must be between 0 and 100.");
  }
  if (data.nameMismatchFlagged) {
    issues.push("OCR detected a possible name mismatch between your application and an uploaded document.");
  }

  return issues;
}

function checkApplicationReadiness() {
  const checks = [
    { id: "fullName", label: "Full Name" },
    { id: "email", label: "Email Address" },
    { id: "phone", label: "Mobile Number" },
    { id: "scheme", label: "Scholarship Scheme" },
    { id: "education", label: "Education Level" },
    { id: "income", label: "Annual Family Income" },
    { id: "marks", label: "Percentage / Marks" },
    { id: "institution", label: "Institution / University" },
    { id: "stCertificate", label: "ST Certificate" },
    { id: "marksheet", label: "Marksheets / Academic Record" },
    { id: "incomeCertificate", label: "Income Certificate" }
  ];

  if (document.getElementById("scheme")?.value === "NOS") {
    checks.push({ id: "offerLetter", label: "University Offer Letter" });
  }

  const missing = [];

  checks.forEach(item => {
    const field = document.getElementById(item.id);
    if (!field) {
      missing.push(item.label);
      return;
    }
    if (field.type === "file") {
      if (!getDocumentStatus(item.id).uploaded) missing.push(item.label);
    } else if (!field.value.trim()) {
      missing.push(item.label);
    }
  });

  const expiryIssues = checkExpiredCertificates();
  const qualityIssues = Object.entries(ocrData)
    .filter(([, f]) => f.quality?.isBlurry)
    .map(([docType, f]) => `${formatFieldLabel(docType)} photo is blurry (quality ${f.quality.score}/100) — retake it so the officer can read it.`);
  const result = document.getElementById("readinessResult");
  if (!result) return;

  if (missing.length === 0 && expiryIssues.length === 0 && qualityIssues.length === 0) {
    result.innerHTML = `
      <div class="readiness-success">
        <h3>✓ Application looks complete!</h3>
        <p>
          All required fields and documents appear to be present.
          Please review your information before submitting.
        </p>
      </div>
    `;
  } else {
    const missingItems = missing.map(item => `<li>${escapeHTML(item)}</li>`).join("");
    const expiryItems = expiryIssues
      .map(
        item =>
          `<li>${escapeHTML(item.label)} looks dated ${escapeHTML(item.issueDate)} (${item.ageDays} days ago) and may be expired.</li>`
      )
      .join("");
    const qualityItems = qualityIssues.map(item => `<li>${escapeHTML(item)}</li>`).join("");

    result.innerHTML = `
      <div class="readiness-warning">
        <h3>Some information is missing or needs attention</h3>
        <p>Please complete the following:</p>
        <ul>
          ${missingItems}
          ${expiryItems}
          ${qualityItems}
        </ul>
      </div>
    `;
  }

  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showFormMessage(message, type) {
  const box = document.getElementById("formMessage");
  if (!box) return;
  box.textContent = message;
  box.className = `message ${type}`;
  box.classList.remove("hidden");
}

function createLocalFallbackApplication(data, issues) {
  const localApps = getLocalApplications();
  const nextNum = 260001 + localApps.length + Math.floor(Math.random() * 90);
  const generatedId = `TS${nextNum}`;
  const nowIso = new Date().toISOString();

  const appObj = {
    id: generatedId,
    application_id: generatedId,
    user_id: currentUser?.id || "demo-user",
    name: data.name,
    email: data.email,
    phone: data.phone,
    scheme: data.scheme,
    education: data.education,
    income: data.income,
    marks: data.marks,
    institution: data.institution,
    status: issues.length ? "Deficient" : "Submitted",
    pre_check: issues.length === 0,
    issues: issues,
    review_note: null,
    submitted_at: nowIso,
    updated_at: nowIso
  };

  localApps.unshift(appObj);
  saveLocalApplications(localApps);
  return appObj;
}

async function submitApplication(event) {
  event.preventDefault();

  const loggedIn = await requireLogin();
  if (!loggedIn) return;

  const submitButton = document.querySelector("#applicationForm button[type='submit']");
  const scheme = document.getElementById("scheme").value;

  const data = {
    name: document.getElementById("fullName").value.trim(),
    email: currentUser.email || document.getElementById("email").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    scheme,
    education: document.getElementById("education").value,
    income: Number(document.getElementById("income").value),
    marks: Number(document.getElementById("marks").value),
    institution: document.getElementById("institution").value.trim(),
    stCertificate: getDocumentStatus("stCertificate").name,
    marksheet: getDocumentStatus("marksheet").name,
    incomeCertificate: getDocumentStatus("incomeCertificate").name,
    offerLetter: document.getElementById("offerLetter").files[0]?.name || "",
    nameMismatchFlagged: (crossCheckExtractedNames() || []).length > 0
  };

  // Run all 3 AI checks: Basic + Eligibility Engine + Expiry Check
  const issues = runPreCheck(data);
  const eligibilitySnapshot = runEligibilityPreCheck();
  const eligibilityIssues = getEligibilityIssues(eligibilitySnapshot);
  issues.push(...eligibilityIssues);

  const expiryIssues = checkExpiredCertificates();
  expiryIssues.forEach(item => {
    issues.push(
      `${item.label} appears to be dated ${item.issueDate} (${item.ageDays} days ago) and may be expired — please upload a recent copy.`
    );
  });

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";
  }

  try {
    let application = null;

    // If logged in with real Supabase session, try saving to Supabase first
    if (!currentUser.is_fallback) {
      try {
        const { data: supaApp, error: applicationError } = await supabaseClient
          .from("applications")
          .insert({
            user_id: currentUser.id,
            name: data.name,
            email: data.email,
            phone: data.phone,
            scheme: data.scheme,
            education: data.education,
            income: data.income,
            marks: data.marks,
            institution: data.institution,
            status: issues.length ? "Deficient" : "Submitted",
            pre_check: issues.length === 0,
            issues: issues,
            review_note: null
          })
          .select()
          .single();

        if (applicationError) throw applicationError;
        application = supaApp;

        const documents = [
          { elementId: "stCertificate", type: "ST Certificate" },
          { elementId: "marksheet", type: "Marksheet" },
          { elementId: "incomeCertificate", type: "Income Certificate" }
        ];

        if (scheme === "NOS") {
          documents.push({ elementId: "offerLetter", type: "Offer Letter" });
        }

        // Insert a document row with OCR quality metadata; falls back to the
        // original columns if the features migration hasn't been applied yet.
        const insertDocumentRow = async (row, extra) => {
          const { error } = await supabaseClient
            .from("application_documents")
            .insert({ ...row, ...extra });
          if (error) {
            await supabaseClient.from("application_documents").insert(row);
          }
        };

        for (const doc of documents) {
          const ocr = ocrData[doc.elementId];
          const digiDoc = window.digiLockerDocs?.[doc.elementId];

          if (digiDoc) {
            await insertDocumentRow(
              {
                application_id: application.id,
                document_type: doc.type,
                original_filename: digiDoc.name,
                storage_path: `digilocker://${digiDoc.uri}`
              },
              { source: "digilocker", issuer: digiDoc.issuer, ocr_confidence: 100 }
            );
            continue;
          }

          const file = getSelectedFile(doc.elementId);
          if (!file) continue;

          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const storagePath = `${currentUser.id}/${application.id}/${doc.type.replace(/\s+/g, "-")}-${Date.now()}-${safeName}`;

          const { error: uploadError } = await supabaseClient.storage
            .from("application-documents")
            .upload(storagePath, file, { upsert: false });

          if (!uploadError) {
            await insertDocumentRow(
              {
                application_id: application.id,
                document_type: doc.type,
                original_filename: file.name,
                storage_path: storagePath
              },
              {
                source: "upload",
                ocr_confidence: ocr?.confidence ?? null,
                image_quality: ocr?.quality || null
              }
            );
          }
        }
      } catch (supaErr) {
        console.warn("Supabase insert/storage fallback triggered:", supaErr);
        application = createLocalFallbackApplication(data, issues);
      }
    } else {
      // Using rate-limit safe fallback session
      application = createLocalFallbackApplication(data, issues);
    }

    const appDisplayId = application.application_id || application.id;
    const preCheckLabel = issues.length ? "Issues detected" : "Basic checks passed";

    showFormMessage(
      `Application saved! Your Application ID is ${appDisplayId}. Pre-check: ${preCheckLabel}.`,
      "success"
    );

    if (issues.length) {
      generateSmartDeficiencyAlert(
        { ...application, id: appDisplayId },
        issues
      );
    }

    // Reset Form and UI states
    document.getElementById("applicationForm")?.reset();
    Object.keys(ocrData).forEach(k => delete ocrData[k]);
    ["stCertificate", "marksheet", "incomeCertificate"].forEach(docType => {
      const box = document.getElementById(`ocr-${docType}`);
      if (box) {
        box.innerHTML = "";
        box.classList.add("hidden");
      }
    });

    updateOcrSummary();
    clearFieldCheck("fullName");
    clearFieldCheck("marks");
    clearFieldCheck("income");

    const verificationPanel = document.getElementById("crossVerificationResult");
    if (verificationPanel) {
      verificationPanel.innerHTML = "Upload documents and fill the form fields above to run verification.";
    }

    const nameField = document.getElementById("fullName");
    if (nameField) {
      nameField.readOnly = false;
      nameField.classList.remove("verified-field");
    }

    updateApplicationEmail();
    updateSchemeFields();
    await updateHomeStats();

  } catch (error) {
    console.error("Application submission error:", error);
    showFormMessage(error?.message || "Unable to submit application.", "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Check & Submit Application";
    }
  }
}

/* =========================================================
   10. TRACK APPLICATION & OFFICER PORTAL (Hybrid Supabase + Local)
   ========================================================= */
const STATUSES = ["Submitted", "Under Review", "Deficient", "Approved (Demo)"];

async function fetchAllApplicationsMerged() {
  const localApps = getLocalApplications();
  let supaApps = [];

  try {
    const { data, error } = await supabaseClient
      .from("applications")
      .select("*")
      .order("submitted_at", { ascending: false });

    if (!error && Array.isArray(data)) {
      supaApps = data;
    }
  } catch {}

  const seenIds = new Set();
  const merged = [];

  [...localApps, ...supaApps].forEach(app => {
    const key = app.application_id || app.id;
    if (!seenIds.has(key)) {
      seenIds.add(key);
      merged.push(app);
    }
  });

  return merged;
}

async function trackApplication(event) {
  event.preventDefault();

  const loggedIn = await requireLogin();
  if (!loggedIn) return;

  const id = document.getElementById("trackingId")?.value.trim();
  const result = document.getElementById("trackingResult");
  if (!id || !result) return;

  try {
    let application = getLocalApplications().find(
      a =>
        String(a.application_id).toLowerCase() === id.toLowerCase() ||
        String(a.id).toLowerCase() === id.toLowerCase()
    );

    if (!application) {
      const { data: supaApp } = await supabaseClient
        .from("applications")
        .select("*")
        .eq("application_id", id)
        .maybeSingle();

      application = supaApp || null;
    }

    if (!application) {
      result.innerHTML = `
        <div class="message error">
          No application found. Please check your Application ID.
        </div>
      `;
      document.getElementById("applicationTimeline")?.classList.add("hidden");
      return;
    }

    const appDisplayId = application.application_id || application.id;
    const appIssues = Array.isArray(application.issues) ? application.issues : [];
    const issueList = appIssues.length
      ? appIssues.map(issue => `<li>${escapeHTML(issue)}</li>`).join("")
      : `<li>No missing fields detected by the basic demo checks.</li>`;

    const hasDeficiencyAlert = Boolean(getAlertCache()[appDisplayId] || appIssues.length > 0);

    result.innerHTML = `
      <div class="result-card">
        <h3>Application Details</h3>
        <div class="result-line">
          <span>Application ID</span>
          <strong>${escapeHTML(appDisplayId)}</strong>
        </div>
        <div class="result-line">
          <span>Student</span>
          <strong>${escapeHTML(application.name)}</strong>
        </div>
        <div class="result-line">
          <span>Scheme</span>
          <strong>${escapeHTML(application.scheme)}</strong>
        </div>
        <div class="result-line">
          <span>Status</span>
          ${createStatusBadge(application.status)}
        </div>
        <div class="result-line">
          <span>Submitted</span>
          <strong>${escapeHTML(formatDate(application.submitted_at))}</strong>
        </div>
        <h3 style="margin-top:20px">Pre-check Findings</h3>
        <ul>${issueList}</ul>
        <p class="muted" style="margin-top:15px">
          ${
            application.review_note
              ? "Officer note: " + escapeHTML(application.review_note)
              : "No officer note has been added."
          }
        </p>
        ${
          hasDeficiencyAlert
            ? `
              <button
                type="button"
                class="secondary-btn"
                style="margin-top:12px"
                onclick="viewDeficiencyAlert('${escapeHTML(appDisplayId)}')"
              >
                🔔 View Smart Deficiency Alert
              </button>
            `
            : ""
        }
        ${
          application.status === "Deficient"
            ? `
              <button
                type="button"
                class="primary-btn"
                style="margin-top:12px"
                onclick="startReupload('${escapeHTML(appDisplayId)}')"
              >
                📤 Re-upload corrected documents
              </button>
              <p class="muted" style="margin-top:8px">
                Fix the issues listed above, then re-upload the corrected documents for review.
              </p>
            `
            : ""
        }
      </div>
    `;

    renderApplicationTimeline(application.status);
  } catch (error) {
    result.innerHTML = `<div class="message error">${escapeHTML(error.message)}</div>`;
  }
}

/* Re-upload flow for a Deficient application: remember which application is
   being corrected and take the student to the Apply page to submit fresh
   documents. */
function startReupload(appId) {
  try {
    sessionStorage.setItem("tribalScholarReuploadFor", appId);
  } catch {}
  if (typeof showPage === "function") showPage("apply");
  const banner = document.getElementById("reuploadBanner");
  if (banner) {
    banner.textContent = `Re-uploading corrected documents for application ${appId}. Upload the fixed files below and submit again.`;
    banner.classList.remove("hidden");
  }
  const applyForm = document.getElementById("applicationForm");
  if (applyForm && applyForm.scrollIntoView) applyForm.scrollIntoView({ behavior: "smooth", block: "start" });
}
window.startReupload = startReupload;

async function renderAdmin() {
  const allowed = await requireOfficer();
  if (!allowed) return;

  const table = document.getElementById("applicationsTable");
  if (!table) return;

  table.innerHTML = `<tr><td colspan="6" class="empty-state">Loading applications...</td></tr>`;

  let apps = [];

  try {
    apps = await fetchAllApplicationsMerged();

    setText("adminTotal", apps.length);
    setText("adminReview", apps.filter(item => item.status === "Under Review").length);
    setText("adminDeficient", apps.filter(item => item.status === "Deficient").length);
    setText("adminApproved", apps.filter(item => item.status === "Approved (Demo)").length);

    if (!apps.length) {
      table.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state">
            No applications yet. Submit a demo application first.
          </td>
        </tr>
      `;
    } else {
      const alertCache = getAlertCache();

      table.innerHTML = apps
        .map(application => {
          const appDisplayId = application.application_id || application.id;
          const appIssues = Array.isArray(application.issues) ? application.issues : [];
          const hasAlert = Boolean(alertCache[appDisplayId] || appIssues.length > 0);
          const preCheckLabel = application.pre_check ? "Basic checks passed" : "Issues detected";
          const endorseCount = typeof window.mentorEndorsementCount === "function"
            ? window.mentorEndorsementCount(appDisplayId) : 0;

          return `
            <tr>
              <td><strong>${escapeHTML(appDisplayId)}</strong></td>
              <td>
                ${escapeHTML(application.name)}
                ${
                  endorseCount > 0
                    ? `<span class="endorse-badge" title="Community endorsements">🤝 ${endorseCount}</span>`
                    : ""
                }
              </td>
              <td>${escapeHTML(application.scheme)}</td>
              <td>
                ${escapeHTML(preCheckLabel)}
                ${
                  hasAlert
                    ? `
                      <button
                        type="button"
                        class="text-btn alert-bell-btn"
                        onclick="viewDeficiencyAlert('${escapeHTML(appDisplayId)}')"
                      >
                        🔔 View Alert
                      </button>
                    `
                    : ""
                }
              </td>
              <td>${createStatusBadge(application.status)}</td>
              <td>
                <select
                  aria-label="Update status for ${escapeHTML(appDisplayId)}"
                  onchange="updateStatus('${escapeHTML(application.id)}', this.value)"
                >
                  ${STATUSES.map(
                    status => `
                      <option value="${status}" ${application.status === status ? "selected" : ""}>
                        ${status}
                      </option>
                    `
                  ).join("")}
                </select>
                <div class="admin-note-wrap">
                  <input
                    type="text"
                    class="admin-note"
                    data-application-id="${escapeHTML(application.id)}"
                    placeholder="Add review note..."
                    value="${escapeHTML(application.review_note || "")}"
                  >
                  <button
                    type="button"
                    class="secondary-btn save-note-btn"
                    data-application-id="${escapeHTML(application.id)}"
                  >
                    Save
                  </button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");
    }
  } catch (error) {
    table.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHTML(error.message)}</td></tr>`;
  }

  // AI Priority Queue + Dynamic Rule Engine (section 12)
  try {
    await renderPriorityQueue(apps);
    renderRuleEngineForm();
  } catch (error) {
    console.error("Priority queue error:", error);
  }

  // Officer status-change audit log
  try {
    await renderAuditLog();
  } catch (error) {
    console.error("Audit log error:", error);
  }
}

async function updateStatus(id, status) {
  if (!STATUSES.includes(status)) return;
  const allowed = await requireOfficer();
  if (!allowed) return;

  try {
    // Capture the previous status for the audit trail before changing it.
    const localApps = getLocalApplications();
    const localIdx = localApps.findIndex(a => a.id === id || a.application_id === id);
    let oldStatus = localIdx !== -1 ? localApps[localIdx].status : null;
    if (oldStatus === null && !String(id).startsWith("TS")) {
      try {
        const { data } = await supabaseClient
          .from("applications").select("status").eq("id", id).single();
        oldStatus = data?.status ?? null;
      } catch {}
    }

    // Update in local fallback cache if present
    if (localIdx !== -1) {
      localApps[localIdx].status = status;
      localApps[localIdx].updated_at = new Date().toISOString();
      saveLocalApplications(localApps);
    }

    // Also attempt Supabase update if not a purely local ID
    if (!String(id).startsWith("TS")) {
      await supabaseClient
        .from("applications")
        .update({
          status,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);
    }

    // Record the change in the audit trail (Supabase for real IDs, plus a
    // local mirror so the officer portal can always display recent history).
    await recordStatusAudit(id, oldStatus, status);

    await renderAdmin();
    await updateHomeStats();
  } catch (error) {
    alert(error?.message || "Unable to update status.");
  }
}

/* ---------------------------------------------------------
   OFFICER STATUS-CHANGE AUDIT LOG
   Append-only trail of status changes. Written to Supabase
   (status_audit_log table) for real application IDs, and always
   mirrored to a local store so the Officer Portal can show recent
   history even in the offline/demo path.
   --------------------------------------------------------- */
const AUDIT_LOG_KEY = "tribalScholarStatusAudit";

function getLocalAuditLog() {
  try {
    return JSON.parse(localStorage.getItem(AUDIT_LOG_KEY)) || [];
  } catch {
    return [];
  }
}

function saveLocalAuditLog(entries) {
  try {
    // Keep the most recent 200 entries.
    localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(entries.slice(-200)));
  } catch {}
}

async function recordStatusAudit(applicationId, oldStatus, newStatus) {
  const entry = {
    application_id: applicationId,
    old_status: oldStatus || null,
    new_status: newStatus,
    changed_at: new Date().toISOString()
  };

  // Local mirror (always).
  const local = getLocalAuditLog();
  local.push(entry);
  saveLocalAuditLog(local);

  // Supabase (best effort, only for real UUID application IDs).
  if (!String(applicationId).startsWith("TS")) {
    try {
      await supabaseClient.from("status_audit_log").insert({
        application_id: applicationId,
        old_status: oldStatus || null,
        new_status: newStatus
      });
    } catch (err) {
      console.warn("Audit log insert skipped:", err?.message || err);
    }
  }
}

/* Merge Supabase + local audit rows, newest first. */
async function fetchAuditLog(limit = 25) {
  const rows = [];
  try {
    const { data } = await supabaseClient
      .from("status_audit_log")
      .select("application_id, old_status, new_status, changed_at")
      .order("changed_at", { ascending: false })
      .limit(limit);
    if (Array.isArray(data)) rows.push(...data);
  } catch {}
  // Add local entries that Supabase does not have (e.g. demo "TS" IDs).
  const localOnly = getLocalAuditLog().filter(e => String(e.application_id).startsWith("TS"));
  rows.push(...localOnly);
  rows.sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
  return rows.slice(0, limit);
}

async function renderAuditLog() {
  const box = document.getElementById("statusAuditLog");
  if (!box) return;
  try {
    const rows = await fetchAuditLog(25);
    if (!rows.length) {
      box.innerHTML = `<tr><td colspan="4" class="empty-state">No status changes recorded yet.</td></tr>`;
      return;
    }
    box.innerHTML = rows.map(r => `
      <tr>
        <td><strong>${escapeHTML(String(r.application_id))}</strong></td>
        <td>${escapeHTML(r.old_status || "—")}</td>
        <td>${escapeHTML(r.new_status)}</td>
        <td>${escapeHTML(formatDate(r.changed_at))}</td>
      </tr>
    `).join("");
  } catch (error) {
    box.innerHTML = `<tr><td colspan="4" class="empty-state">${escapeHTML(error.message)}</td></tr>`;
  }
}
window.renderAuditLog = renderAuditLog;

async function saveReviewNote(applicationId) {
  const allowed = await requireOfficer();
  if (!allowed) return;

  const input = document.querySelector(`.admin-note[data-application-id="${applicationId}"]`);
  if (!input) return;

  try {
    const noteText = input.value.trim();

    const localApps = getLocalApplications();
    const localIdx = localApps.findIndex(
      a => a.id === applicationId || a.application_id === applicationId
    );
    if (localIdx !== -1) {
      localApps[localIdx].review_note = noteText;
      localApps[localIdx].updated_at = new Date().toISOString();
      saveLocalApplications(localApps);
    }

    if (!String(applicationId).startsWith("TS")) {
      await supabaseClient
        .from("applications")
        .update({
          review_note: noteText,
          updated_at: new Date().toISOString()
        })
        .eq("id", applicationId);
    }

    alert("Review note saved successfully.");
    await renderAdmin();
  } catch (error) {
    alert(error?.message || "Unable to save review note.");
  }
}

document.addEventListener("click", event => {
  const button = event.target.closest(".save-note-btn");
  if (button) saveReviewNote(button.dataset.applicationId);
});

async function updateHomeStats() {
  try {
    const apps = await fetchAllApplicationsMerged();
    setText("homeTotal", apps.length);
    setText(
      "homePending",
      apps.filter(item => item.status === "Submitted" || item.status === "Under Review").length
    );
  } catch (error) {
    console.error("Home stats error:", error);
  }
}

/* =========================================================
   11. PAGE NAVIGATION, TIMELINE & HELPERS
   ========================================================= */
async function showPage(pageId) {
  const pageMap = {
    homePage: "home",
    applyPage: "apply",
    trackPage: "track",
    officerPage: "admin"
  };
  const resolvedId = pageMap[pageId] || pageId;

  if (["apply", "track", "admin"].includes(resolvedId)) {
    const loggedIn = await requireLogin();
    if (!loggedIn) return;
  }

  if (resolvedId === "admin") {
    const officer = await requireOfficer();
    if (!officer) return;
  }

  document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
  const page = document.getElementById(resolvedId);
  if (page) page.classList.add("active");

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.page === resolvedId);
  });

  if (resolvedId === "apply") {
    updateApplicationEmail();
    updateSchemeFields();
  }
  if (resolvedId === "admin") await renderAdmin();
  if (resolvedId === "home") await updateHomeStats();
  if (resolvedId === "mentor" && typeof renderMentorPage === "function") renderMentorPage();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function chooseScheme(scheme) {
  const schemeField = document.getElementById("scheme");
  if (schemeField) schemeField.value = scheme;
  showPage("apply");
  updateSchemeFields();
}

function updateSchemeFields() {
  const scheme = document.getElementById("scheme");
  const offerField = document.getElementById("offerLetterField");
  const offerInput = document.getElementById("offerLetter");

  if (!scheme || !offerField || !offerInput) return;

  const isNOS = scheme.value === "NOS";
  offerField.classList.toggle("hidden", !isNOS);
  offerInput.required = isNOS;
  if (!isNOS) offerInput.value = "";

  runEligibilityPreCheck();
}

function renderApplicationTimeline(status) {
  const container = document.getElementById("applicationTimeline");
  if (!container) return;

  container.classList.remove("hidden");

  const normalizedStatus = status === "Approved (Demo)" ? "Approved" : status;
  const steps = ["Submitted", "Under Review", "Deficient", "Approved"];
  const currentIndex = steps.indexOf(normalizedStatus);

  document.querySelectorAll(".timeline-step").forEach(step => {
    const stepStatus = step.dataset.status;
    const stepIndex = steps.indexOf(stepStatus);
    const dot = step.querySelector(".timeline-dot");

    step.classList.remove("completed", "current");

    if (currentIndex !== -1 && stepIndex < currentIndex) {
      step.classList.add("completed");
      if (dot) dot.textContent = "✓";
    } else if (stepIndex === currentIndex) {
      step.classList.add("completed", "current");
      if (dot) dot.textContent = "✓";
    } else {
      if (dot) dot.textContent = stepIndex + 1;
    }
  });
}

function getStatusClass(status) {
  if (status === "Deficient") return "deficient";
  if (status === "Under Review") return "review";
  if (status === "Approved (Demo)") return "approved";
  return "pending";
}

function createStatusBadge(status) {
  return `<span class="status ${getStatusClass(status)}">${escapeHTML(status)}</span>`;
}

function setText(elementId, value) {
  const el = document.getElementById(elementId);
  if (el) el.textContent = value;
}

function formatDate(date) {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

/* ===========================================================================
   12. AI PRIORITY QUEUE + DYNAMIC RULE ENGINE
   =========================================================================== */
const RULE_CONFIG_KEY = "tribalScholarRuleConfig";

const DEFAULT_RULE_CONFIG = {
  version: 1,
  updatedAt: null,
  yellowMarginMarks: 5,      // marks within 5 points of cut-off => Yellow
  yellowMarginIncomePct: 10, // income within 10% of ceiling => Yellow
  schemes: {
    NFST: { minMarks: 55, maxIncome: 800000, allowedEducation: ["PhD"] },
    NOS:  { minMarks: 60, maxIncome: 800000, allowedEducation: ["Masters", "PhD"] }
  }
};

const PENDING_STATUSES = ["Submitted", "Under Review", "Deficient"];
const RULE_DRIVEN_LABELS = [
  "Academic percentage",
  "Annual family income",
  "Higher-study level",
  "Education / research level"
];

const TIER_META = {
  red:    { label: "🔴 Red — Deficient / Anomaly", order: 0, color: "#d9534f" },
  yellow: { label: "🟡 Yellow — Manual Review",    order: 1, color: "#e9a34b" },
  green:  { label: "🟢 Green — Auto-Verified",     order: 2, color: "#2e9e6f" }
};

let priorityFilter = "all";
let ruleFormRendered = false;

/* ---------- Rule config storage ---------- */
function cloneDefaultRuleConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_RULE_CONFIG));
}

function loadRuleConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(RULE_CONFIG_KEY));
    const cfg = cloneDefaultRuleConfig();
    if (!saved) return cfg;

    cfg.version = saved.version || 1;
    cfg.updatedAt = saved.updatedAt || null;
    cfg.yellowMarginMarks = saved.yellowMarginMarks ?? cfg.yellowMarginMarks;
    cfg.yellowMarginIncomePct = saved.yellowMarginIncomePct ?? cfg.yellowMarginIncomePct;
    Object.keys(cfg.schemes).forEach(s => {
      cfg.schemes[s] = { ...cfg.schemes[s], ...(saved.schemes?.[s] || {}) };
    });
    return cfg;
  } catch {
    return cloneDefaultRuleConfig();
  }
}

function saveRuleConfig(cfg) {
  localStorage.setItem(RULE_CONFIG_KEY, JSON.stringify(cfg));
}

/* Push officer rules into the student-side eligibility engine so the
   Apply page uses exactly the same numbers. */
function applyRuleConfigToEligibilityEngine(cfg = loadRuleConfig()) {
  Object.entries(cfg.schemes).forEach(([scheme, r]) => {
    const rules = ELIGIBILITY_RULES[scheme];
    if (!rules) return;
    rules.criteria.forEach(c => {
      if (c.key === "marks") c.min = r.minMarks;
      if (c.key === "income") c.max = r.maxIncome;
      if (c.key === "education") c.allowed = [...r.allowedEducation];
    });
  });
  runEligibilityPreCheck();
}
applyRuleConfigToEligibilityEngine();

/* ---------- Core AI risk evaluator ---------- */
function isRuleDrivenIssue(text) {
  return (
    String(text).startsWith("Eligibility:") &&
    RULE_DRIVEN_LABELS.some(label => String(text).includes(label))
  );
}

function evaluateApplicationRisk(app, cfg) {
  const rule = cfg.schemes[app.scheme];
  const marks = Number(app.marks);
  const income = Number(app.income);

  // Keep rule-independent problems (missing docs, name mismatch, expiry...)
  const kept = (Array.isArray(app.issues) ? app.issues : []).filter(
    i => !isRuleDrivenIssue(i)
  );
  const ruleIssues = [];
  const watch = [];

  if (rule) {
    if (Number.isFinite(marks)) {
      if (marks < rule.minMarks) {
        ruleIssues.push(
          `Eligibility: Academic percentage — ${marks}% is below the minimum ${rule.minMarks}%`
        );
      } else if (marks - rule.minMarks <= cfg.yellowMarginMarks) {
        watch.push(`Marks ${marks}% are close to the ${rule.minMarks}% cut-off`);
      }
    }

    if (Number.isFinite(income)) {
      if (income > rule.maxIncome) {
        ruleIssues.push(
          `Eligibility: Annual family income — ₹${income.toLocaleString("en-IN")} is above the maximum ₹${rule.maxIncome.toLocaleString("en-IN")}`
        );
      } else if (income >= rule.maxIncome * (1 - cfg.yellowMarginIncomePct / 100)) {
        watch.push(
          `Income ₹${income.toLocaleString("en-IN")} is near the ₹${rule.maxIncome.toLocaleString("en-IN")} ceiling`
        );
      }
    }

    if (app.education && !rule.allowedEducation.includes(app.education)) {
      const label = app.scheme === "NOS" ? "Higher-study level" : "Education / research level";
      ruleIssues.push(
        `Eligibility: ${label} — ${app.education} does not meet the configured education rule`
      );
    }
  } else {
    watch.push("Unknown scheme — needs manual check");
  }

  // Anomaly heuristics
  if (marks === 100) watch.push("Perfect 100% score — verify marksheet");
  if (income === 0) watch.push("Zero income declared — verify income certificate");

  const issues = [...kept, ...ruleIssues];
  let tier = "green";
  let risk = 5;
  let reasons;

  if (issues.length) {
    tier = "red";
    risk = Math.min(100, 60 + issues.length * 10);
    reasons = issues;
  } else if (app.status === "Deficient") {
    tier = "red";
    risk = 70;
    reasons = ["Marked Deficient by officer"];
  } else if (watch.length) {
    tier = "yellow";
    risk = Math.min(59, 30 + watch.length * 10);
    reasons = watch;
  } else {
    reasons = ["All checks passed with comfortable margins"];
  }

  return { issues, watch, tier, risk, reasons };
}

/* ---------- Priority Queue rendering ---------- */
function setPriorityFilter(filter) {
  priorityFilter = filter;
  renderPriorityQueue();
}

async function renderPriorityQueue(appsInput) {
  const body = document.getElementById("pqBody");
  if (!body) return;

  const cfg = loadRuleConfig();
  const all = Array.isArray(appsInput) && appsInput.length
    ? appsInput
    : await fetchAllApplicationsMerged();

  const pending = all
    .filter(a => PENDING_STATUSES.includes(a.status))
    .map(a => ({ app: a, res: evaluateApplicationRisk(a, cfg) }))
    .sort((x, y) =>
      TIER_META[x.res.tier].order - TIER_META[y.res.tier].order ||
      y.res.risk - x.res.risk
    );

  const count = t => pending.filter(p => p.res.tier === t).length;

  const summary = document.getElementById("pqSummary");
  if (summary) {
    summary.innerHTML = `
      <div class="pq-card red"><strong>${count("red")}</strong><span>Red · Deficient / Anomalies</span></div>
      <div class="pq-card yellow"><strong>${count("yellow")}</strong><span>Yellow · Needs Manual Review</span></div>
      <div class="pq-card green"><strong>${count("green")}</strong><span>Green · Auto-Verified / Low Risk</span></div>
    `;
  }

  const filterBox = document.getElementById("pqFilters");
  if (filterBox) {
    const filters = [
      ["all", `All (${pending.length})`],
      ["red", `Red (${count("red")})`],
      ["yellow", `Yellow (${count("yellow")})`],
      ["green", `Green (${count("green")})`]
    ];
    filterBox.innerHTML = filters
      .map(([key, label]) => `
        <button type="button"
          class="secondary-btn ${priorityFilter === key ? "active" : ""}"
          onclick="setPriorityFilter('${key}')">${label}</button>`)
      .join("");
  }

  const visible = pending.filter(p => priorityFilter === "all" || p.res.tier === priorityFilter);

  if (!visible.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty-state">No applications in this category.</td></tr>`;
    return;
  }

  body.innerHTML = visible.map(({ app, res }) => {
    const id = app.application_id || app.id;
    const meta = TIER_META[res.tier];
    return `
      <tr class="pq-row-${res.tier}">
        <td><span class="pq-badge ${res.tier}">${escapeHTML(meta.label)}</span></td>
        <td><strong>${escapeHTML(id)}</strong></td>
        <td>${escapeHTML(app.name)}</td>
        <td>${escapeHTML(app.scheme)}</td>
        <td>${escapeHTML(String(app.marks))}% / ₹${Number(app.income).toLocaleString("en-IN")}</td>
        <td>
          <strong>${res.risk}</strong>
          <div class="risk-bar"><div style="width:${res.risk}%;background:${meta.color}"></div></div>
        </td>
        <td>
          <ul class="pq-findings">
            ${res.reasons.slice(0, 3).map(r => `<li>${escapeHTML(r)}</li>`).join("")}
            ${res.reasons.length > 3 ? `<li>+${res.reasons.length - 3} more</li>` : ""}
          </ul>
        </td>
        <td>${createStatusBadge(app.status)}</td>
      </tr>`;
  }).join("");
}

/* ---------- Rule Engine form ---------- */
function renderRuleEngineForm(force = false) {
  const box = document.getElementById("ruleEngineForm");
  if (!box) return;
  if (ruleFormRendered && !force) return; // don't wipe unsaved edits

  const cfg = loadRuleConfig();
  box.innerHTML = Object.entries(cfg.schemes).map(([scheme, r]) => `
    <div class="rule-card">
      <h3>${escapeHTML(scheme)} — ${escapeHTML(ELIGIBILITY_RULES[scheme]?.name || scheme)}</h3>
      <label>Minimum marks / percentage (%)
        <input type="number" min="0" max="100" step="0.01"
          id="rule-${scheme}-minMarks" value="${r.minMarks}">
      </label>
      <label>Maximum annual family income (₹)
        <input type="number" min="0" step="1000"
          id="rule-${scheme}-maxIncome" value="${r.maxIncome}">
      </label>
      <div>
        <strong style="font-size:13px">Accepted education levels</strong>
        <div class="rule-checks">
          ${["Masters", "PhD", "Other"].map(level => `
            <label>
              <input type="checkbox" id="rule-${scheme}-edu-${level}"
                ${r.allowedEducation.includes(level) ? "checked" : ""}>
              ${level === "Masters" ? "Master's" : level}
            </label>`).join("")}
        </div>
      </div>
    </div>
  `).join("") + `
    <div class="rule-card" style="grid-column:1/-1">
      <h3>AI Risk Sensitivity</h3>
      <div class="form-grid">
        <label>Yellow zone: marks within (points) of cut-off
          <input type="number" min="0" max="50" id="rule-yellowMarks" value="${cfg.yellowMarginMarks}">
        </label>
        <label>Yellow zone: income within (%) of ceiling
          <input type="number" min="0" max="100" id="rule-yellowIncome" value="${cfg.yellowMarginIncomePct}">
        </label>
      </div>
      <small class="muted">Rule set v${cfg.version}${cfg.updatedAt ? " · last updated " + escapeHTML(cfg.updatedAt) : " · defaults"}</small>
    </div>
  `;
  ruleFormRendered = true;
}

function readRuleFormConfig() {
  const cfg = loadRuleConfig();
  Object.keys(cfg.schemes).forEach(scheme => {
    const minMarks = parseFloat(document.getElementById(`rule-${scheme}-minMarks`)?.value);
    const maxIncome = parseFloat(document.getElementById(`rule-${scheme}-maxIncome`)?.value);
    if (Number.isFinite(minMarks)) cfg.schemes[scheme].minMarks = minMarks;
    if (Number.isFinite(maxIncome)) cfg.schemes[scheme].maxIncome = maxIncome;
    cfg.schemes[scheme].allowedEducation = ["Masters", "PhD", "Other"].filter(
      lvl => document.getElementById(`rule-${scheme}-edu-${lvl}`)?.checked
    );
  });
  const ym = parseFloat(document.getElementById("rule-yellowMarks")?.value);
  const yi = parseFloat(document.getElementById("rule-yellowIncome")?.value);
  if (Number.isFinite(ym)) cfg.yellowMarginMarks = ym;
  if (Number.isFinite(yi)) cfg.yellowMarginIncomePct = yi;
  return cfg;
}

/* ---------- Instant re-evaluation ---------- */
async function persistReevaluation(app, res, newStatus, ruleVersion) {
  const now = new Date().toISOString();

  const local = getLocalApplications();
  const idx = local.findIndex(a => a.id === app.id || a.application_id === app.id);
  if (idx !== -1) {
    local[idx].issues = res.issues;
    local[idx].pre_check = res.issues.length === 0;
    local[idx].status = newStatus;
    local[idx].updated_at = now;
    local[idx].rule_version = ruleVersion;
    saveLocalApplications(local);
  }

  if (!String(app.id).startsWith("TS")) {
    try {
      await supabaseClient
        .from("applications")
        .update({
          issues: res.issues,
          pre_check: res.issues.length === 0,
          status: newStatus,
          updated_at: now
        })
        .eq("id", app.id);
    } catch (e) {
      console.warn("Supabase re-evaluation update failed:", e);
    }
  }
}

async function reevaluateAllApplications(oldCfg, newCfg, dryRun) {
  const all = await fetchAllApplicationsMerged();
  const pending = all.filter(a => PENDING_STATUSES.includes(a.status));
  const changes = [];

  for (const app of pending) {
    const before = evaluateApplicationRisk(app, oldCfg);
    const after = evaluateApplicationRisk(app, newCfg);

    // Auto-status: only flip Submitted <-> Deficient. "Under Review" stays
    // with the officer, and manual Deficient flags are preserved.
    let newStatus = app.status;
    if (after.issues.length && app.status === "Submitted") newStatus = "Deficient";
    if (!after.issues.length && before.issues.length && app.status === "Deficient") {
      newStatus = "Submitted";
    }

    const tierChanged = before.tier !== after.tier;
    const statusChanged = newStatus !== app.status;

    if (tierChanged || statusChanged) {
      changes.push({
        id: app.application_id || app.id,
        name: app.name,
        fromTier: before.tier,
        toTier: after.tier,
        fromStatus: app.status,
        toStatus: newStatus
      });
    }

    if (!dryRun) {
      await persistReevaluation(app, after, newStatus, newCfg.version);
    }
  }

  return { total: pending.length, changes };
}

function renderReevaluationResult(result, newCfg, dryRun) {
  const box = document.getElementById("ruleEngineResult");
  if (!box) return;

  const icon = { red: "🔴", yellow: "🟡", green: "🟢" };
  const list = result.changes.slice(0, 12).map(c => `
    <li>
      <strong>${escapeHTML(c.id)}</strong> (${escapeHTML(c.name)}):
      ${icon[c.fromTier]} → ${icon[c.toTier]}
      ${c.fromStatus !== c.toStatus ? ` · ${escapeHTML(c.fromStatus)} → ${escapeHTML(c.toStatus)}` : ""}
    </li>`).join("");

  box.innerHTML = `
    <div class="rule-result ${dryRun ? "preview" : ""}">
      <strong>${dryRun ? "Preview only (nothing saved)" : `✓ Rule set v${newCfg.version} saved & applied`}</strong><br>
      ${result.total} pending application(s) evaluated ·
      <strong>${result.changes.length}</strong> ${dryRun ? "would change" : "changed"}.
      ${result.changes.length ? `<ul>${list}</ul>` : ""}
      ${result.changes.length > 12 ? `<div>…and ${result.changes.length - 12} more.</div>` : ""}
    </div>`;
}

async function previewRuleImpact() {
  const oldCfg = loadRuleConfig();
  const newCfg = readRuleFormConfig();
  const result = await reevaluateAllApplications(oldCfg, newCfg, true);
  renderReevaluationResult(result, newCfg, true);
}

async function saveRulesAndReevaluate() {
  const allowed = await requireOfficer();
  if (!allowed) return;

  const oldCfg = loadRuleConfig();
  const newCfg = readRuleFormConfig();

  for (const [scheme, r] of Object.entries(newCfg.schemes)) {
    if (r.minMarks < 0 || r.minMarks > 100) {
      alert(`${scheme}: minimum marks must be between 0 and 100.`);
      return;
    }
    if (!r.allowedEducation.length) {
      alert(`${scheme}: select at least one accepted education level.`);
      return;
    }
  }

  newCfg.version = (oldCfg.version || 1) + 1;
  newCfg.updatedAt = new Date().toLocaleString();
  saveRuleConfig(newCfg);
  applyRuleConfigToEligibilityEngine(newCfg);

  const result = await reevaluateAllApplications(oldCfg, newCfg, false);

  await renderAdmin();          // refresh table, stats + priority queue
  renderRuleEngineForm(true);   // refresh version label
  renderReevaluationResult(result, newCfg, false); // keep the result visible
}

async function resetRulesToDefault() {
  if (!confirm("Reset all rules to the default values and re-evaluate pending applications?")) return;

  const oldCfg = loadRuleConfig();
  const newCfg = cloneDefaultRuleConfig();
  newCfg.version = (oldCfg.version || 1) + 1;
  newCfg.updatedAt = new Date().toLocaleString();
  saveRuleConfig(newCfg);
  applyRuleConfigToEligibilityEngine(newCfg);

  const result = await reevaluateAllApplications(oldCfg, newCfg, false);

  await renderAdmin();
  renderRuleEngineForm(true);
  renderReevaluationResult(result, newCfg, false);
}

/* =========================================================
   13. STUDY BUDDY — AI ASSISTANT (rule/keyword based)
   ========================================================= */
const STUDY_BUDDY_KB = [
  {
    id: "greeting",
    keywords: ["hi", "hello", "hey", "namaste", "yo"],
    answer:
      "Hi! I'm Study Buddy 🎓 I can help with questions about NFST / NOS, the application steps, required documents, eligibility, and tracking your status. What would you like to know?"
  },
  {
    id: "schemes",
    keywords: ["scheme", "schemes", "which scholarship", "what scholarship", "options", "nfst vs nos", "nfst and nos", "difference between nfst and nos"],
    answer:
      "TribalScholar currently lists two schemes:\n\n• NFST — National Fellowship for ST Students (for PhD / research)\n• NOS — National Overseas Scholarship (for Master's/PhD study abroad, needs a university offer letter)\n\nAsk me about either one, e.g. \"what is NFST\" or \"eligibility for NOS\"."
  },
  {
    id: "nfst",
    keywords: ["nfst", "fellowship", "national fellowship"],
    answer:
      "NFST — National Fellowship for ST Students:\n• For PhD / research-level study in India\n• Requires: ST certificate, marksheet, income certificate\n• Configured pre-check rules: marks ≥ 55%, annual family income ≤ ₹8,00,000\n\nThis is prototype logic for the demo, not the official rule set — always check the real scheme guidelines too."
  },
  {
    id: "nos",
    keywords: ["nos", "overseas", "study abroad", "national overseas"],
    answer:
      "NOS — National Overseas Scholarship:\n• For Master's or PhD study abroad\n• Requires: ST certificate, marksheet, income certificate, AND a university offer letter\n• Configured pre-check rules: marks ≥ 60%, annual family income ≤ ₹8,00,000\n\nThis is prototype logic for the demo — check the official NOS guidelines for the real criteria."
  },
  {
    id: "eligibility",
    keywords: ["eligible", "eligibility", "criteria", "qualify", "income limit", "marks required", "percentage required"],
    answer:
      "Eligibility (prototype rules) depends on your chosen scheme:\n• NFST: PhD/research level, marks ≥ 55%, income ≤ ₹8,00,000\n• NOS: Master's or PhD, marks ≥ 60%, income ≤ ₹8,00,000, offer letter required\n\nOfficers can change these values in the Rule Engine. Open the Apply page, fill the form, and the AI Eligibility Engine panel will show you a live pass/fail/review breakdown."
  },
  {
    id: "documents",
    keywords: ["document", "documents", "upload", "certificate", "papers", "files needed", "what to upload"],
    answer:
      "You'll typically need to upload:\n• ST Certificate\n• Marksheets / Academic Record\n• Income Certificate\n• University Offer Letter (only for NOS)\n\nEach one is scanned with on-device OCR so the portal can cross-check it against what you typed in the form."
  },
  {
    id: "apply-steps",
    keywords: ["how to apply", "apply", "start application", "application process", "steps"],
    answer:
      "Applying is 4 steps:\n1. Register / log in and pick a scheme\n2. Fill in personal, academic & income details\n3. Upload your documents (OCR runs automatically)\n4. Run the Readiness Checker, fix anything flagged, then submit\n\nYou can start from the \"Start Application\" button on this page."
  },
  {
    id: "readiness",
    keywords: ["readiness", "ready to submit", "missing fields", "complete application", "check my application"],
    answer:
      "On the Apply page, click \"Check My Application\" under Application Readiness Checker. It flags missing required fields or documents, and warns you if a certificate looks expired, before you submit."
  },
  {
    id: "track",
    keywords: ["track", "status", "application id", "where is my application", "application status"],
    answer:
      "Go to the \"Track Application\" tab and enter your Application ID (e.g. TS260001). You'll see the current status — Submitted, Under Review, Deficient, or Approved — plus a timeline and any pre-check findings."
  },
  {
    id: "deficient",
    keywords: ["deficient", "correction", "rejected", "issue with my application", "what went wrong", "fix my application"],
    answer:
      "\"Deficient\" means the AI pre-check found an issue — a missing field, a mismatch between your form and OCR data, or a possibly expired certificate. Track your application to see the exact issues, and check the Smart Deficiency Alert (the 🔔 button) for the full notice."
  },
  {
    id: "mismatch",
    keywords: ["mismatch", "name doesn't match", "ocr wrong", "incorrect reading", "wrong name"],
    answer:
      "If OCR reads your document differently from what you typed (e.g. your name or marks), the field is highlighted and a note explains the difference. Double-check your spelling first — if the document itself is correct, it will still be sent for officer review."
  },
  {
    id: "income",
    keywords: ["income certificate", "income proof", "how much income", "family income"],
    answer:
      "The income certificate is used to verify your annual family income against the scheme's configured limit (₹8,00,000 in this prototype). Make sure the certificate is recent — certificates older than about a year may be flagged as possibly expired."
  },
  {
    id: "officer",
    keywords: ["officer", "review", "who approves", "who checks my application"],
    answer:
      "A human officer always reviews applications in the Officer Portal — the AI pre-checks (readiness, eligibility, OCR cross-verification, priority queue) only flag issues in advance; they don't grant or deny scholarships themselves."
  },
  {
    id: "identity",
    keywords: ["aadhaar", "digilocker", "identity verification", "ekyc", "otp"],
    answer:
      "You can verify your identity or fetch documents via the demo eKYC/DigiLocker flow on the Apply page. In this prototype, OTP verification uses the demo code 123456 — real eKYC would need an official licensed integration."
  },
  {
    id: "study-tips",
    keywords: ["study tips", "how to study", "exam tips", "prepare for exam", "improve marks", "study better"],
    answer:
      "A few general study habits that help with scholarship-level academics:\n• Break revision into short, focused sessions with breaks (e.g. 25–5 min)\n• Practice past papers or problem sets, not just re-reading notes\n• Summarize each topic in your own words after studying it\n• Sleep and review are both part of learning — don't cut sleep to cram\n\nFor scholarship-specific prep, check your target scheme's official syllabus/interview guidelines."
  },
  {
    id: "phd-research",
    keywords: ["phd", "research proposal", "choosing a guide", "research topic"],
    answer:
      "For PhD/research-track scholarships like NFST, a strong application usually includes a clear research proposal (problem, method, why it matters), a suitable guide/institution, and a track record shown through your marksheets and any prior research. This portal itself doesn't evaluate research proposals — that's part of the official scheme process."
  },
  {
    id: "contact",
    keywords: ["contact", "help desk", "support", "phone number", "email support", "talk to someone"],
    answer:
      "This is a student-built prototype, so there isn't a live support line here. For official queries, contact your scholarship scheme's real helpdesk/state nodal office — I can only answer questions about how this demo portal works."
  },
  {
    id: "about",
    keywords: ["what is tribalscholar", "about this site", "what is this website", "what does this do"],
    answer:
      "TribalScholar is a prototype scholarship management portal for Scheduled Tribe students — it lets you apply for NFST/NOS, uploads documents with automatic OCR reading, runs AI-style pre-checks, and lets you track your application status."
  }
];

const STUDY_BUDDY_FALLBACK =
  "I'm not sure about that one yet — I can help with scheme details (NFST/NOS), documents, eligibility, the application steps, tracking status, or general study tips. Try one of the quick topics below, or rephrase your question.";

const STUDY_BUDDY_QUICK_TOPICS = [
  { label: "NFST vs NOS", query: "What is the difference between NFST and NOS?" },
  { label: "Documents needed", query: "What documents do I need to upload?" },
  { label: "Eligibility rules", query: "What are the eligibility criteria?" },
  { label: "How to apply", query: "How do I apply?" },
  { label: "Track my status", query: "How do I track my application?" },
  { label: "Study tips", query: "Give me some study tips" }
];

let studyBuddyOpened = false;

function toggleStudyBuddy() {
  const panel = document.getElementById("studyBuddyPanel");
  if (!panel) return;

  const willOpen = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !willOpen);

  if (willOpen && !studyBuddyOpened) {
    studyBuddyOpened = true;
    renderStudyBuddyQuickReplies();
    if (window.StudyBuddyAI) {
      StudyBuddyAI.greeting();
    } else {
      addStudyBuddyMessage(
        "bot",
        "Hi! I'm Study Buddy 🎓 Ask me anything about NFST/NOS, documents, eligibility, applying, tracking status, or general study tips."
      );
    }
  }

  if (willOpen) {
    document.getElementById("studyBuddyInput")?.focus();
  }
}

function renderStudyBuddyQuickReplies() {
  if (window.StudyBuddyAI) return StudyBuddyAI.renderQuickReplies();

  const wrap = document.getElementById("studyBuddyQuickReplies");
  if (!wrap) return;

  wrap.innerHTML = STUDY_BUDDY_QUICK_TOPICS.map(
    (topic, index) => `
      <button type="button" class="study-buddy-chip" data-study-buddy-topic="${index}">
        ${escapeHTML(topic.label)}
      </button>
    `
  ).join("");
}

function addStudyBuddyMessage(sender, text) {
  const messages = document.getElementById("studyBuddyMessages");
  if (!messages) return;

  const bubble = document.createElement("div");
  bubble.className = `study-buddy-msg ${sender}`;
  bubble.textContent = text;
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
}

/* Whole-word match so "hi" doesn't fire inside "this" or "which". */
function studyBuddyKeywordMatches(query, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("(^|[^a-z0-9])" + escaped + "s?([^a-z0-9]|$)", "i");
  return pattern.test(query);
}

function findStudyBuddyAnswer(rawQuery) {
  const query = rawQuery.toLowerCase().trim();
  if (!query) return STUDY_BUDDY_FALLBACK;

  let bestMatch = null;
  let bestScore = 0;

  STUDY_BUDDY_KB.forEach(entry => {
    let score = 0;
    entry.keywords.forEach(keyword => {
      if (studyBuddyKeywordMatches(query, keyword)) {
        score += keyword.split(" ").length;
      }
    });
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  });

  return bestMatch ? bestMatch.answer : STUDY_BUDDY_FALLBACK;
}

function handleStudyBuddySend(rawQuery) {
  // Multilingual AI assistant (js/ai-assistant.js) takes over when loaded
  if (window.StudyBuddyAI) return StudyBuddyAI.handle(rawQuery);

  const query = rawQuery.trim();
  if (!query) return;

  addStudyBuddyMessage("user", query);

  const answer = findStudyBuddyAnswer(query);
  setTimeout(() => addStudyBuddyMessage("bot", answer), 250);
}

/* =========================================================
   14. INITIALIZATION & GLOBAL EXPORTS
   ========================================================= */
document.addEventListener("DOMContentLoaded", async function () {
  updateSchemeFields();
  runEligibilityPreCheck();
  updateOcrSummary();
  runCrossVerification();

  ["fullName", "marks", "income", "education", "scheme"].forEach(fieldId => {
    const element = document.getElementById(fieldId);
    if (!element) return;
    element.addEventListener("input", () => {
      runEligibilityPreCheck();
      runCrossVerification();
    });
    element.addEventListener("change", () => {
      if (fieldId === "scheme") updateSchemeFields();
      runEligibilityPreCheck();
      runCrossVerification();
    });
  });

  document.getElementById("applicationForm")?.addEventListener("submit", submitApplication);
  document.getElementById("trackForm")?.addEventListener("submit", trackApplication);

  // Study Buddy wiring
  document.getElementById("studyBuddyForm")?.addEventListener("submit", function (event) {
    event.preventDefault();
    const input = document.getElementById("studyBuddyInput");
    if (!input) return;
    handleStudyBuddySend(input.value);
    input.value = "";
  });

  document.getElementById("studyBuddyQuickReplies")?.addEventListener("click", function (event) {
    const chip = event.target.closest("[data-study-buddy-topic]");
    if (!chip) return;
    const topic = STUDY_BUDDY_QUICK_TOPICS[Number(chip.dataset.studyBuddyTopic)];
    if (topic) handleStudyBuddySend(topic.query);
  });

  await loadCurrentUser();
});

document.addEventListener("click", function (event) {
  const button = event.target.closest("button");
  if (!button) return;
  document.querySelectorAll("button.clicked").forEach(btn => btn.classList.remove("clicked"));
  button.classList.add("clicked");
});

window.showPage = showPage;
window.chooseScheme = chooseScheme;
window.updateSchemeFields = updateSchemeFields;
window.handleDocumentOCR = handleDocumentOCR;
window.openAadhaarModal = openAadhaarModal;
window.startDigiLockerVerification = startDigiLockerVerification;
window.checkApplicationReadiness = checkApplicationReadiness;
window.viewDeficiencyAlert = viewDeficiencyAlert;
window.closeDeficiencyAlertModal = closeDeficiencyAlertModal;
window.updateStatus = updateStatus;
window.renderAdmin = renderAdmin;
window.runEligibilityPreCheck = runEligibilityPreCheck;
window.runCrossVerification = runCrossVerification;
window.toggleStudyBuddy = toggleStudyBuddy;
window.setPriorityFilter = setPriorityFilter;
window.previewRuleImpact = previewRuleImpact;
window.saveRulesAndReevaluate = saveRulesAndReevaluate;
window.resetRulesToDefault = resetRulesToDefault;
/* =========================================================
   14. PHASE 4: TWO-WAY COMMUNICATION HUB & DOCUMENT RE-UPLOAD
   ========================================================= */
const TICKET_HUB_KEY = "tribalScholarTicketHub";
let activeTicketAppId = null;

function getTicketStore() {
  try {
    return JSON.parse(localStorage.getItem(TICKET_HUB_KEY)) || {};
  } catch {
    return {};
  }
}

function saveTicketStore(store) {
  localStorage.setItem(TICKET_HUB_KEY, JSON.stringify(store));
}

function getTicketMessages(appId) {
  const store = getTicketStore();
  return store[appId] || [];
}

function addTicketMessage(appId, senderRole, senderName, text, attachmentName = null) {
  const store = getTicketStore();
  if (!store[appId]) store[appId] = [];

  store[appId].push({
    id: Date.now(),
    role: senderRole, // "officer" | "student" | "system"
    sender: senderName,
    text: text,
    attachment: attachmentName,
    timestamp: new Date().toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })
  });

  saveTicketStore(store);
}

async function findApplicationById(appId) {
  const localMatch = getLocalApplications().find(
    a => String(a.application_id) === String(appId) || String(a.id) === String(appId)
  );
  if (localMatch) return localMatch;

  try {
    const { data } = await supabaseClient
      .from("applications")
      .select("*")
      .or(applicationIdFilter(appId))
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

async function openCommHub(appId) {
  activeTicketAppId = appId;
  const modal = document.getElementById("commHubModal");
  const titleEl = document.getElementById("commHubTitle");
  const metaEl = document.getElementById("commHubMeta");
  if (!modal) return;

  const app = await findApplicationById(appId);
  const displayId = app?.application_id || app?.id || appId;

  // Seed initial AI / Ministry query if ticket is empty and application has issues
  const existingMsgs = getTicketMessages(displayId);
  if (existingMsgs.length === 0) {
    if (app && Array.isArray(app.issues) && app.issues.length > 0) {
      addTicketMessage(
        displayId,
        "officer",
        "Ministry Nodal Desk (Automated Flag)",
        `Deficiency noted in application: ${app.issues.join(" | ")}. Please reply with clarification or re-upload the corrected document below.`
      );
    } else {
      addTicketMessage(
        displayId,
        "system",
        "TribalScholar Ticket Hub",
        "Two-way communication channel opened between Applicant and Ministry Nodal Officer."
      );
    }
  }

  const activeRole = currentProfile?.role === "officer" ? "Ministry Officer" : "Student Applicant";
  if (titleEl) titleEl.textContent = `Application Ticket #${displayId}`;
  if (metaEl) {
    metaEl.textContent = app
      ? `Applicant: ${app.name} · Scheme: ${app.scheme} · Status: ${app.status} · Posting as: ${activeRole}`
      : `Ticket ID: ${displayId} · Posting as: ${activeRole}`;
  }

  renderCommHubMessages(displayId);
  modal.classList.remove("hidden");
}

function closeCommHub() {
  document.getElementById("commHubModal")?.classList.add("hidden");
  activeTicketAppId = null;
}

function renderCommHubMessages(appId) {
  const listEl = document.getElementById("commHubMessages");
  if (!listEl) return;

  const msgs = getTicketMessages(appId);
  if (!msgs.length) {
    listEl.innerHTML = `<p class="muted small">No messages yet on this ticket.</p>`;
    return;
  }

  listEl.innerHTML = msgs
    .map(msg => {
      const roleLabel =
        msg.role === "officer"
          ? "🛡️ Ministry / Nodal Officer"
          : msg.role === "student"
          ? "🎓 Student Applicant"
          : "🤖 System Update";

      const attachmentHtml = msg.attachment
        ? `<div style="margin-top:6px; font-weight:600; color:#0f766e;">📎 Re-uploaded File: ${escapeHTML(msg.attachment)}</div>`
        : "";

      return `
        <div class="comm-bubble ${escapeHTML(msg.role)}">
          <div class="comm-bubble-meta">
            <span>${roleLabel} (${escapeHTML(msg.sender)})</span>
            <span>${escapeHTML(msg.timestamp)}</span>
          </div>
          <div>${escapeHTML(msg.text)}</div>
          ${attachmentHtml}
        </div>
      `;
    })
    .join("");

  listEl.scrollTop = listEl.scrollHeight;
}

async function handleTicketReply(event) {
  event.preventDefault();
  if (!activeTicketAppId) return;

  const input = document.getElementById("commReplyInput");
  const text = input?.value.trim();
  if (!text) return;

  const role = currentProfile?.role === "officer" ? "officer" : "student";
  const senderName = currentProfile?.full_name || currentUser?.email || (role === "officer" ? "Nodal Officer" : "Student");

  addTicketMessage(activeTicketAppId, role, senderName, text);
  input.value = "";
  renderCommHubMessages(activeTicketAppId);
}

async function sendQuickOfficerQuery(queryText) {
  if (!activeTicketAppId) return;
  const senderName = currentProfile?.full_name || "Nodal Officer";
  addTicketMessage(activeTicketAppId, "officer", senderName, queryText);
  renderCommHubMessages(activeTicketAppId);
}

async function handleTicketReupload(event) {
  event.preventDefault();
  if (!activeTicketAppId) return;

  const docType = document.getElementById("reuploadDocType")?.value || "Document";
  const fileInput = document.getElementById("reuploadDocFile");
  const file = fileInput?.files?.[0];

  if (!file) {
    alert("Please select a file to re-upload.");
    return;
  }

  const senderName = currentProfile?.full_name || currentUser?.email || "Student";

  // 1. Log the re-uploaded file inside the Two-Way Ticket Hub
  addTicketMessage(
    activeTicketAppId,
    "student",
    senderName,
    `Re-uploaded corrected ${docType} to resolve application deficiency.`,
    `${docType} — ${file.name}`
  );

  // 2. Automatically move status from "Deficient" -> "Under Review"
  const localApps = getLocalApplications();
  const idx = localApps.findIndex(
    a => String(a.application_id) === String(activeTicketAppId) || String(a.id) === String(activeTicketAppId)
  );
  if (idx !== -1) {
    localApps[idx].status = "Under Review";
    localApps[idx].pre_check = true;
    localApps[idx].review_note = `Student re-uploaded ${docType} (${file.name}) via Ticket Hub.`;
    localApps[idx].updated_at = new Date().toISOString();
    saveLocalApplications(localApps);
  }

  try {
    await supabaseClient
      .from("applications")
      .update({
        status: "Under Review",
        pre_check: true,
        review_note: `Student re-uploaded ${docType} (${file.name}) via Ticket Hub.`,
        updated_at: new Date().toISOString()
      })
      .or(applicationIdFilter(activeTicketAppId));
  } catch {}

  addTicketMessage(
    activeTicketAppId,
    "system",
    "Workflow Engine",
    `✓ ${docType} received! Application status automatically updated from Deficient to Under Review.`
  );

  fileInput.value = "";
  renderCommHubMessages(activeTicketAppId);

  // Refresh Track Page or Officer Table in background if open
  const metaEl = document.getElementById("commHubMeta");
  if (metaEl) {
    metaEl.textContent = metaEl.textContent.replace("Status: Deficient", "Status: Under Review");
  }
  if (document.getElementById("admin")?.classList.contains("active")) {
    await renderAdmin();
  }
  if (document.getElementById("track")?.classList.contains("active")) {
    const trackBtn = document.querySelector("#trackForm button[type='submit']");
    trackBtn?.click();
  }
}

// Auto-inject "💬 Ticket Hub & Re-upload" buttons into Track Application & Officer Portal
function injectCommHubButtons() {
  // 1. Inject into Track Application result card
  const trackResult = document.getElementById("trackingResult");
  if (trackResult) {
    const card = trackResult.querySelector(".result-card");
    if (card && !card.querySelector(".comm-hub-btn-injected")) {
      const appIdEl = card.querySelector(".result-line strong");
      const appId = appIdEl?.textContent?.trim();
      if (appId) {
        const msgCount = getTicketMessages(appId).length;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "primary-btn comm-hub-trigger-btn comm-hub-btn-injected";
        btn.style.marginTop = "12px";
        btn.innerHTML = `💬 Open Two-Way Ticket &amp; Re-Upload Hub ${msgCount ? `(${msgCount})` : ""}`;
        btn.onclick = () => openCommHub(appId);
        card.appendChild(btn);
      }
    }
  }

  // 2. Inject into Officer Portal rows
  const adminTable = document.getElementById("applicationsTable");
  if (adminTable) {
    adminTable.querySelectorAll("tr").forEach(row => {
      const firstCellStrong = row.querySelector("td:first-child strong");
      const preCheckCell = row.querySelector("td:nth-child(4)");
      if (firstCellStrong && preCheckCell && !preCheckCell.querySelector(".comm-hub-btn-injected")) {
        const appId = firstCellStrong.textContent.trim();
        const msgCount = getTicketMessages(appId).length;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "text-btn comm-hub-btn-injected";
        btn.style.display = "block";
        btn.style.marginTop = "4px";
        btn.innerHTML = `💬 Ticket Hub (${msgCount})`;
        btn.onclick = () => openCommHub(appId);
        preCheckCell.appendChild(btn);
      }
    });
  }
}

const commHubObserver = new MutationObserver(() => {
  injectCommHubButtons();
});

document.addEventListener("DOMContentLoaded", () => {
  const trackEl = document.getElementById("trackingResult");
  const adminEl = document.getElementById("applicationsTable");
  if (trackEl) commHubObserver.observe(trackEl, { childList: true, subtree: true });
  if (adminEl) commHubObserver.observe(adminEl, { childList: true, subtree: true });
});

window.openCommHub = openCommHub;
window.closeCommHub = closeCommHub;
window.handleTicketReply = handleTicketReply;
window.sendQuickOfficerQuery = sendQuickOfficerQuery;
window.handleTicketReupload = handleTicketReupload;
/* ===========================================================================
   TRIBALSCHOLAR — features.js
   1. Unified Scholarship Wallet
   2. Payment / DBT Tracker  (Sanctioned → Payment Initiated → DBT Processed → Credited)
   3. Grievance Management   (ticket ID, department assignment, resolution timeline)

   Loads AFTER script.js. Uses its globals: currentUser, currentProfile, ocrData,
   ELIGIBILITY_RULES, STUDY_BUDDY_KB, fetchAllApplicationsMerged, escapeHTML,
   formatDate, createStatusBadge, requireLogin, showPage, chooseScheme.
   Data is stored in localStorage (demo mode, no new Supabase tables needed).
   =========================================================================== */
(function () {
  "use strict";

  /* =========================================================
     0. STORAGE + SMALL HELPERS
     ========================================================= */
  const PAYMENTS_KEY = "tribalScholarPayments";
  const GRIEVANCE_KEY = "tribalScholarGrievances";
  const DOCVAULT_KEY = "tribalScholarDocVault";

  function readStore(key) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  function writeStore(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    // Mirror to Supabase for real sessions (js/data-service.js); no-op in demo mode
    window.DataService?.mirror(key, value);
  }

  async function pullStore(key) {
    if (window.DataService) await DataService.pull(key);
  }

  const $ = id => document.getElementById(id);
  const isOfficer = () => currentProfile?.role === "officer";
  const inr = n => "₹" + Number(n || 0).toLocaleString("en-IN");
  const when = iso => formatDate(iso);
  const rand = len => Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join("");
  const appKey = a => a.application_id || a.id;
  const lower = s => String(s || "").toLowerCase();
  const timeOf = iso => (iso ? new Date(iso).getTime() || 0 : 0);

  function isMine(item) {
    if (!currentUser) return false;
    if (item.user_id && item.user_id === currentUser.id) return true;
    if (item.userId && item.userId === currentUser.id) return true;
    return !!item.email && lower(item.email) === lower(currentUser.email);
  }

  function emptyState(text) {
    return `<div class="fx-empty">${escapeHTML(text)}</div>`;
  }

  /* Generic horizontal/vertical stepper used by DBT tracker + grievance timeline */
  function stepperHtml(steps, current) {
    const last = steps.length - 1;
    return `<div class="fx-steps">` + steps.map((s, i) => {
      const state = (i < current || (current === last && i === last))
        ? "done"
        : (i === current ? "current" : "todo");
      return `
        <div class="fx-step ${state}">
          <div class="fx-dot">${state === "done" ? "✓" : i + 1}</div>
          <div class="fx-step-label">${escapeHTML(s.label)}</div>
          <div class="fx-step-time">${state === "todo" ? "Pending" : escapeHTML(s.time || "In progress")}</div>
          ${s.desc ? `<div class="fx-step-desc">${escapeHTML(s.desc)}</div>` : ""}
        </div>`;
    }).join("") + `</div>`;
  }

  /* =========================================================
     1. PAYMENT / DBT TRACKER — DATA LAYER
     ========================================================= */
  const SCHEME_AMOUNTS = {
    NFST: 372000,   // demo sanction amount
    NOS: 1500000    // demo sanction amount
  };

  const PAYMENT_STAGES = [
    { label: "Sanctioned",        desc: "Sanction order issued after approval" },
    { label: "Payment Initiated", desc: "Payment file sent to treasury / PFMS" },
    { label: "DBT Processed",     desc: "Bank processed the Direct Benefit Transfer" },
    { label: "Credited",          desc: "Amount credited to the student's bank account" }
  ];

  function paymentRef(stage) {
    const y = new Date().getFullYear();
    if (stage === 0) return `SO/${y}/${rand(5)}`;
    if (stage === 1) return `PFMS-${y}-${rand(8)}`;
    if (stage === 2) return `DBT-${rand(10)}`;
    return `UTR${rand(12)}`;
  }

  /* Every approved application automatically gets a payment record at stage 0 */
  function syncPayments(allApps) {
    const pays = readStore(PAYMENTS_KEY);
    let changed = false;

    allApps
      .filter(a => a.status === "Approved (Demo)")
      .forEach(a => {
        const id = appKey(a);
        if (pays.some(p => p.applicationId === id)) return;

        const now = new Date().toISOString();
        let payId = "PAY" + rand(6);
        while (pays.some(p => p.id === payId)) payId = "PAY" + rand(6);
        const sanctionOrder = paymentRef(0);

        pays.push({
          id: payId,
          applicationId: id,
          scheme: a.scheme,
          studentName: a.name,
          userId: a.user_id || null,
          email: a.email || "",
          amount: SCHEME_AMOUNTS[a.scheme] || 100000,
          stage: 0,
          sanctionOrder,
          history: [{ stage: 0, at: now, ref: sanctionOrder, note: PAYMENT_STAGES[0].desc }]
        });
        changed = true;
      });

    if (changed) writeStore(PAYMENTS_KEY, pays);
    return pays;
  }

  function advancePayment(id) {
    if (!isOfficer()) {
      alert("Only officers can update payment stages.");
      return;
    }
    const pays = readStore(PAYMENTS_KEY);
    const p = pays.find(x => x.id === id);
    if (!p || p.stage >= 3) return;

    const note = $("fx-paynote-" + id)?.value.trim() || "";
    p.stage += 1;
    p.history.push({
      stage: p.stage,
      at: new Date().toISOString(),
      ref: paymentRef(p.stage),
      note: note || PAYMENT_STAGES[p.stage].desc
    });
    writeStore(PAYMENTS_KEY, pays);
    renderPayments();
  }

  function stageBadge(stage) {
    return `<span class="fx-badge stage-${stage}">${escapeHTML(PAYMENT_STAGES[stage].label)}</span>`;
  }

  function lastUpdate(p) {
    return p.history[p.history.length - 1]?.at || null;
  }

  function paymentCard(p, officerView) {
    const steps = PAYMENT_STAGES.map((s, i) => {
      const h = p.history.find(x => x.stage === i);
      return { label: s.label, desc: s.desc, time: h ? when(h.at) : "" };
    });

    const historyRows = p.history.map(h => `
      <li>
        <strong>${escapeHTML(PAYMENT_STAGES[h.stage].label)}</strong>
        · ${escapeHTML(when(h.at))}
        · Ref: <code>${escapeHTML(h.ref)}</code>
        ${h.note ? `<div class="muted small-note">${escapeHTML(h.note)}</div>` : ""}
      </li>`).join("");

    const next = PAYMENT_STAGES[p.stage + 1];
    const action = officerView && next
      ? `
        <div class="fx-officer-box">
          <input type="text" id="fx-paynote-${escapeHTML(p.id)}" placeholder="Optional remark for this stage">
          <button type="button" class="primary-btn"
            data-fx-action="advance-payment" data-id="${escapeHTML(p.id)}">
            Mark as ${escapeHTML(next.label)} →
          </button>
        </div>`
      : "";

    return `
      <article class="panel fx-card">
        <div class="fx-card-head">
          <div>
            <span class="eyebrow">PAYMENT ${escapeHTML(p.id)}</span>
            <h3>${escapeHTML(ELIGIBILITY_RULES[p.scheme]?.name || p.scheme)}</h3>
            <p class="muted">
              ${officerView ? escapeHTML(p.studentName) + " · " : ""}Application ${escapeHTML(p.applicationId)}
              · Sanction order <code>${escapeHTML(p.sanctionOrder)}</code>
            </p>
          </div>
          <div class="fx-amount">${inr(p.amount)}${stageBadge(p.stage)}</div>
        </div>
        ${stepperHtml(steps, p.stage)}
        ${window.GovIntegrations ? GovIntegrations.PFMS.cardHtml(p, officerView) : ""}
        <details class="fx-details">
          <summary>Transaction history &amp; reference numbers</summary>
          <ul class="fx-history">${historyRows}</ul>
        </details>
        ${action}
      </article>`;
  }

  async function renderPayments() {
    const box = $("paymentsContent");
    if (!box) return;
    box.innerHTML = `<div class="panel muted">Loading payments…</div>`;

    await pullStore(PAYMENTS_KEY);
    const all = await fetchAllApplicationsMerged();
    let pays = syncPayments(all);
    const officerView = isOfficer();
    if (!officerView) pays = pays.filter(isMine);

    pays = [...pays].sort((a, b) => timeOf(lastUpdate(b)) - timeOf(lastUpdate(a)));

    const sum = list => list.reduce((t, p) => t + p.amount, 0);
    const byStage = s => pays.filter(p => p.stage === s);

    const summary = `
      <div class="fx-summary">
        ${PAYMENT_STAGES.map((s, i) => `
          <div class="fx-summary-card stage-${i}">
            <strong>${byStage(i).length}</strong>
            <span>${escapeHTML(s.label)}</span>
            <small>${inr(sum(byStage(i)))}</small>
          </div>`).join("")}
      </div>`;

    const intro = officerView
      ? `<div class="fx-intro-row">
           <p class="muted">Officer view: move each sanctioned payment forward through the DBT pipeline, or pull the latest status from PFMS. Students see updates instantly.</p>
           ${pays.some(p => p.stage < 3) ? `<button type="button" class="secondary-btn" data-fx-action="pfms-sync-all">🔄 Sync all with PFMS</button>` : ""}
         </div>`
      : `<p class="muted">Track every sanctioned scholarship payment from sanction to bank credit. Payments appear here once an application is approved.</p>`;

    const cards = pays.length
      ? pays.map(p => paymentCard(p, officerView)).join("")
      : `<div class="panel">${emptyState(
          officerView
            ? "No approved applications yet. Approve an application in the Officer Portal to generate a payment."
            : "No sanctioned payments yet. Once an officer approves your application, its payment will show up here."
        )}</div>`;

    box.innerHTML = intro + summary + cards + `
      <div class="notice">
        <strong>Prototype notice:</strong> This is a simulated DBT pipeline. Amounts and reference
        numbers are sample data and are not linked to PFMS or any real bank.
      </div>`;
  }

  /* =========================================================
     2. GRIEVANCE MANAGEMENT
     ========================================================= */
  const GRIEVANCE_CATEGORIES = {
    application: { label: "Application / Document issue", department: "Scholarship Verification Cell", sla: 5,  priority: "Normal" },
    payment:     { label: "Payment / DBT delay",           department: "Finance & DBT Cell",           sla: 7,  priority: "High" },
    eligibility: { label: "Eligibility / Rule dispute",    department: "Nodal Officer — Scheme Section", sla: 10, priority: "Normal" },
    technical:   { label: "Portal / Technical problem",    department: "IT Support Desk",              sla: 3,  priority: "Normal" },
    institution: { label: "Institution / College issue",   department: "Institutional Nodal Officer",  sla: 7,  priority: "Normal" },
    other:       { label: "Other",                         department: "General Grievance Cell",       sla: 10, priority: "Low" }
  };

  const DEPARTMENTS = [...new Set(Object.values(GRIEVANCE_CATEGORIES).map(c => c.department))];
  const GRIEVANCE_STATUSES = ["Assigned", "In Progress", "Resolved"];
  const GRIEVANCE_STEPS = ["Raised", "Assigned", "In Progress", "Resolved"];

  function isOverdue(t) {
    return t.status !== "Resolved" && Date.now() > timeOf(t.dueAt);
  }

  function createTicketId(list) {
    const yy = String(new Date().getFullYear()).slice(-2);
    let n = 1001 + list.length;
    let id = `GRV${yy}${n}`;
    while (list.some(t => t.ticketId === id)) {
      n += 1;
      id = `GRV${yy}${n}`;
    }
    return id;
  }

  function updateRoutingPreview() {
    const cat = GRIEVANCE_CATEGORIES[$("grvCategory")?.value];
    const box = $("grvRouting");
    if (!box) return;
    if (!cat) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = `Will be routed to <strong>${escapeHTML(cat.department)}</strong>
      · target resolution within <strong>${cat.sla} days</strong>`;
    const pr = $("grvPriority");
    if (pr && !pr.dataset.touched) pr.value = cat.priority;
  }

  async function handleGrievanceSubmit(event) {
    event.preventDefault();
    if (!(await requireLogin())) return;

    const catKey = $("grvCategory").value;
    const cat = GRIEVANCE_CATEGORIES[catKey];
    const subject = $("grvSubject").value.trim();
    const description = $("grvDescription").value.trim();
    const msg = $("grvMessage");

    if (!cat || !subject || description.length < 10) {
      msg.textContent = "Please choose a category, add a subject and describe the issue (at least 10 characters).";
      msg.className = "message error";
      return;
    }

    const list = readStore(GRIEVANCE_KEY);
    const now = new Date();
    const nowIso = now.toISOString();
    const due = new Date(now.getTime() + cat.sla * 86400000).toISOString();
    const ticketId = createTicketId(list);

    list.unshift({
      ticketId,
      userId: currentUser.id,
      email: currentUser.email,
      studentName: currentProfile?.full_name || currentUser.email,
      category: catKey,
      subject,
      description,
      priority: $("grvPriority").value,
      applicationId: $("grvApplication").value || "",
      department: cat.department,
      status: "Assigned",
      createdAt: nowIso,
      dueAt: due,
      resolvedAt: null,
      response: "",
      history: [
        { status: "Raised", at: nowIso, note: "Grievance registered by student", by: "Student" },
        { status: "Assigned", at: nowIso, note: `Auto-assigned to ${cat.department}`, by: "System" }
      ]
    });
    writeStore(GRIEVANCE_KEY, list);

    msg.textContent = `Grievance registered! Ticket ID: ${ticketId} · Assigned to ${cat.department} · Target resolution by ${new Date(due).toLocaleDateString("en-IN", { dateStyle: "medium" })}.`;
    msg.className = "message success";

    $("grievanceForm").reset();
    const pr = $("grvPriority");
    if (pr) delete pr.dataset.touched;
    updateRoutingPreview();
    renderGrievanceList();
  }

  function saveTicket(id) {
    if (!isOfficer()) {
      alert("Only officers can update grievances.");
      return;
    }
    const list = readStore(GRIEVANCE_KEY);
    const t = list.find(x => x.ticketId === id);
    if (!t) return;

    const status = $("fx-gs-" + id).value;
    const dept = $("fx-gd-" + id).value;
    const note = $("fx-gr-" + id).value.trim();
    const now = new Date().toISOString();
    const by = currentProfile?.full_name || "Officer";

    if (dept !== t.department) {
      t.history.push({ status: t.status, at: now, note: `Reassigned from ${t.department} to ${dept}`, by });
      t.department = dept;
    }
    if (status !== t.status) {
      t.status = status;
      t.resolvedAt = status === "Resolved" ? now : null;
      t.history.push({ status, at: now, note: note || `Status changed to ${status}`, by });
    } else if (note) {
      t.history.push({ status: t.status, at: now, note, by });
    }
    if (note) t.response = note;

    writeStore(GRIEVANCE_KEY, list);
    renderGrievanceList();
  }

  function reopenTicket(id) {
    const list = readStore(GRIEVANCE_KEY);
    const t = list.find(x => x.ticketId === id);
    if (!t || t.status !== "Resolved") return;
    const now = new Date();
    t.status = "Assigned";
    t.resolvedAt = null;
    t.dueAt = new Date(now.getTime() + 3 * 86400000).toISOString();
    t.history.push({ status: "Assigned", at: now.toISOString(), note: "Reopened by student — fresh 3-day target set", by: "Student" });
    writeStore(GRIEVANCE_KEY, list);
    renderGrievanceList();
  }

  function ticketCard(t, officerView) {
    const cat = GRIEVANCE_CATEGORIES[t.category];
    const current = Math.max(GRIEVANCE_STEPS.indexOf(t.status), 0);
    const steps = GRIEVANCE_STEPS.map(label => {
      const h = t.history.find(x => x.status === label);
      return { label, time: h ? when(h.at) : "" };
    });
    const overdue = isOverdue(t);

    const historyRows = t.history.map(h => `
      <li>
        <strong>${escapeHTML(h.status)}</strong> · ${escapeHTML(when(h.at))} · ${escapeHTML(h.by || "")}
        <div class="muted small-note">${escapeHTML(h.note)}</div>
      </li>`).join("");

    const officerBox = officerView
      ? `
        <div class="fx-officer-box grid">
          <select id="fx-gs-${escapeHTML(t.ticketId)}" aria-label="Status">
            ${GRIEVANCE_STATUSES.map(s => `<option ${t.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
          <select id="fx-gd-${escapeHTML(t.ticketId)}" aria-label="Department">
            ${DEPARTMENTS.map(d => `<option ${t.department === d ? "selected" : ""}>${escapeHTML(d)}</option>`).join("")}
          </select>
          <input type="text" id="fx-gr-${escapeHTML(t.ticketId)}" placeholder="Response / resolution note for the student">
          <button type="button" class="primary-btn" data-fx-action="save-ticket" data-id="${escapeHTML(t.ticketId)}">Update Ticket</button>
        </div>`
      : (t.status === "Resolved"
          ? `<button type="button" class="secondary-btn" data-fx-action="reopen-ticket" data-id="${escapeHTML(t.ticketId)}">Not satisfied? Reopen</button>`
          : "");

    return `
      <article class="panel fx-card">
        <div class="fx-card-head">
          <div>
            <span class="eyebrow">TICKET ${escapeHTML(t.ticketId)}</span>
            <h3>${escapeHTML(t.subject)}</h3>
            <p class="muted">
              ${officerView ? escapeHTML(t.studentName) + " · " : ""}${escapeHTML(cat?.label || t.category)}
              ${t.applicationId ? " · Application " + escapeHTML(t.applicationId) : ""}
            </p>
          </div>
          <div class="fx-badges">
            <span class="fx-badge grv-${lower(t.status).replace(/\s+/g, "-")}">${escapeHTML(t.status)}</span>
            <span class="fx-badge prio-${lower(t.priority)}">${escapeHTML(t.priority)} priority</span>
            ${overdue ? `<span class="fx-badge overdue">⏰ Overdue — escalated</span>` : ""}
          </div>
        </div>

        <div class="fx-meta">
          <div><span>Department</span><strong>${escapeHTML(t.department)}</strong></div>
          <div><span>Raised</span><strong>${escapeHTML(when(t.createdAt))}</strong></div>
          <div><span>${t.status === "Resolved" ? "Resolved" : "Target resolution"}</span>
            <strong>${escapeHTML(when(t.status === "Resolved" ? t.resolvedAt : t.dueAt))}</strong></div>
        </div>

        <p class="fx-desc">${escapeHTML(t.description)}</p>
        ${stepperHtml(steps, current)}
        ${t.response ? `<div class="fx-response"><strong>Latest response:</strong> ${escapeHTML(t.response)}</div>` : ""}

        <details class="fx-details">
          <summary>Full activity log</summary>
          <ul class="fx-history">${historyRows}</ul>
        </details>
        ${officerBox}
      </article>`;
  }

  function renderGrievanceList() {
    const box = $("grievanceList");
    if (!box) return;

    const officerView = isOfficer();
    let list = readStore(GRIEVANCE_KEY);
    if (!officerView) list = list.filter(isMine);

    const q = lower($("grvSearch")?.value.trim());
    const visible = list.filter(t =>
      !q || [t.ticketId, t.subject, t.department, t.status].some(v => lower(v).includes(q))
    );

    const count = s => list.filter(t => t.status === s).length;
    const overdue = list.filter(isOverdue).length;

    const stats = `
      <div class="fx-summary">
        <div class="fx-summary-card"><strong>${list.length}</strong><span>Total tickets</span></div>
        <div class="fx-summary-card"><strong>${count("Assigned")}</strong><span>Assigned</span></div>
        <div class="fx-summary-card"><strong>${count("In Progress")}</strong><span>In progress</span></div>
        <div class="fx-summary-card"><strong>${count("Resolved")}</strong><span>Resolved</span></div>
        <div class="fx-summary-card overdue"><strong>${overdue}</strong><span>Overdue</span></div>
      </div>`;

    box.innerHTML = stats + (visible.length
      ? visible.map(t => ticketCard(t, officerView)).join("")
      : `<div class="panel">${emptyState(
          list.length ? "No tickets match your search." : "No grievances yet. Use the form above to raise one."
        )}</div>`);
  }

  async function renderGrievance() {
    await pullStore(GRIEVANCE_KEY);
    const cat = $("grvCategory");
    if (cat) {
      const prev = cat.value;
      cat.innerHTML = `<option value="">Select a category</option>` +
        Object.entries(GRIEVANCE_CATEGORIES)
          .map(([k, c]) => `<option value="${k}">${escapeHTML(c.label)}</option>`).join("");
      cat.value = prev;
    }

    const appSel = $("grvApplication");
    if (appSel) {
      const prev = appSel.value;
      const apps = (await fetchAllApplicationsMerged()).filter(isMine);
      appSel.innerHTML = `<option value="">Not linked to an application</option>` +
        apps.map(a => `<option value="${escapeHTML(appKey(a))}">${escapeHTML(appKey(a))} — ${escapeHTML(a.scheme)}</option>`).join("");
      appSel.value = prev;
    }

    const title = $("grvListTitle");
    if (title) title.textContent = isOfficer() ? "All Grievances (Officer View)" : "My Grievances";

    updateRoutingPreview();
    renderGrievanceList();
  }

  /* =========================================================
     3. UNIFIED SCHOLARSHIP WALLET
     ========================================================= */
  const DOC_FIELDS = [
    { id: "stCertificate",     type: "ST Certificate",     ocr: "stCertificate" },
    { id: "marksheet",         type: "Marksheet",          ocr: "marksheet" },
    { id: "incomeCertificate", type: "Income Certificate", ocr: "incomeCertificate" },
    { id: "offerLetter",       type: "Offer Letter",       ocr: null }
  ];

  /* Remember uploaded documents when the application form is submitted */
  function captureDocuments() {
    if (!currentUser) return;
    const scheme = $("scheme")?.value || "";
    const vault = readStore(DOCVAULT_KEY);
    const now = new Date().toISOString();

    DOC_FIELDS.forEach(f => {
      const file = $(f.id)?.files?.[0];
      if (!file) return;
      vault.unshift({
        userId: currentUser.id,
        email: currentUser.email,
        type: f.type,
        filename: file.name,
        sizeKb: Math.max(1, Math.round(file.size / 1024)),
        scheme,
        at: now,
        confidence: f.ocr && ocrData[f.ocr] ? ocrData[f.ocr].confidence : null
      });
    });
    writeStore(DOCVAULT_KEY, vault.slice(0, 200));
  }

  document.addEventListener("submit", event => {
    if (event.target && event.target.id === "applicationForm") captureDocuments();
  }, true);

  async function collectDocuments(apps) {
    const docs = readStore(DOCVAULT_KEY).filter(isMine).map(d => ({
      type: d.type,
      filename: d.filename,
      at: d.at,
      scheme: d.scheme,
      confidence: d.confidence,
      source: "This device"
    }));

    // Real Supabase users: also list files stored in the private bucket
    if (currentUser && !currentUser.is_fallback) {
      const ids = apps.map(a => a.id).filter(id => id && !String(id).startsWith("TS"));
      if (ids.length) {
        try {
          const { data } = await supabaseClient
            .from("application_documents")
            .select("*")
            .in("application_id", ids);
          (data || []).forEach(d => {
            if (docs.some(x => x.type === d.document_type && x.filename === d.original_filename)) return;
            const parent = apps.find(a => a.id === d.application_id);
            docs.push({
              type: d.document_type,
              filename: d.original_filename,
              at: d.uploaded_at || d.created_at || null,
              scheme: parent?.scheme || "",
              confidence: null,
              source: "Secure storage"
            });
          });
        } catch (e) {
          console.warn("Could not load stored documents:", e);
        }
      }
    }
    return docs.sort((a, b) => timeOf(b.at) - timeOf(a.at));
  }

  function walletId() {
    const raw = String(currentUser?.id || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
    return "TSW-" + (raw.slice(-8) || "00000000");
  }

  function initials(name) {
    return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2)
      .map(w => w[0].toUpperCase()).join("") || "?";
  }

  async function renderWallet() {
    const box = $("walletContent");
    if (!box) return;
    box.innerHTML = `<div class="panel muted">Loading your wallet…</div>`;

    await Promise.all([pullStore(PAYMENTS_KEY), pullStore(GRIEVANCE_KEY)]);
    const all = await fetchAllApplicationsMerged();
    const allPays = syncPayments(all);
    const apps = all.filter(isMine).sort((a, b) => timeOf(b.submitted_at) - timeOf(a.submitted_at));
    const pays = allPays.filter(isMine);
    const grvs = readStore(GRIEVANCE_KEY).filter(isMine);
    const docs = await collectDocuments(apps);

    const name = currentProfile?.full_name || currentUser.email;
    const role = currentProfile?.role || "student";
    const sanctioned = pays.reduce((t, p) => t + p.amount, 0);
    const credited = pays.filter(p => p.stage === 3).reduce((t, p) => t + p.amount, 0);
    const awaiting = sanctioned - credited;
    const approved = apps.filter(a => a.status === "Approved (Demo)").length;
    const openGrv = grvs.filter(t => t.status !== "Resolved").length;
    const payOf = a => pays.find(p => p.applicationId === appKey(a));

    /* Header + summary */
    const header = `
      <div class="panel fx-wallet-head">
        <div class="fx-avatar">${escapeHTML(initials(name))}</div>
        <div class="fx-wallet-id">
          <h2>${escapeHTML(name)}</h2>
          <p class="muted">${escapeHTML(currentUser.email || "")} · Wallet ID <code>${escapeHTML(walletId())}</code>
            · <span class="user-role">${escapeHTML(role)}</span></p>
        </div>
        <div class="fx-quick">
          <button type="button" class="secondary-btn" data-fx-action="goto" data-page="apply">+ New Application</button>
          <button type="button" class="secondary-btn" data-fx-action="goto" data-page="payments">View Payments</button>
          <button type="button" class="secondary-btn" data-fx-action="goto" data-page="grievance">Raise Grievance</button>
        </div>
      </div>
      ${role === "officer" ? `<div class="notice">You are signed in as an officer. The wallet shows your own student profile — switch to a student account to see a full wallet.</div>` : ""}
      <div class="fx-summary">
        <div class="fx-summary-card"><strong>${apps.length}</strong><span>Applications</span></div>
        <div class="fx-summary-card stage-3"><strong>${approved}</strong><span>Approved</span></div>
        <div class="fx-summary-card"><strong>${inr(sanctioned)}</strong><span>Total sanctioned</span></div>
        <div class="fx-summary-card stage-3"><strong>${inr(credited)}</strong><span>Credited to bank</span></div>
        <div class="fx-summary-card stage-1"><strong>${inr(awaiting)}</strong><span>Awaiting credit</span></div>
        <div class="fx-summary-card ${openGrv ? "overdue" : ""}"><strong>${openGrv}</strong><span>Open grievances</span></div>
      </div>`;

    /* Scholarships */
    const schemeCards = Object.entries(ELIGIBILITY_RULES).map(([key, rule]) => {
      const mine = apps.filter(a => a.scheme === key);
      const latest = mine[0];
      const pay = latest ? payOf(latest) : null;
      return `
        <div class="fx-scheme">
          <span class="pill">${escapeHTML(key)}</span>
          <h3>${escapeHTML(rule.name)}</h3>
          ${latest
            ? `<div class="fx-scheme-row"><span>Latest application</span><strong>${escapeHTML(appKey(latest))}</strong></div>
               <div class="fx-scheme-row"><span>Status</span>${createStatusBadge(latest.status)}</div>
               <div class="fx-scheme-row"><span>Payment</span>${pay ? stageBadge(pay.stage) : "<em>Not sanctioned yet</em>"}</div>
               ${pay ? `<div class="fx-scheme-row"><span>Amount</span><strong>${inr(pay.amount)}</strong></div>` : ""}
               <button type="button" class="text-btn" data-fx-action="goto" data-page="track">Track application →</button>`
            : `<p class="muted">You haven't applied for this scheme yet.</p>
               <button type="button" class="primary-btn" data-fx-action="apply" data-scheme="${escapeHTML(key)}">Apply now →</button>`}
        </div>`;
    }).join("");

    /* Applications table */
    const appRows = apps.map(a => {
      const pay = payOf(a);
      const issues = Array.isArray(a.issues) ? a.issues.length : 0;
      return `
        <tr>
          <td><strong>${escapeHTML(appKey(a))}</strong></td>
          <td>${escapeHTML(a.scheme)}</td>
          <td>${escapeHTML(when(a.submitted_at))}</td>
          <td>${createStatusBadge(a.status)}</td>
          <td>${issues ? `${issues} issue(s)` : "Clean"}</td>
          <td>${pay ? stageBadge(pay.stage) : "—"}</td>
        </tr>`;
    }).join("");

    /* Documents table */
    const docRows = docs.map(d => `
      <tr>
        <td><strong>${escapeHTML(d.type)}</strong></td>
        <td>${escapeHTML(d.filename)}</td>
        <td>${escapeHTML(d.scheme || "—")}</td>
        <td>${d.confidence != null ? escapeHTML(d.confidence + "% OCR") : "—"}</td>
        <td>${escapeHTML(when(d.at))}</td>
        <td>${escapeHTML(d.source)}</td>
      </tr>`).join("");

    /* Payments table */
    const payRows = pays.map(p => `
      <tr>
        <td><strong>${escapeHTML(p.id)}</strong></td>
        <td>${escapeHTML(p.applicationId)}</td>
        <td>${inr(p.amount)}</td>
        <td>${stageBadge(p.stage)}</td>
        <td>${escapeHTML(when(lastUpdate(p)))}</td>
      </tr>`).join("");

    /* Grievances table */
    const grvRows = grvs.map(t => `
      <tr>
        <td><strong>${escapeHTML(t.ticketId)}</strong></td>
        <td>${escapeHTML(t.subject)}</td>
        <td>${escapeHTML(t.department)}</td>
        <td><span class="fx-badge grv-${lower(t.status).replace(/\s+/g, "-")}">${escapeHTML(t.status)}</span></td>
        <td>${escapeHTML(when(t.status === "Resolved" ? t.resolvedAt : t.dueAt))}</td>
      </tr>`).join("");

    /* Unified activity feed */
    const events = [];
    apps.forEach(a => {
      events.push({ at: a.submitted_at, icon: "📝", text: `Application ${appKey(a)} submitted for ${a.scheme}` });
      if (a.status !== "Submitted" && a.updated_at && a.updated_at !== a.submitted_at) {
        events.push({ at: a.updated_at, icon: "🔄", text: `Application ${appKey(a)} marked ${a.status}` });
      }
    });
    docs.forEach(d => events.push({ at: d.at, icon: "📄", text: `${d.type} uploaded (${d.filename})` }));
    pays.forEach(p => p.history.forEach(h =>
      events.push({ at: h.at, icon: "💸", text: `${PAYMENT_STAGES[h.stage].label}: ${inr(p.amount)} for ${p.applicationId}` })));
    grvs.forEach(t => t.history.forEach(h =>
      events.push({ at: h.at, icon: "🎫", text: `Ticket ${t.ticketId} — ${h.status}: ${h.note}` })));
    events.sort((a, b) => timeOf(b.at) - timeOf(a.at));

    const feed = events.length
      ? `<ul class="fx-feed">${events.slice(0, 12).map(e => `
          <li><span class="fx-feed-icon">${e.icon}</span>
            <div><strong>${escapeHTML(e.text)}</strong><small>${escapeHTML(when(e.at))}</small></div></li>`).join("")}</ul>`
      : emptyState("No activity yet. Apply for a scholarship to get started.");

    const table = (heads, rows, empty) => rows
      ? `<div class="table-wrap"><table><thead><tr>${heads.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`
      : emptyState(empty);

    box.innerHTML = `
      ${header}

      <div class="panel">
        <span class="eyebrow">SCHOLARSHIPS</span>
        <h2>My Scholarship Schemes</h2>
        <div class="fx-scheme-grid">${schemeCards}</div>
      </div>

      <div class="panel">
        <span class="eyebrow">APPLICATIONS</span>
        <h2>My Applications</h2>
        ${table(["Application", "Scheme", "Submitted", "Status", "Pre-check", "Payment"], appRows, "No applications yet.")}
      </div>

      <div class="panel">
        <span class="eyebrow">DOCUMENT VAULT</span>
        <h2>My Documents</h2>
        ${table(["Type", "File", "Scheme", "OCR", "Uploaded", "Stored in"], docRows, "No documents uploaded yet.")}
      </div>

      <div class="panel">
        <span class="eyebrow">PAYMENTS · DBT</span>
        <h2>My Payments</h2>
        ${table(["Payment ID", "Application", "Amount", "Stage", "Last update"], payRows, "No payments sanctioned yet.")}
      </div>

      <div class="panel">
        <span class="eyebrow">GRIEVANCES</span>
        <h2>My Grievance Tickets</h2>
        ${table(["Ticket", "Subject", "Department", "Status", "Due / Resolved"], grvRows, "No grievances raised.")}
      </div>

      <div class="panel">
        <span class="eyebrow">ACTIVITY</span>
        <h2>Recent Activity</h2>
        ${feed}
      </div>`;
  }

  /* =========================================================
     4. WIRING: navigation, events, Study Buddy
     ========================================================= */
  const FX_PAGES = {
    wallet: renderWallet,
    payments: renderPayments,
    grievance: renderGrievance
  };

  // Wrap showPage so the new pages require login and render fresh data
  const originalShowPage = window.showPage;
  window.showPage = async function (pageId) {
    if (FX_PAGES[pageId]) {
      const ok = await requireLogin();
      if (!ok) return;
    }
    await originalShowPage(pageId);
    if (FX_PAGES[pageId]) await FX_PAGES[pageId]();
  };

  document.addEventListener("click", event => {
    const el = event.target.closest("[data-fx-action]");
    if (!el) return;
    const action = el.dataset.fxAction;
    if (action === "goto") window.showPage(el.dataset.page);
    if (action === "apply") chooseScheme(el.dataset.scheme);
    if (action === "advance-payment") advancePayment(el.dataset.id);
    if (action === "save-ticket") saveTicket(el.dataset.id);
    if (action === "reopen-ticket") reopenTicket(el.dataset.id);
  });

  $("grievanceForm")?.addEventListener("submit", handleGrievanceSubmit);
  $("grvCategory")?.addEventListener("change", updateRoutingPreview);
  $("grvPriority")?.addEventListener("change", e => { e.target.dataset.touched = "1"; });
  $("grvSearch")?.addEventListener("input", renderGrievanceList);

  // Hooks for js/gov-integrations.js (PFMS sync)
  window.TSFeatures = {
    readPayments: () => readStore(PAYMENTS_KEY),
    writePayments: pays => writeStore(PAYMENTS_KEY, pays),
    renderPayments
  };

  // Teach Study Buddy about the new features
  if (typeof STUDY_BUDDY_KB !== "undefined") {
    STUDY_BUDDY_KB.push(
      {
        id: "wallet",
        keywords: ["wallet", "scholarship wallet", "my profile", "my documents", "all my scholarships"],
        answer:
          "The Scholarship Wallet is your one-stop profile: all your schemes, applications, uploaded documents, payments and grievance tickets in one place, plus a recent-activity feed. Open the \"Wallet\" tab after logging in."
      },
      {
        id: "payments",
        keywords: ["payment", "payments", "dbt", "credited", "when will i get money", "payment status", "stipend", "scholarship money", "bank credit"],
        answer:
          "Once an application is approved, its payment moves through 4 stages:\n1. Sanctioned\n2. Payment Initiated\n3. DBT Processed\n4. Credited\n\nOpen the \"Payments\" tab to see the live tracker and reference numbers. This is a simulated pipeline for the demo."
      },
      {
        id: "grievance",
        keywords: ["grievance", "complaint", "complain", "ticket", "raise issue", "raise a complaint", "report a problem"],
        answer:
          "To raise a complaint, open the \"Grievance\" tab, pick a category and describe the issue. You'll get a ticket ID, it is auto-assigned to the right department, and you can follow the resolution timeline. Overdue tickets are flagged as escalated, and resolved tickets can be reopened."
      }
    );
  }
})();


/* =========================================================
   14. MENTOR SUPPORT (client-side, localStorage-backed)
   • Guided upload checklist with per-document mentor tips +
     "flag for help"
   • Community endorsement (endorse an application; count + names
     shown to the officer)
   • Discrepancy / help alerts routed to a mentor
   ========================================================= */
(function () {
  "use strict";

  const esc = window.escapeHTML || (s => String(s == null ? "" : s));
  const ENDORSE_KEY = "tribalScholarEndorsements";
  const ALERT_KEY = "tribalScholarMentorAlerts";
  const FLAG_KEY = "tribalScholarDocHelpFlags";

  function read(key) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value.slice(-200)));
    } catch {}
  }
  function nowIso() {
    return new Date().toISOString();
  }
  function fmt(iso) {
    return typeof formatDate === "function" ? formatDate(iso) : new Date(iso).toLocaleString();
  }

  /* ---- Guided upload checklist content (mentor tips per document) ---- */
  const CHECKLIST = [
    {
      id: "stCertificate",
      title: "ST / Caste Certificate",
      tips: [
        "Use the certificate issued by the competent authority (Tehsildar/SDM).",
        "Make sure the name exactly matches your application and marksheet.",
        "Scan flat in good light — no glare, all four corners visible."
      ]
    },
    {
      id: "marksheet",
      title: "Marksheet / Academic Record",
      tips: [
        "Upload the latest qualifying exam marksheet.",
        "Both percentage/CGPA and total marks should be clearly readable.",
        "If your board shows CGPA, that's fine — the portal converts it."
      ]
    },
    {
      id: "incomeCertificate",
      title: "Income Certificate",
      tips: [
        "Must be recent (usually within the last 1 year).",
        "Annual family income figure should be clearly visible.",
        "Issued by the revenue authority, not a self-declaration."
      ]
    },
    {
      id: "offerLetter",
      title: "University Offer Letter (NOS only)",
      tips: [
        "Needed only for the National Overseas Scholarship (NOS).",
        "Should show your name, the university and the course.",
        "A clear PDF from the university is best."
      ]
    }
  ];

  /* ---- Doc-help flags ---- */
  function getFlags() {
    return read(FLAG_KEY);
  }
  function toggleFlag(docId, title) {
    const flags = getFlags();
    const idx = flags.findIndex(f => f.docId === docId);
    if (idx !== -1) {
      flags.splice(idx, 1);
      write(FLAG_KEY, flags);
      renderMentorPage();
      return;
    }
    flags.push({ docId, title, at: nowIso() });
    write(FLAG_KEY, flags);
    // A flagged document is also a mentor alert.
    mentorRaiseAlert("help", (window.currentUserEmail || "A student"),
      `Requested help with: ${title}`);
    renderMentorPage();
  }
  window.mentorToggleFlag = toggleFlag;

  function renderChecklist() {
    const box = document.getElementById("mentorChecklist");
    if (!box) return;
    const flags = getFlags();
    box.innerHTML = CHECKLIST.map(item => {
      const flagged = flags.some(f => f.docId === item.id);
      const tips = item.tips.map(t => `<li>${esc(t)}</li>`).join("");
      return `
        <div class="mentor-doc ${flagged ? "flagged" : ""}">
          <div class="mentor-doc-head">
            <strong>${esc(item.title)}</strong>
            <button type="button" class="text-btn"
              onclick="mentorToggleFlag('${esc(item.id)}', '${esc(item.title).replace(/'/g, "\\'")}')">
              ${flagged ? "✓ Help requested — cancel" : "🙋 Flag for mentor help"}
            </button>
          </div>
          <ul class="mentor-tips">${tips}</ul>
        </div>`;
    }).join("");
  }

  /* ---- Community endorsement ---- */
  function getEndorsements() {
    return read(ENDORSE_KEY);
  }
  function endorsementsFor(appId) {
    const id = String(appId || "").trim().toUpperCase();
    return getEndorsements().filter(e => String(e.appId).toUpperCase() === id);
  }
  window.mentorEndorsementsFor = endorsementsFor;
  window.mentorEndorsementCount = appId => endorsementsFor(appId).length;

  function addEndorsement(appId, name, role, note) {
    const list = getEndorsements();
    list.push({
      appId: String(appId).trim(),
      name: String(name).trim(),
      role: role || "Community Mentor",
      note: (note || "").trim(),
      at: nowIso()
    });
    write(ENDORSE_KEY, list);
  }

  function renderEndorsements() {
    const box = document.getElementById("endorsementList");
    if (!box) return;
    const list = getEndorsements().slice().reverse().slice(0, 15);
    if (!list.length) {
      box.innerHTML = `<p class="muted">No endorsements yet.</p>`;
      return;
    }
    box.innerHTML = list.map(e => `
      <div class="mentor-endorse-card">
        <div>
          <strong>${esc(e.name)}</strong> <span class="muted">(${esc(e.role)})</span>
          endorsed <strong>${esc(e.appId)}</strong>
        </div>
        ${e.note ? `<p class="muted">"${esc(e.note)}"</p>` : ""}
        <span class="muted small">${esc(fmt(e.at))}</span>
      </div>`).join("");
  }

  /* ---- Mentor alerts (discrepancies + help requests) ---- */
  function getAlerts() {
    return read(ALERT_KEY);
  }
  function mentorRaiseAlert(type, appId, message) {
    const list = getAlerts();
    // De-duplicate identical open alerts for the same app/message.
    if (list.some(a => a.appId === appId && a.message === message && !a.resolved)) return;
    list.push({
      id: "MA" + Date.now().toString(36),
      type, // "discrepancy" | "help"
      appId: String(appId),
      message: String(message),
      at: nowIso(),
      resolved: false
    });
    write(ALERT_KEY, list);
  }
  // Public helpers used by the OCR cross-verification hook and flags.
  window.mentorRaiseDiscrepancy = (appId, message) => {
    mentorRaiseAlert("discrepancy", appId, message);
    if (document.getElementById("mentor")?.classList.contains("active")) renderAlerts();
  };
  window.mentorRaiseAlert = mentorRaiseAlert;

  function resolveAlert(id) {
    const list = getAlerts();
    const a = list.find(x => x.id === id);
    if (a) {
      a.resolved = true;
      a.resolvedAt = nowIso();
      write(ALERT_KEY, list);
    }
    renderAlerts();
  }
  window.mentorResolveAlert = resolveAlert;

  function renderAlerts() {
    const box = document.getElementById("mentorAlertList");
    if (!box) return;
    const list = getAlerts().slice().reverse();
    if (!list.length) {
      box.innerHTML = `<p class="muted">No mentor alerts. Discrepancies and help requests will appear here.</p>`;
      return;
    }
    box.innerHTML = list.map(a => `
      <div class="mentor-alert ${a.resolved ? "resolved" : a.type}">
        <div class="mentor-alert-head">
          <span class="mentor-alert-tag">${a.type === "discrepancy" ? "⚠ Discrepancy" : "🙋 Help request"}</span>
          <span class="muted small">${esc(fmt(a.at))}</span>
        </div>
        <p><strong>${esc(a.appId)}</strong> — ${esc(a.message)}</p>
        ${
          a.resolved
            ? `<span class="muted small">✓ Resolved</span>`
            : `<button type="button" class="secondary-btn" onclick="mentorResolveAlert('${esc(a.id)}')">Mark as guided / resolved</button>`
        }
      </div>`).join("");
  }

  /* ---- Page render + form wiring ---- */
  function renderMentorPage() {
    renderChecklist();
    renderEndorsements();
    renderAlerts();
  }
  window.renderMentorPage = renderMentorPage;

  function wireForm() {
    const form = document.getElementById("endorseForm");
    if (!form || form.dataset.wired) return;
    form.dataset.wired = "1";
    form.addEventListener("submit", event => {
      event.preventDefault();
      const appId = document.getElementById("endAppId")?.value.trim();
      const name = document.getElementById("endName")?.value.trim();
      const role = document.getElementById("endRole")?.value;
      const note = document.getElementById("endNote")?.value;
      const msg = document.getElementById("endorseMessage");
      if (!appId || !name) {
        if (msg) { msg.className = "message error"; msg.textContent = "Application ID and your name are required."; }
        return;
      }
      addEndorsement(appId, name, role, note);
      if (msg) { msg.className = "message success"; msg.textContent = `Endorsement added for ${appId}.`; }
      form.reset();
      renderEndorsements();
    });
  }

  if (document.readyState !== "loading") wireForm();
  else document.addEventListener("DOMContentLoaded", wireForm);
})();
