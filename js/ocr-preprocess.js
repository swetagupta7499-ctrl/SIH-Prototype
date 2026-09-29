/* ===========================================================================
   TRIBALSCHOLAR — OCR IMAGE PRE-PROCESSING (Canvas, no extra libraries)

   Runs in the browser before Tesseract:
     1. Normalise size   – upscale small photos, downscale huge ones
     2. Quality metrics  – blur (variance of Laplacian), brightness,
                           contrast, resolution → 0-100 quality score
     3. Enhancement      – grayscale, auto-contrast (1st–99th percentile
                           histogram stretch), light sharpening when soft

   Plain Canvas is used instead of OpenCV.js: the same maths, but no 8 MB
   download — important for students on slow mobile connections.

   API:  const out = await OcrPreprocess.prepare(fileOrDataUrl)
         out.dataUrl   → enhanced PNG to feed into Tesseract
         out.quality   → { score, level, blurVariance, isBlurry, ... }
         out.previews  → { before, after } small JPEG thumbnails
   =========================================================================== */
(function () {
  "use strict";

  const MIN_LONG_SIDE = 1400;   // below this, upscale so OCR sees bigger glyphs
  const MAX_LONG_SIDE = 2400;   // above this, downscale for speed
  const METRIC_LONG_SIDE = 1000; // metrics are computed at a fixed scale so
                                 // thresholds mean the same for every photo

  // Tuned on phone photos of A4 certificates at METRIC_LONG_SIDE.
  const BLUR_SEVERE = 60;
  const BLUR_SOFT = 150;

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = typeof source === "string" ? source : URL.createObjectURL(source);
      const release = () => {
        if (typeof source !== "string") URL.revokeObjectURL(url);
      };
      img.onload = () => {
        release();
        resolve(img);
      };
      img.onerror = () => {
        release();
        reject(new Error("Unsupported or corrupted image"));
      };
      img.src = url;
    });
  }

  function drawScaled(img, longSide) {
    const scale = longSide / Math.max(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function toGray(imageData) {
    const { data, width, height } = imageData;
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return gray;
  }

  /* Variance of the 4-neighbour Laplacian: sharp edges → high variance,
     blurred text → low variance. */
  function laplacianVariance(gray, width, height) {
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
        sum += lap;
        sumSq += lap * lap;
        n++;
      }
    }
    if (!n) return 0;
    const mean = sum / n;
    return sumSq / n - mean * mean;
  }

  function meanAndStd(gray) {
    let sum = 0;
    for (let i = 0; i < gray.length; i++) sum += gray[i];
    const mean = sum / gray.length;
    let v = 0;
    for (let i = 0; i < gray.length; i++) v += (gray[i] - mean) ** 2;
    return { mean, std: Math.sqrt(v / gray.length) };
  }

  function percentiles(gray, lowPct, highPct) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[Math.max(0, Math.min(255, gray[i] | 0))]++;
    const lowTarget = gray.length * lowPct;
    const highTarget = gray.length * highPct;
    let acc = 0;
    let low = 0;
    let high = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= lowTarget) {
        low = v;
        break;
      }
    }
    acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= highTarget) {
        high = v;
        break;
      }
    }
    return { low, high };
  }

  function assessQuality(img) {
    const canvas = drawScaled(img, METRIC_LONG_SIDE);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gray = toGray(imageData);

    const blurVariance = laplacianVariance(gray, canvas.width, canvas.height);
    const { mean: brightness, std: contrast } = meanAndStd(gray);
    const longSide = Math.max(img.naturalWidth, img.naturalHeight);

    const warnings = [];
    if (blurVariance < BLUR_SEVERE) warnings.push("Image is blurry — text may be misread. Retake the photo holding the phone steady.");
    else if (blurVariance < BLUR_SOFT) warnings.push("Image is slightly soft — sharpening was applied.");
    if (brightness < 70) warnings.push("Image is too dark — use better lighting.");
    // White paper is naturally bright; only warn when the text is washed out too.
    if (brightness > 225 && contrast < 30) warnings.push("Image is overexposed or has glare — avoid direct flash.");
    if (contrast < 35) warnings.push("Low contrast — auto-contrast was applied.");
    if (longSide < 800) warnings.push(`Low resolution (${img.naturalWidth}×${img.naturalHeight}px) — upload a larger scan if possible.`);

    // 0-100 score: sharpness dominates, exposure/contrast/resolution adjust it.
    const sharpness = Math.min(1, blurVariance / (BLUR_SOFT * 2));
    const exposure = 1 - Math.min(1, Math.abs(brightness - 170) / 170);
    const contrastScore = Math.min(1, contrast / 60);
    const resolution = Math.min(1, longSide / 1200);
    const score = Math.round(100 * (0.55 * sharpness + 0.15 * exposure + 0.15 * contrastScore + 0.15 * resolution));

    const level = blurVariance < BLUR_SEVERE || score < 40 ? "poor" : score < 70 ? "fair" : "good";

    return {
      score,
      level,
      blurVariance: Math.round(blurVariance),
      isBlurry: blurVariance < BLUR_SEVERE,
      isSoft: blurVariance < BLUR_SOFT,
      brightness: Math.round(brightness),
      contrast: Math.round(contrast),
      width: img.naturalWidth,
      height: img.naturalHeight,
      warnings
    };
  }

  function enhance(img, quality) {
    const longSide = Math.max(img.naturalWidth, img.naturalHeight);
    const target = Math.min(MAX_LONG_SIDE, Math.max(MIN_LONG_SIDE, longSide));
    const canvas = drawScaled(img, target);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { width, height, data } = imageData;
    let gray = toGray(imageData);

    // Auto-contrast: stretch 1st–99th percentile to the full 0–255 range.
    const { low, high } = percentiles(gray, 0.01, 0.99);
    const range = Math.max(1, high - low);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = Math.max(0, Math.min(255, ((gray[i] - low) * 255) / range));
    }

    // Light 3×3 sharpen for soft images (unsharp-style kernel).
    if (quality.isSoft) {
      const out = new Float32Array(gray.length);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
            out[i] = gray[i];
            continue;
          }
          const v = 5 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
          out[i] = Math.max(0, Math.min(255, v));
        }
      }
      gray = out;
    }

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      data[i] = data[i + 1] = data[i + 2] = gray[p];
      data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function thumbnail(sourceCanvasOrImg, longSide = 260) {
    const w = sourceCanvasOrImg.naturalWidth || sourceCanvasOrImg.width;
    const h = sourceCanvasOrImg.naturalHeight || sourceCanvasOrImg.height;
    const scale = longSide / Math.max(w, h);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext("2d").drawImage(sourceCanvasOrImg, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
  }

  async function prepare(source) {
    const img = await loadImage(source);
    const quality = assessQuality(img);
    const enhanced = enhance(img, quality);
    return {
      dataUrl: enhanced.toDataURL("image/png"),
      quality,
      previews: { before: thumbnail(img), after: thumbnail(enhanced) }
    };
  }

  /* Small HTML block shown inside each document's OCR box. */
  function qualityHtml(quality, previews) {
    if (!quality) return "";
    const esc = window.escapeHTML || (s => String(s));
    const icon = { good: "✓", fair: "!", poor: "✕" }[quality.level];
    const label = { good: "Good image quality", fair: "Fair image quality", poor: "Poor image quality" }[quality.level];
    return `
      <div class="ocr-quality ${quality.level}">
        <div class="ocr-quality-head">
          <span>${icon} ${label}</span>
          <strong>${quality.score}/100</strong>
        </div>
        <div class="ocr-quality-metrics">
          <span>Sharpness ${quality.blurVariance}</span>
          <span>Brightness ${quality.brightness}</span>
          <span>Contrast ${quality.contrast}</span>
          <span>${quality.width}×${quality.height}px</span>
        </div>
        ${quality.warnings.length ? `<ul>${quality.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
        ${previews ? `
          <details>
            <summary>Show enhanced image</summary>
            <div class="ocr-quality-previews">
              <figure><img src="${previews.before}" alt="Original upload"><figcaption>Original</figcaption></figure>
              <figure><img src="${previews.after}" alt="Enhanced for OCR"><figcaption>Enhanced for OCR</figcaption></figure>
            </div>
          </details>` : ""}
      </div>`;
  }

  window.OcrPreprocess = { prepare, qualityHtml };
})();
