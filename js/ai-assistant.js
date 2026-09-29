/* ===========================================================================
   TRIBALSCHOLAR — MULTILINGUAL AI ASSISTANT (Study Buddy upgrade)

   • English + हिंदी (and Hinglish) — auto-detected, or pinned by the user
   • Live answers from Google Gemini (free tier) via the `ai-assistant`
     Supabase Edge Function — the API key never reaches the browser
   • Offline fallback: bilingual built-in knowledge base, so the assistant
     still works if the AI quota runs out or the network drops
   • Token thrift: quick-reply chips answer from the built-in guide (zero
     tokens); only the last 6 turns are sent, older AI replies clipped
   • Privacy: Aadhaar / phone / account numbers and e-mails are redacted
     before anything leaves the device
   • Voice: speak a question (Web Speech API, hi-IN / en-IN) and listen to
     answers read aloud

   Loads AFTER script.js and data-service.js. Uses globals from script.js:
   STUDY_BUDDY_KB, studyBuddyKeywordMatches, escapeHTML.
   =========================================================================== */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const DEVANAGARI = /[ऀ-ॿ]/;
  const HINGLISH_WORDS = [
    "kya", "kaise", "kaisa", "kab", "kahan", "kyu", "kyun", "hai", "hain", "mujhe", "mera", "meri",
    "karna", "karu", "karun", "chahiye", "batao", "bataiye", "paisa", "paise", "milega", "nahi",
    "aavedan", "avedan", "yojana", "chhatravritti", "dastavez", "shikayat", "kitna", "kaun", "kaunse", "kaunsa", "kaunsi", "liye", "aur", "bhi", "sakta", "sakti", "milegi"
  ];

  const LANG_KEY = "tribalScholarAssistantLang";
  const sessionId = "chat-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const history = []; // [{ role: "user" | "assistant", content }]
  const SEND_TURNS = 6;          // messages sent to the Edge Function per call
  const CLIP_ASSISTANT = 400;    // chars kept from earlier AI replies in the payload
  const RETRY_AFTER_MS = 60000;  // network failures retry Gemini after this cooldown
  let aiState = "unknown"; // unknown | live | unavailable
  let aiLabel = "Not checked yet";
  let retryAt = 0; // when "unavailable" may be retried (Infinity = sticky, e.g. key not set)

  function getLangPref() {
    try {
      return localStorage.getItem(LANG_KEY) || "auto";
    } catch {
      return "auto";
    }
  }

  function setLangPref(v) {
    try {
      localStorage.setItem(LANG_KEY, v);
    } catch {}
  }

  function isHinglish(text) {
    const words = text.toLowerCase().match(/[a-z]+/g) || [];
    return words.filter(w => HINGLISH_WORDS.includes(w)).length >= 2;
  }

  /* 'en' | 'hi' — for the offline KB and the UI. The AI itself is told to
     mirror the student's script (so Hinglish gets a Hinglish reply). */
  function detectLang(text) {
    const pref = getLangPref();
    if (pref === "en" || pref === "hi") return pref;
    return DEVANAGARI.test(text) || isHinglish(text) ? "hi" : "en";
  }

  /* ---------------------------------------------------------
     PRIVACY: redact identifiers before sending to the AI
     --------------------------------------------------------- */
  function redact(text) {
    let changed = false;
    const sub = (re, label) => {
      text = text.replace(re, () => {
        changed = true;
        return label;
      });
    };
    sub(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
    sub(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[id-number]");           // Aadhaar-like
    sub(/(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g, "[phone]");            // mobile
    sub(/\b\d{9,18}\b/g, "[account-number]");                    // bank a/c
    sub(/\b[A-Z]{4}0[A-Z0-9]{6}\b/gi, "[ifsc]");
    return { text, changed };
  }

  /* Strip stray Markdown the model may still emit (rendered via textContent). */
  function cleanReply(text) {
    return String(text)
      .replace(/\*\*/g, "")
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      .replace(/^([ \t]*)[*-][ \t]+/gm, "$1• ");
  }

  /* ---------------------------------------------------------
     OFFLINE HINDI KNOWLEDGE BASE (English lives in STUDY_BUDDY_KB)
     --------------------------------------------------------- */
  const HINDI_KB = [
    {
      id: "greeting",
      keywords: ["नमस्ते", "नमस्कार", "हेलो", "namaste", "namaskar"],
      answer: "नमस्ते! मैं स्टडी बडी 🎓 हूँ। मैं NFST / NOS योजना, ज़रूरी दस्तावेज़, पात्रता, आवेदन और स्टेटस ट्रैक करने में आपकी मदद कर सकता हूँ। आप क्या जानना चाहते हैं?"
    },
    {
      id: "schemes",
      keywords: ["योजना", "योजनाएं", "छात्रवृत्ति", "स्कॉलरशिप", "yojana", "chhatravritti", "scholarship kaun", "kaun si scholarship"],
      answer: "TribalScholar पर अभी दो योजनाएं हैं:\n\n• NFST — अनुसूचित जनजाति के छात्रों के लिए राष्ट्रीय फेलोशिप (भारत में PhD / शोध के लिए)\n• NOS — राष्ट्रीय प्रवासी छात्रवृत्ति (विदेश में मास्टर्स / PhD के लिए, विश्वविद्यालय का ऑफ़र लेटर ज़रूरी)\n\nकिसी एक के बारे में पूछिए, जैसे \"NFST क्या है\"।"
    },
    {
      id: "nfst",
      keywords: ["nfst", "फेलोशिप", "fellowship", "राष्ट्रीय फेलोशिप"],
      answer: "NFST — अनुसूचित जनजाति छात्रों के लिए राष्ट्रीय फेलोशिप:\n• भारत में PhD / शोध के लिए\n• ज़रूरी दस्तावेज़: ST प्रमाणपत्र, मार्कशीट, आय प्रमाणपत्र\n• प्रोटोटाइप नियम: अंक ≥ 55%, पारिवारिक वार्षिक आय ≤ ₹8,00,000\n\nये डेमो के नियम हैं — आधिकारिक दिशानिर्देश ज़रूर देखें।"
    },
    {
      id: "nos",
      keywords: ["nos", "विदेश", "प्रवासी", "overseas", "videsh", "abroad"],
      answer: "NOS — राष्ट्रीय प्रवासी छात्रवृत्ति:\n• विदेश में मास्टर्स या PhD के लिए\n• ज़रूरी दस्तावेज़: ST प्रमाणपत्र, मार्कशीट, आय प्रमाणपत्र और विश्वविद्यालय का ऑफ़र लेटर\n• प्रोटोटाइप नियम: अंक ≥ 60%, पारिवारिक वार्षिक आय ≤ ₹8,00,000"
    },
    {
      id: "eligibility",
      keywords: ["पात्रता", "योग्यता", "पात्र", "eligible", "patrata", "yogyata", "kaun apply", "आय सीमा"],
      answer: "पात्रता (प्रोटोटाइप नियम) योजना पर निर्भर है:\n• NFST: PhD/शोध स्तर, अंक ≥ 55%, आय ≤ ₹8,00,000\n• NOS: मास्टर्स या PhD, अंक ≥ 60%, आय ≤ ₹8,00,000, ऑफ़र लेटर ज़रूरी\n\nApply पेज पर फ़ॉर्म भरते ही AI पात्रता जाँच तुरंत पास / फ़ेल दिखाती है।"
    },
    {
      id: "documents",
      keywords: ["दस्तावेज़", "दस्तावेज", "कागज़", "प्रमाणपत्र", "dastavez", "documents chahiye", "kaunse documents", "certificate", "upload"],
      answer: "आपको ये दस्तावेज़ चाहिए:\n• ST प्रमाणपत्र\n• मार्कशीट / शैक्षणिक रिकॉर्ड\n• आय प्रमाणपत्र\n• विश्वविद्यालय ऑफ़र लेटर (सिर्फ़ NOS के लिए)\n\nआप फ़ोटो अपलोड कर सकते हैं या \"DigiLocker से लाएं\" बटन से सीधे जारीकर्ता से सत्यापित दस्तावेज़ ले सकते हैं। धुंधली फ़ोटो होने पर पोर्टल आपको दोबारा फ़ोटो लेने को कहेगा।"
    },
    {
      id: "apply",
      keywords: ["आवेदन", "अप्लाई", "कैसे करें", "kaise apply", "apply kaise", "aavedan", "avedan", "form kaise"],
      answer: "आवेदन 4 चरणों में:\n1. लॉगिन करें और योजना चुनें\n2. व्यक्तिगत, शैक्षणिक और आय की जानकारी भरें\n3. दस्तावेज़ अपलोड करें या DigiLocker से लाएं\n4. \"Check My Application\" से जाँचें, कमियाँ ठीक करें, फिर सबमिट करें"
    },
    {
      id: "track",
      keywords: ["स्टेटस", "ट्रैक", "स्थिति", "status", "track", "kahan tak", "application id"],
      answer: "\"Track Application\" टैब खोलें और अपना Application ID (जैसे TS260001) डालें। आपको वर्तमान स्थिति — Submitted, Under Review, Deficient या Approved — और टाइमलाइन दिखेगी।"
    },
    {
      id: "deficient",
      keywords: ["कमी", "त्रुटि", "deficient", "galti", "kami", "सुधार"],
      answer: "\"Deficient\" का मतलब है कि जाँच में कोई कमी मिली — कोई जानकारी छूट गई, फ़ॉर्म और दस्तावेज़ में अंतर है, या प्रमाणपत्र पुराना लग रहा है। अपना आवेदन ट्रैक करें और 🔔 बटन से पूरी सूचना देखें।"
    },
    {
      id: "payments",
      keywords: ["पैसा", "भुगतान", "राशि", "डीबीटी", "paisa", "paise", "kab milega", "payment", "dbt", "pfms", "बैंक"],
      answer: "आवेदन स्वीकृत होने के बाद भुगतान 4 चरणों से गुज़रता है:\n1. स्वीकृत (Sanctioned)\n2. भुगतान शुरू (PFMS को भेजा गया)\n3. DBT प्रोसेस हुआ\n4. बैंक खाते में जमा\n\n\"Payments\" टैब में लाइव स्थिति और रेफ़रेंस नंबर देखें। ध्यान दें: आपका बैंक खाता आधार से जुड़ा (NPCI सीडिंग) होना चाहिए।"
    },
    {
      id: "grievance",
      keywords: ["शिकायत", "समस्या", "shikayat", "complaint", "grievance", "problem"],
      answer: "शिकायत दर्ज करने के लिए \"Grievance\" टैब खोलें, श्रेणी चुनें और समस्या लिखें। आपको टिकट ID मिलेगी, शिकायत सही विभाग को भेजी जाएगी और आप उसका समाधान ट्रैक कर सकते हैं।"
    },
    {
      id: "digilocker",
      keywords: ["डिजिलॉकर", "digilocker", "आधार", "aadhaar", "ekyc"],
      answer: "Apply पेज पर \"Fetch via DigiLocker\" दबाएं, अनुमति दें और अपने DigiLocker में जारी ST, आय और मार्कशीट दस्तावेज़ चुनें। ये सीधे जारी करने वाले विभाग से आते हैं, इसलिए सत्यापित माने जाते हैं और फ़ॉर्म अपने आप भर जाता है।"
    },
    {
      id: "contact",
      keywords: ["संपर्क", "हेल्पलाइन", "sampark", "helpline", "contact"],
      answer: "यह छात्रों द्वारा बनाया गया प्रोटोटाइप है, इसलिए यहाँ कोई लाइव हेल्पलाइन नहीं है। आधिकारिक सवालों के लिए अपनी योजना की हेल्पडेस्क या राज्य नोडल कार्यालय से संपर्क करें।"
    }
  ];

  const HINDI_FALLBACK =
    "माफ़ कीजिए, इसका जवाब मुझे अभी नहीं पता। मैं योजनाओं (NFST/NOS), दस्तावेज़, पात्रता, आवेदन, स्टेटस, भुगतान और शिकायत के बारे में मदद कर सकता हूँ। नीचे दिए विषयों में से कोई चुनें।";

  function kbAnswer(query, lang) {
    const q = query.toLowerCase().trim();
    const pick = (kb, fallback) => {
      let best = null;
      let bestScore = 0;
      kb.forEach(entry => {
        let score = 0;
        entry.keywords.forEach(k => {
          const hit = DEVANAGARI.test(k) ? q.includes(k.toLowerCase()) : studyBuddyKeywordMatches(q, k);
          if (hit) score += k.split(" ").length;
        });
        if (score > bestScore) {
          bestScore = score;
          best = entry;
        }
      });
      return best ? best.answer : fallback;
    };
    return lang === "hi"
      ? pick(HINDI_KB, HINDI_FALLBACK)
      : pick(STUDY_BUDDY_KB, typeof STUDY_BUDDY_FALLBACK === "string" ? STUDY_BUDDY_FALLBACK : "Sorry, I don't know that yet.");
  }

  /* ---------------------------------------------------------
     QUICK TOPICS + GREETING (per language)
     --------------------------------------------------------- */
  const QUICK = {
    en: [
      ["NFST vs NOS", "What is the difference between NFST and NOS?"],
      ["Documents needed", "What documents do I need to upload?"],
      ["Eligibility", "What are the eligibility criteria?"],
      ["How to apply", "How do I apply?"],
      ["Payment status", "When will I get my scholarship money?"],
      ["Raise complaint", "How do I raise a grievance?"]
    ],
    hi: [
      ["योजनाएं", "कौन सी छात्रवृत्ति योजनाएं हैं?"],
      ["ज़रूरी दस्तावेज़", "मुझे कौन से दस्तावेज़ चाहिए?"],
      ["पात्रता", "पात्रता क्या है?"],
      ["आवेदन कैसे करें", "आवेदन कैसे करें?"],
      ["पैसा कब मिलेगा", "छात्रवृत्ति का पैसा कब मिलेगा?"],
      ["शिकायत", "शिकायत कैसे दर्ज करें?"]
    ]
  };

  const GREETING = {
    en: "Hi! I'm Study Buddy 🎓 Ask me in English or हिंदी about NFST/NOS, documents, eligibility, applying, payments or complaints. You can also tap 🎤 and speak.",
    hi: "नमस्ते! मैं स्टडी बडी 🎓 हूँ। NFST/NOS, दस्तावेज़, पात्रता, आवेदन, भुगतान या शिकायत के बारे में हिंदी या English में पूछिए। आप 🎤 दबाकर बोलकर भी पूछ सकते हैं।"
  };

  function uiLang() {
    const pref = getLangPref();
    return pref === "hi" ? "hi" : "en";
  }

  function renderQuickReplies() {
    const wrap = $("studyBuddyQuickReplies");
    if (!wrap) return;
    wrap.innerHTML = QUICK[uiLang()]
      .map(([label, query]) => `<button type="button" class="study-buddy-chip" data-ai-query="${escapeHTML(query)}">${escapeHTML(label)}</button>`)
      .join("");
  }

  /* Up to 2 local follow-up chips after an answer (the next topics in QUICK,
     skipping the one just asked). Built with textContent — no innerHTML. */
  function showFollowUps(askedQuery, lang) {
    const box = $("studyBuddyMessages");
    if (!box) return;
    box.querySelectorAll(".sb-followups").forEach(el => el.remove());
    const list = QUICK[lang] || QUICK.en;
    const asked = list.findIndex(([, q]) => q === askedQuery);
    const picks = [1, 2].map(n => list[(asked + n + list.length) % list.length]).filter(([, q]) => q !== askedQuery);
    const wrap = document.createElement("div");
    wrap.className = "sb-followups";
    picks.slice(0, 2).forEach(([label, query]) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "study-buddy-chip";
      chip.dataset.aiQuery = query;
      chip.textContent = label;
      wrap.appendChild(chip);
    });
    box.appendChild(wrap);
    scrollMessages();
  }

  function greeting() {
    addBotMessage(GREETING[uiLang()], "kb");
  }

  /* ---------------------------------------------------------
     MESSAGES
     --------------------------------------------------------- */
  function scrollMessages() {
    const box = $("studyBuddyMessages");
    if (box) box.scrollTop = box.scrollHeight;
  }

  function addUserMessage(text) {
    const box = $("studyBuddyMessages");
    if (!box) return;
    const bubble = document.createElement("div");
    bubble.className = "study-buddy-msg user";
    bubble.textContent = text;
    box.appendChild(bubble);
    scrollMessages();
  }

  function addBotMessage(text, source) {
    const box = $("studyBuddyMessages");
    if (!box) return;
    const bubble = document.createElement("div");
    bubble.className = "study-buddy-msg bot";
    bubble.lang = DEVANAGARI.test(text) ? "hi" : "en";

    const body = document.createElement("div");
    body.textContent = text;
    bubble.appendChild(body);

    const meta = document.createElement("div");
    meta.className = "study-buddy-msg-meta";
    const tag = document.createElement("span");
    tag.className = `sb-source ${source}`;
    tag.textContent = source === "ai" ? "✨ AI answer" : "📘 Built-in guide";
    meta.appendChild(tag);

    if ("speechSynthesis" in window) {
      const speak = document.createElement("button");
      speak.type = "button";
      speak.className = "sb-speak";
      speak.setAttribute("aria-label", "Read aloud");
      speak.textContent = "🔊";
      speak.addEventListener("click", () => readAloud(text));
      meta.appendChild(speak);
    }
    bubble.appendChild(meta);
    box.appendChild(bubble);
    scrollMessages();
  }

  function showTyping() {
    const box = $("studyBuddyMessages");
    if (!box) return null;
    const el = document.createElement("div");
    el.className = "study-buddy-msg bot sb-typing";
    el.innerHTML = "<span></span><span></span><span></span>";
    box.appendChild(el);
    scrollMessages();
    return el;
  }

  function readAloud(text) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[•✨📘🎓]/g, ""));
    u.lang = DEVANAGARI.test(text) ? "hi-IN" : "en-IN";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }

  /* ---------------------------------------------------------
     AI CALL
     --------------------------------------------------------- */
  /* Live Rule Engine numbers (script.js loadRuleConfig) so the AI quotes the
     officer's current cut-offs. The server validates and falls back to defaults. */
  function currentRules() {
    try {
      const schemes = typeof loadRuleConfig === "function" ? loadRuleConfig().schemes : null;
      if (!schemes) return undefined;
      const rules = {};
      Object.entries(schemes).forEach(([s, r]) => {
        rules[s] = { minMarks: Number(r.minMarks), maxIncome: Number(r.maxIncome) };
      });
      return rules;
    } catch {
      return undefined;
    }
  }

  async function askAI(redactedText, lang) {
    if (aiState === "unavailable" && Date.now() < retryAt) return null;
    const messages = [...history, { role: "user", content: redactedText }]
      .slice(-SEND_TURNS)
      .map(m => (m.role === "assistant" && m.content.length > CLIP_ASSISTANT
        ? { role: m.role, content: m.content.slice(0, CLIP_ASSISTANT) + "…" }
        : m));
    const res = await DataService.callFunction(
      "ai-assistant",
      { messages, lang, rules: currentRules() },
      { timeoutMs: 25000 }
    );

    if (res.ok && res.data?.reply) {
      aiState = "live";
      aiLabel = `Gemini (${res.data.model || "free tier"}) via Edge Function`;
      return cleanReply(res.data.reply);
    }
    if (res.status === 0 || res.status === 404) {
      aiState = "unavailable";
      retryAt = Date.now() + RETRY_AFTER_MS; // network blips are not sticky
      aiLabel = "Edge Function not deployed / unreachable — using built-in guide";
    } else if (res.status === 429) {
      aiLabel = "AI free-tier limit reached — using built-in guide for now";
    } else if (res.status === 503) {
      aiState = "unavailable";
      retryAt = Infinity;
      aiLabel = "Edge Function deployed but GEMINI_API_KEY is not set";
    } else {
      aiLabel = `AI error (${res.status}) — using built-in guide`;
    }
    return null;
  }

  let busy = false;

  /* local = true for quick-reply chips: answer from the built-in guide only. */
  async function handle(rawQuery, { local = false } = {}) {
    const query = String(rawQuery || "").trim();
    if (!query || busy) return;
    busy = true;

    addUserMessage(query);
    const lang = detectLang(query);
    const { text: safeText, changed } = redact(query);
    const typing = local ? null : showTyping();

    let answer = local ? null : await askAI(safeText, lang);
    let source = "ai";
    if (!answer) {
      answer = kbAnswer(query, lang);
      source = "kb";
    }

    typing?.remove();
    if (changed) {
      addBotMessage(
        lang === "hi"
          ? "🔒 आपकी निजी जानकारी (जैसे आधार / फ़ोन / खाता नंबर) सुरक्षा के लिए हटा दी गई है। कृपया चैट में ये नंबर न लिखें।"
          : "🔒 For your safety I removed personal numbers (Aadhaar / phone / account) before answering. Please don't share them in chat.",
        "kb"
      );
    }
    addBotMessage(answer, source);
    showFollowUps(query, lang);

    history.push({ role: "user", content: safeText }, { role: "assistant", content: answer });
    if (history.length > 20) history.splice(0, history.length - 20);

    DataService.logChat(sessionId, "user", safeText, { lang });
    DataService.logChat(sessionId, "assistant", answer, { lang, source });
    busy = false;
  }

  /* ---------------------------------------------------------
     STATUS (used by the Officer Portal service panel)
     --------------------------------------------------------- */
  async function status() {
    if (aiState === "unknown") {
      const res = await DataService.callFunction("ai-assistant", { ping: true }, { timeoutMs: 6000 });
      if (res.ok && res.data?.configured) {
        aiState = "live";
        aiLabel = `Gemini (${res.data.model}) via Edge Function`;
      } else if (res.ok) {
        aiState = "unavailable";
        retryAt = Infinity;
        aiLabel = "Edge Function deployed but GEMINI_API_KEY is not set";
      } else {
        aiState = "unavailable";
        retryAt = Date.now() + RETRY_AFTER_MS;
        aiLabel = "Edge Function not deployed — using bilingual built-in guide";
      }
    }
    return { mode: aiState === "live" ? "live" : "offline", label: aiLabel };
  }

  /* ---------------------------------------------------------
     UI WIRING: language picker + voice input
     --------------------------------------------------------- */
  function enhancePanel() {
    const header = document.querySelector(".study-buddy-header");
    if (header && !$("sbLang")) {
      const select = document.createElement("select");
      select.id = "sbLang";
      select.className = "sb-lang";
      select.setAttribute("aria-label", "Assistant language");
      select.innerHTML = `
        <option value="auto">Auto</option>
        <option value="en">English</option>
        <option value="hi">हिंदी</option>`;
      select.value = getLangPref();
      select.addEventListener("change", () => {
        setLangPref(select.value);
        renderQuickReplies();
        const input = $("studyBuddyInput");
        if (input) input.placeholder = uiLang() === "hi" ? "अपना सवाल लिखें…" : "Ask a question…";
      });
      header.insertBefore(select, header.querySelector(".study-buddy-close"));
    }

    const form = $("studyBuddyForm");
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (form && Recognition && !$("sbMic")) {
      const mic = document.createElement("button");
      mic.type = "button";
      mic.id = "sbMic";
      mic.className = "sb-mic";
      mic.setAttribute("aria-label", "Speak your question");
      mic.textContent = "🎤";
      mic.addEventListener("click", () => {
        const rec = new Recognition();
        rec.lang = getLangPref() === "en" ? "en-IN" : "hi-IN";
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        mic.classList.add("listening");
        rec.onresult = e => handle(e.results[0][0].transcript);
        rec.onend = () => mic.classList.remove("listening");
        rec.onerror = () => mic.classList.remove("listening");
        rec.start();
      });
      form.insertBefore(mic, form.querySelector("button[type='submit']"));
    }

    const disclaimer = document.querySelector(".study-buddy-disclaimer");
    if (disclaimer) {
      disclaimer.textContent =
        "Answers come from an AI model (Gemini) when available, otherwise from the built-in guide. AI can make mistakes — for official decisions, contact your scholarship office.";
    }
  }

  document.addEventListener("click", event => {
    const chip = event.target.closest("[data-ai-query]");
    if (chip) handle(chip.dataset.aiQuery, { local: true });
  });

  document.addEventListener("DOMContentLoaded", enhancePanel);
  if (document.readyState !== "loading") enhancePanel();

  window.StudyBuddyAI = { handle, renderQuickReplies, greeting, status, kbAnswer, redact, detectLang, cleanReply };
})();
