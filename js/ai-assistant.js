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

  /* All language knowledge lives in js/assistant-i18n.js + js/kb/*.js.
     Fall back gracefully if the i18n core failed to load. */
  const I18N = window.AssistantI18n || null;

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

  /* A language code ('en', 'hi', 'ta', …) for the offline guide and the UI.
     The AI itself is told to mirror the student's language/script. */
  function detectLang(text) {
    const pref = getLangPref();
    if (I18N) return I18N.detect(text, pref);
    if (pref === "en" || pref === "hi") return pref;
    return DEVANAGARI.test(text) ? "hi" : "en";
  }

  /* BCP-47 code for speech synthesis / recognition for a given language. */
  function speechCode(code) {
    if (!I18N) return code === "hi" ? "hi-IN" : "en-IN";
    const info = I18N.info(code);
    return info.speech || info.voiceFallback || "en-IN";
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
     OFFLINE MULTILINGUAL KNOWLEDGE BASE
     Every language's built-in guide lives in js/kb/<code>.js and is served
     through AssistantI18n. If the i18n core is missing we fall back to the
     English STUDY_BUDDY_KB defined in script.js.
     --------------------------------------------------------- */
  function kbAnswer(query, lang, topic) {
    if (I18N) return I18N.answer(query, lang, topic);
    // Fallback: English-only keyword match against script.js's STUDY_BUDDY_KB.
    const q = String(query).toLowerCase().trim();
    let best = null;
    let bestScore = 0;
    (typeof STUDY_BUDDY_KB !== "undefined" ? STUDY_BUDDY_KB : []).forEach(entry => {
      let score = 0;
      entry.keywords.forEach(k => {
        if (studyBuddyKeywordMatches(q, k)) score += k.split(" ").length;
      });
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    });
    return best ? best.answer : (typeof STUDY_BUDDY_FALLBACK === "string" ? STUDY_BUDDY_FALLBACK : "Sorry, I don't know that yet.");
  }

  /* ---------------------------------------------------------
     QUICK TOPICS + GREETING (per language, from the language pack)
     --------------------------------------------------------- */
  const QUICK_FALLBACK = [
    ["NFST vs NOS", "schemes"],
    ["Documents needed", "documents"],
    ["Eligibility", "eligibility"],
    ["How to apply", "apply"],
    ["Payment status", "payments"],
    ["Raise complaint", "grievance"]
  ];

  /* [label, topicId] pairs for the current UI language. */
  function quickTopics(lang) {
    const pack = I18N ? I18N.pack(lang) || I18N.pack("en") : null;
    return (pack && pack.quick) || QUICK_FALLBACK;
  }

  function greetingText(lang) {
    const pack = I18N ? I18N.pack(lang) || I18N.pack("en") : null;
    return (pack && pack.greeting) ||
      "Hi! I'm Study Buddy 🎓 Ask me about NFST/NOS, documents, eligibility, applying, payments or complaints.";
  }

  function placeholderText(lang) {
    const pack = I18N ? I18N.pack(lang) || I18N.pack("en") : null;
    return (pack && pack.placeholder) || "Ask a question…";
  }

  function privacyText(lang) {
    const pack = I18N ? I18N.pack(lang) || I18N.pack("en") : null;
    return (pack && pack.privacy) ||
      "🔒 For your safety I removed personal numbers (Aadhaar / phone / account) before answering. Please don't share them in chat.";
  }

  /* The language used for the UI (greeting, chips, placeholder): the pinned
     language, or English while "auto" is selected. */
  function uiLang() {
    const pref = getLangPref();
    if (pref && pref !== "auto") return pref;
    return I18N && I18N.pageLang ? (I18N.pageLang() || "en") : "en";
  }

  function renderQuickReplies() {
    const wrap = $("studyBuddyQuickReplies");
    if (!wrap) return;
    wrap.innerHTML = quickTopics(uiLang())
      .map(([label, topic]) => `<button type="button" class="study-buddy-chip" data-ai-topic="${escapeHTML(topic)}" data-ai-label="${escapeHTML(label)}">${escapeHTML(label)}</button>`)
      .join("");
  }

  /* Up to 2 local follow-up chips after an answer (the next topics for this
     language, skipping the one just asked). Built with textContent. */
  function showFollowUps(askedTopic, lang) {
    const box = $("studyBuddyMessages");
    if (!box) return;
    box.querySelectorAll(".sb-followups").forEach(el => el.remove());
    const list = quickTopics(lang);
    const asked = list.findIndex(([, topic]) => topic === askedTopic);
    const picks = [1, 2]
      .map(n => list[(asked + n + list.length) % list.length])
      .filter(([, topic]) => topic !== askedTopic);
    const wrap = document.createElement("div");
    wrap.className = "sb-followups";
    picks.slice(0, 2).forEach(([label, topic]) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "study-buddy-chip";
      chip.dataset.aiTopic = topic;
      chip.dataset.aiLabel = label;
      chip.textContent = label;
      wrap.appendChild(chip);
    });
    box.appendChild(wrap);
    scrollMessages();
  }

  function greeting() {
    addBotMessage(greetingText(uiLang()), "kb");
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
    bubble.lang = I18N ? I18N.detectScript(text, uiLang()) : (DEVANAGARI.test(text) ? "hi" : "en");

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
    const u = new SpeechSynthesisUtterance(text.replace(/[•✨📘🎓🔔🔊🎤🔒]/g, ""));
    /* Match the voice to the language of the text (script-based), so a Tamil
       or Telugu answer is read with the right engine when available. */
    const lang = I18N ? I18N.detectScript(text, uiLang()) : (DEVANAGARI.test(text) ? "hi" : "en");
    u.lang = speechCode(lang);
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

  /* Quick-reply / follow-up chips pass a topic id and answer from the built-in
     guide only (local = true, zero AI tokens). Free-text goes through the AI. */
  async function handle(rawQuery, { local = false, topic = null } = {}) {
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
      answer = kbAnswer(query, lang, topic);
      source = "kb";
    }

    typing?.remove();
    if (changed) {
      addBotMessage(privacyText(lang), "kb");
    }
    addBotMessage(answer, source);
    showFollowUps(topic || (I18N ? I18N.matchTopic(query, lang) : null), lang);

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
      /* "Auto" plus every language declared in AssistantI18n. Languages that
         have a built-in guide pack are marked so; the rest still work via the
         live AI and script detection. */
      let options = '<option value="auto">Auto</option>';
      if (I18N && Array.isArray(I18N.LANGS)) {
        options += I18N.LANGS.map(l => {
          const hasPack = !!I18N.pack(l.code);
          const label = hasPack ? l.name : `${l.name} (AI)`;
          return `<option value="${l.code}">${label}</option>`;
        }).join("");
      } else {
        options += '<option value="en">English</option><option value="hi">हिंदी</option>';
      }
      select.innerHTML = options;
      select.value = getLangPref();
      select.addEventListener("change", () => {
        setLangPref(select.value);
        renderQuickReplies();
        const input = $("studyBuddyInput");
        if (input) input.placeholder = placeholderText(uiLang());
      });
      header.insertBefore(select, header.querySelector(".study-buddy-close"));
    }

    const form = $("studyBuddyForm");
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (form && !$("sbMic")) {
      const mic = document.createElement("button");
      mic.type = "button";
      mic.id = "sbMic";
      mic.className = "sb-mic";
      mic.setAttribute("aria-label", "Speak your question");
      mic.title = "Speak your question";
      mic.textContent = "🎤";

      if (!Recognition) {
        // No Web Speech API (e.g. Firefox, non-HTTPS): show the icon but
        // explain instead of failing silently.
        mic.classList.add("unsupported");
        mic.addEventListener("click", () => {
          addBotMessage(
            uiLang() === "hi"
              ? "🎤 माफ़ कीजिए, आपका ब्राउज़र वॉइस इनपुट सपोर्ट नहीं करता। कृपया Chrome या Edge (HTTPS पर) आज़माएँ, या अपना सवाल टाइप करें।"
              : "🎤 Sorry, your browser doesn't support voice input. Please try Chrome or Edge (over HTTPS), or type your question.",
            "kb"
          );
        });
      } else {
        mic.addEventListener("click", () => {
          let rec;
          try {
            rec = new Recognition();
          } catch (e) {
            mic.classList.remove("listening");
            addBotMessage(
              uiLang() === "hi" ? "🎤 वॉइस इनपुट शुरू नहीं हो सका।" : "🎤 Couldn't start voice input.",
              "kb"
            );
            return;
          }
          const pref = getLangPref();
          rec.lang = speechCode(pref !== "auto" ? pref : uiLang());
          rec.interimResults = false;
          rec.maxAlternatives = 1;
          mic.classList.add("listening");
          rec.onresult = e => handle(e.results[0][0].transcript);
          rec.onend = () => mic.classList.remove("listening");
          rec.onerror = ev => {
            mic.classList.remove("listening");
            const msg = ev && ev.error === "not-allowed"
              ? (uiLang() === "hi"
                  ? "🎤 माइक्रोफ़ोन की अनुमति नहीं मिली। ब्राउज़र सेटिंग में माइक्रोफ़ोन की अनुमति दें।"
                  : "🎤 Microphone permission was blocked. Please allow microphone access in your browser settings.")
              : (uiLang() === "hi"
                  ? "🎤 वॉइस इनपुट अभी काम नहीं कर रहा। कृपया अपना सवाल टाइप करें।"
                  : "🎤 Voice input isn't working right now. Please type your question instead.");
            addBotMessage(msg, "kb");
          };
          try {
            rec.start();
          } catch (e) {
            mic.classList.remove("listening");
          }
        });
      }
      form.insertBefore(mic, form.querySelector("button[type='submit']"));
    }

    const disclaimer = document.querySelector(".study-buddy-disclaimer");
    if (disclaimer) {
      disclaimer.textContent =
        "Answers come from an AI model (Gemini) when available, otherwise from the built-in guide. AI can make mistakes — for official decisions, contact your scholarship office.";
    }
  }

  document.addEventListener("click", event => {
    const chip = event.target.closest("[data-ai-topic], [data-ai-query]");
    if (!chip) return;
    if (chip.dataset.aiTopic) {
      // Quick-reply / follow-up chip: answer this topic from the built-in guide.
      const label = chip.dataset.aiLabel || chip.textContent.trim();
      handle(label, { local: true, topic: chip.dataset.aiTopic });
    } else if (chip.dataset.aiQuery) {
      handle(chip.dataset.aiQuery, { local: true });
    }
  });

  document.addEventListener("DOMContentLoaded", enhancePanel);
  if (document.readyState !== "loading") enhancePanel();

  window.StudyBuddyAI = { handle, renderQuickReplies, greeting, status, kbAnswer, redact, detectLang, cleanReply };
})();
