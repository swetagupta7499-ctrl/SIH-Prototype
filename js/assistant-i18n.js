/* ===========================================================================
   TRIBALSCHOLAR — STUDY BUDDY LANGUAGE CORE
   The 21 languages offered by the site's Google Translate widget, script-based
   language detection, speech codes and a registry for the built-in guide
   (offline knowledge base). Each language pack lives in js/kb/<code>.js and
   calls AssistantI18n.register(code, pack). English (en) and Hindi (hi) live in
   js/kb/en.js and js/kb/hi.js like every other language.

   Pack shape:
   {
     greeting, fallback, placeholder, privacy: string,
     quick: [[label, topicId] × 6],
     hints: [words typical of this language — tells apart languages that share
             a script, e.g. Hindi / Marathi / Nepali in Devanagari],
     kb: { topicId: { k: [native keywords], a: "answer" } }
   }
   Topic ids: greeting schemes nfst nos eligibility documents apply track
              deficient payments grievance digilocker contact

   Loads BEFORE js/kb/*.js and js/ai-assistant.js.
   =========================================================================== */
(function () {
  "use strict";

  /* speech = BCP-47 code for SpeechSynthesis / SpeechRecognition;
     voiceFallback = used when the browser has no engine for `speech`. */
  const LANGS = [
    { code: "en", name: "English", english: "English", script: "Latin", speech: "en-IN" },
    { code: "hi", name: "हिंदी", english: "Hindi", script: "Devanagari", speech: "hi-IN" },
    { code: "bn", name: "বাংলা", english: "Bengali", script: "Bengali", speech: "bn-IN" },
    { code: "mr", name: "मराठी", english: "Marathi", script: "Devanagari", speech: "mr-IN" },
    { code: "te", name: "తెలుగు", english: "Telugu", script: "Telugu", speech: "te-IN" },
    { code: "ta", name: "தமிழ்", english: "Tamil", script: "Tamil", speech: "ta-IN" },
    { code: "gu", name: "ગુજરાતી", english: "Gujarati", script: "Gujarati", speech: "gu-IN" },
    { code: "ur", name: "اردو", english: "Urdu", script: "Perso-Arabic (Nastaliq)", speech: "ur-IN" },
    { code: "kn", name: "ಕನ್ನಡ", english: "Kannada", script: "Kannada", speech: "kn-IN" },
    { code: "or", name: "ଓଡ଼ିଆ", english: "Odia", script: "Odia", speech: "or-IN", voiceFallback: "hi-IN" },
    { code: "ml", name: "മലയാളം", english: "Malayalam", script: "Malayalam", speech: "ml-IN" },
    { code: "pa", name: "ਪੰਜਾਬੀ", english: "Punjabi", script: "Gurmukhi", speech: "pa-IN" },
    { code: "as", name: "অসমীয়া", english: "Assamese", script: "Assamese (Bengali-Assamese)", speech: "as-IN", voiceFallback: "bn-IN" },
    { code: "ne", name: "नेपाली", english: "Nepali", script: "Devanagari", speech: "ne-NP", voiceFallback: "hi-IN" },
    { code: "sd", name: "سنڌي", english: "Sindhi", script: "Perso-Arabic", speech: "sd-IN", voiceFallback: "ur-IN" },
    { code: "sa", name: "संस्कृतम्", english: "Sanskrit", script: "Devanagari", speech: "sa-IN", voiceFallback: "hi-IN" },
    { code: "ks", name: "کٲشُر", english: "Kashmiri", script: "Perso-Arabic", speech: "ks-IN", voiceFallback: "ur-IN" },
    { code: "doi", name: "डोगरी", english: "Dogri", script: "Devanagari", speech: "doi-IN", voiceFallback: "hi-IN" },
    { code: "mni", name: "ꯃꯩꯇꯩꯂꯣꯟ", english: "Manipuri (Meitei)", script: "Meetei Mayek", speech: "mni-IN", voiceFallback: "bn-IN" },
    { code: "brx", name: "बर'", english: "Bodo", script: "Devanagari", speech: "brx-IN", voiceFallback: "hi-IN" },
    { code: "sat", name: "ᱥᱟᱱᱛᱟᱲᱤ", english: "Santali", script: "Ol Chiki", speech: "sat-IN", voiceFallback: "hi-IN" }
  ];
  const BY_CODE = Object.fromEntries(LANGS.map(l => [l.code, l]));
  const GT_ALIAS = { "mni-Mtei": "mni" }; // Google Translate codes that differ from ours

  const packs = {};

  function register(code, pack) {
    if (BY_CODE[code] && pack) packs[code] = pack;
  }

  function pack(code) {
    return packs[code] || null;
  }

  function info(code) {
    return BY_CODE[code] || BY_CODE.en;
  }

  /* Language picked in the page's Google Translate widget (cookie "googtrans=/en/ta"). */
  function pageLang() {
    const m = document.cookie.match(/(?:^|;\s*)googtrans=\/[^/;]*\/([^;]+)/);
    if (!m) return null;
    const raw = decodeURIComponent(m[1]);
    const code = GT_ALIAS[raw] || raw;
    return BY_CODE[code] ? code : null;
  }

  /* ---------------- detection ---------------- */
  const UNIQUE_SCRIPTS = [
    [/[\u1C50-\u1C7F]/, "sat"], // Ol Chiki
    [/[\uABC0-\uABFF]/, "mni"], // Meetei Mayek
    [/[\u0A00-\u0A7F]/, "pa"],  // Gurmukhi
    [/[\u0A80-\u0AFF]/, "gu"],
    [/[\u0B00-\u0B7F]/, "or"],
    [/[\u0B80-\u0BFF]/, "ta"],
    [/[\u0C00-\u0C7F]/, "te"],
    [/[\u0C80-\u0CFF]/, "kn"],
    [/[\u0D00-\u0D7F]/, "ml"]
  ];
  const DEVANAGARI = /[\u0900-\u097F]/;
  const BENGALI = /[\u0980-\u09FF]/;
  const ARABIC = /[\u0600-\u06FF\u0750-\u077F]/;
  const SHARED = {
    devanagari: ["hi", "mr", "ne", "sa", "doi", "brx"],
    bengali: ["bn", "as"],
    arabic: ["ur", "sd", "ks"]
  };

  /* Pick among languages sharing a script by characteristic words
     (pack.hints), then the preferred/page language, then the first one. */
  function pickShared(text, candidates, preferred) {
    let best = null;
    let bestScore = 0;
    candidates.forEach(code => {
      const score = (packs[code]?.hints || []).reduce((n, h) => n + (text.includes(h) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = code;
      }
    });
    if (best) return best;
    if (preferred && candidates.includes(preferred)) return preferred;
    return candidates[0];
  }

  const HINGLISH_WORDS = [
    "kya", "kaise", "kaisa", "kab", "kahan", "kyu", "kyun", "hai", "hain", "mujhe", "mera", "meri",
    "karna", "karu", "karun", "chahiye", "batao", "bataiye", "paisa", "paise", "milega", "nahi",
    "aavedan", "avedan", "yojana", "chhatravritti", "dastavez", "shikayat", "kitna", "kaun", "kaunse",
    "kaunsa", "kaunsi", "liye", "aur", "bhi", "sakta", "sakti", "milegi"
  ];

  function isHinglish(text) {
    const words = String(text).toLowerCase().match(/[a-z]+/g) || [];
    return words.filter(w => HINGLISH_WORDS.includes(w)).length >= 2;
  }

  /* Language of a piece of text; `preferred` breaks ties within a shared script. */
  function detectScript(text, preferred) {
    const t = String(text || "");
    for (const [re, code] of UNIQUE_SCRIPTS) if (re.test(t)) return code;
    if (ARABIC.test(t)) {
      if (/[ڄٻڀٽڏڊڌڳڱڻڦڇ]/.test(t)) return "sd";
      if (/[ٲٳۆۄێؠ]/.test(t)) return "ks";
      return pickShared(t, SHARED.arabic, preferred);
    }
    if (BENGALI.test(t)) {
      if (/[ৰৱ]/.test(t)) return "as";
      return pickShared(t, SHARED.bengali, preferred);
    }
    if (DEVANAGARI.test(t)) return pickShared(t, SHARED.devanagari, preferred);
    if (isHinglish(t)) return "hi";
    return "en";
  }

  /* pref: "auto" or a language code — a pinned language always wins. */
  function detect(text, pref) {
    if (pref && pref !== "auto" && BY_CODE[pref]) return pref;
    return detectScript(text, pageLang());
  }

  /* ---------------- built-in guide matching ---------------- */
  const LATIN_ONLY = /^[\x00-\x7F]+$/;

  function keywordHit(query, keyword) {
    const k = keyword.toLowerCase();
    if (!LATIN_ONLY.test(k)) return query.includes(k);
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + escaped + "s?([^a-z0-9]|$)", "i").test(query);
  }

  /* Best topic for a query: the pack's own keywords plus the Latin-script
     keywords of the English and Hindi packs, so "NFST", "DigiLocker",
     "status" or Hinglish words work in every language. */
  function matchTopic(query, code) {
    const q = String(query || "").toLowerCase().trim();
    if (!q) return null;
    const scores = {};
    const add = (id, keywords, latinOnly) => {
      (keywords || []).forEach(k => {
        if (latinOnly && !LATIN_ONLY.test(k)) return;
        if (keywordHit(q, k)) scores[id] = (scores[id] || 0) + k.split(" ").length;
      });
    };
    const own = packs[code]?.kb || {};
    Object.entries(own).forEach(([id, t]) => add(id, t.k, false));
    ["en", "hi"].forEach(c => {
      if (c !== code) Object.entries(packs[c]?.kb || {}).forEach(([id, t]) => add(id, t.k, true));
    });
    let best = null;
    let bestScore = 0;
    Object.entries(scores).forEach(([id, s]) => {
      const score = s + (own[id] ? 0.5 : 0); // prefer topics this language can answer
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    });
    return best;
  }

  /* Answer from the built-in guide; `topic` skips matching (quick-reply chips). */
  function answer(query, code, topic) {
    const p = packs[code] || packs.en;
    const id = topic || matchTopic(query, code);
    return (id && p?.kb?.[id]?.a) || p?.fallback || packs.en?.fallback || "";
  }

  window.AssistantI18n = { LANGS, info, register, pack, pageLang, detect, detectScript, isHinglish, matchTopic, answer };
})();
