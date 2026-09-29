/* ===========================================================================
   TRIBALSCHOLAR — AADHAAR SECURE QR VERIFICATION

   Real identity check with no OTP and no eKYC licence:
   1. Read the Secure QR from the camera, a photo, or the e-Aadhaar PDF
      (native BarcodeDetector when the browser has it, jsQR otherwise).
   2. Send the QR's digits to the `aadhaar-qr` Edge Function, which verifies
      UIDAI's RSA signature — edited or fake QRs are rejected.
   3. Fill the verified name into the form.

   The QR never holds the full Aadhaar number (only the last 4 digits), and
   the photo / full address are dropped on the server.

   Loads AFTER script.js and data-service.js. Uses globals from script.js:
   applyVerifiedIdentity, setIdentityStatus; pdfjsLib (index.html); DataService.
   =========================================================================== */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const SCAN_INTERVAL_MS = 250;
  const MAX_IMAGE_EDGE = 2400;

  let stream = null;
  let scanTimer = null;
  let busy = false;
  let pendingPdf = null; // ArrayBuffer waiting for its password

  /* ---------------------------------------------------------
     STATUS
     --------------------------------------------------------- */
  function status(message, type = "info") {
    const box = $("aqrStatus");
    if (!box) return;
    box.textContent = message;
    box.className = `aqr-status ${type}`;
  }

  function clearStatus() {
    $("aqrStatus")?.classList.add("hidden");
  }

  /* ---------------------------------------------------------
     QR DECODING
     --------------------------------------------------------- */
  let detector = null;
  async function nativeDetector() {
    if (detector !== null) return detector;
    detector = false;
    try {
      if ("BarcodeDetector" in window) {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes("qr_code")) detector = new BarcodeDetector({ formats: ["qr_code"] });
      }
    } catch {}
    return detector;
  }

  async function decodeCanvas(canvas) {
    const native = await nativeDetector();
    if (native) {
      try {
        const found = await native.detect(canvas);
        const hit = found.find(c => /^\d{200,}$/.test(c.rawValue || ""));
        if (hit) return hit.rawValue;
      } catch {}
    }
    if (typeof jsQR !== "function") return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    return code?.data || null;
  }

  function canvasFrom(source, maxEdge) {
    const w = source.naturalWidth || source.videoWidth || source.width;
    const h = source.naturalHeight || source.videoHeight || source.height;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff"; // transparent PNGs → white, so the QR has contrast
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /* Dense QRs decode best at different sizes depending on the photo, so try a few. */
  async function decodeImageSource(source) {
    for (const edge of [MAX_IMAGE_EDGE, 1600, 1100]) {
      const text = await decodeCanvas(canvasFrom(source, edge));
      if (text) return text;
    }
    return null;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("This image could not be opened."));
      };
      img.src = url;
    });
  }

  async function decodePdf(buffer, password) {
    if (!window.pdfjsLib) throw new Error("The PDF reader did not load — please upload a photo or screenshot instead.");
    // pdf.js takes ownership of the buffer, so hand it a copy (we may retry with a password).
    const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0), password }).promise;
    for (let n = 1; n <= Math.min(pdf.numPages, 2); n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 3 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const text = await decodeImageSource(canvas);
      if (text) return text;
    }
    return null;
  }

  /* ---------------------------------------------------------
     SERVER VERIFICATION
     --------------------------------------------------------- */
  async function verify(qrText) {
    const digits = String(qrText).replace(/\s+/g, "");
    if (!/^\d{200,}$/.test(digits)) {
      status(
        "That QR code isn't an Aadhaar Secure QR. Use the large QR on the Aadhaar letter, e-Aadhaar, PVC card or mAadhaar app.",
        "error"
      );
      return;
    }

    status("🔐 Checking UIDAI's digital signature…", "info");
    const res = await DataService.callFunction("aadhaar-qr", { qr: digits }, { timeoutMs: 20000 });

    if (res.ok && res.data?.verified) {
      const d = res.data;
      window.aadhaarIdentity = {
        name: d.name,
        dob: d.dob,
        gender: d.gender,
        aadhaarLast4: d.aadhaarLast4,
        verifiedAt: new Date().toISOString(),
        method: "uidai-secure-qr"
      };
      applyVerifiedIdentity({ name: d.name });
      status(`✓ Verified by UIDAI signature — ${d.name}`, "success");
      setIdentityStatus(
        `✓ Aadhaar verified (UIDAI digital signature) · ${d.name} · XXXX XXXX ${d.aadhaarLast4}` +
          (d.dob ? ` · DOB ${d.dob}` : "") +
          ". Name auto-filled below.",
        "success"
      );
      setTimeout(close, 1400);
      return;
    }

    if (res.status === 0 || res.status === 404) {
      status("The verification service is not reachable right now. Check your connection and try again.", "error");
    } else {
      status(res.data?.error || `Verification failed (${res.status}). Please try again.`, "error");
    }
  }

  async function handleDecoded(text, sourceLabel) {
    if (!text) {
      status(
        `No QR code found in the ${sourceLabel}. Make sure the whole QR is visible, sharp and well lit.`,
        "error"
      );
      return;
    }
    await verify(text);
  }

  /* ---------------------------------------------------------
     CAMERA
     --------------------------------------------------------- */
  function stopCamera() {
    clearTimeout(scanTimer);
    scanTimer = null;
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    const video = $("aqrVideo");
    if (video) video.srcObject = null;
    $("aqrCamera")?.classList.add("hidden");
  }

  async function startCamera() {
    if (busy) return;
    stopCamera();
    hidePassword();
    if (!navigator.mediaDevices?.getUserMedia) {
      status("This browser can't use the camera here. Upload the e-Aadhaar PDF or a photo instead.", "error");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
    } catch (e) {
      status(
        e.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access, or upload the e-Aadhaar PDF / a photo instead."
          : "No camera found. Upload the e-Aadhaar PDF or a photo instead.",
        "error"
      );
      return;
    }

    const video = $("aqrVideo");
    video.srcObject = stream;
    await video.play().catch(() => {});
    $("aqrCamera").classList.remove("hidden");
    status("Hold the Aadhaar Secure QR inside the frame. Move closer until it fills most of the box.", "info");

    const tick = async () => {
      if (!stream) return;
      if (video.readyState >= 2 && !busy) {
        const text = await decodeCanvas(canvasFrom(video, 1280));
        if (text && stream) {
          busy = true;
          stopCamera();
          await verify(text);
          busy = false;
          return;
        }
      }
      scanTimer = setTimeout(tick, SCAN_INTERVAL_MS);
    };
    tick();
  }

  /* ---------------------------------------------------------
     FILE UPLOAD (photo / screenshot / e-Aadhaar PDF)
     --------------------------------------------------------- */
  function showPassword(message) {
    $("aqrPasswordRow")?.classList.remove("hidden");
    $("aqrPasswordBtn")?.classList.remove("hidden");
    status(message, "info");
    $("aqrPassword")?.focus();
  }

  function hidePassword() {
    pendingPdf = null;
    $("aqrPasswordRow")?.classList.add("hidden");
    $("aqrPasswordBtn")?.classList.add("hidden");
    const input = $("aqrPassword");
    if (input) input.value = "";
  }

  async function tryPdf(buffer, password) {
    try {
      status("📄 Reading the e-Aadhaar PDF…", "info");
      const text = await decodePdf(buffer, password);
      hidePassword();
      await handleDecoded(text, "PDF");
    } catch (e) {
      if (e?.name === "PasswordException") {
        pendingPdf = buffer;
        showPassword(
          password
            ? "That password didn't work. It is the first 4 letters of your name in CAPITALS + your birth year (e.g. RAME2003)."
            : "This e-Aadhaar PDF is password-protected. Enter its password to read the QR."
        );
        return;
      }
      hidePassword();
      status(e?.message || "This PDF could not be read.", "error");
    }
  }

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // let the same file be picked again
    if (!file || busy) return;
    stopCamera();
    hidePassword();
    busy = true;
    try {
      if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        await tryPdf(await file.arrayBuffer(), undefined);
      } else {
        status("🔎 Looking for the QR code in your photo…", "info");
        await handleDecoded(await decodeImageSource(await loadImage(file)), "photo");
      }
    } catch (e) {
      status(e?.message || "This file could not be read.", "error");
    } finally {
      busy = false;
    }
  }

  async function onPasswordSubmit() {
    const password = $("aqrPassword")?.value.trim();
    if (!pendingPdf || !password || busy) return;
    busy = true;
    try {
      await tryPdf(pendingPdf, password);
    } finally {
      busy = false;
    }
  }

  /* ---------------------------------------------------------
     MODAL
     --------------------------------------------------------- */
  function open() {
    clearStatus();
    hidePassword();
    $("aadhaarModal")?.classList.remove("hidden");
    $("aqrCameraBtn")?.focus();
  }

  function close() {
    stopCamera();
    hidePassword();
    $("aadhaarModal")?.classList.add("hidden");
  }

  function wire() {
    $("aqrCameraBtn")?.addEventListener("click", startCamera);
    $("aqrFile")?.addEventListener("change", onFile);
    $("aqrPasswordBtn")?.addEventListener("click", onPasswordSubmit);
    $("aqrPassword")?.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        onPasswordSubmit();
      }
    });
    $("aqrCancel")?.addEventListener("click", close);
    $("aadhaarModal")?.addEventListener("click", e => {
      if (e.target.id === "aadhaarModal") close();
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !$("aadhaarModal")?.classList.contains("hidden")) close();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  window.AadhaarQr = { open, close, verify, decodeImageSource };
})();
