# Supabase: data & services

This folder holds the backend for the AI assistant, DigiLocker, PFMS and the
cloud database. The website works **without** it: every feature falls back to a
clearly-labelled sandbox or to on-device storage, and the Officer Portal's
**Integrated Services** panel shows which mode each service is in.

| Piece | What it does |
|---|---|
| `migrations/20260928120000_features_data_services.sql` | Tables `payments`, `grievances`, `chat_messages`, `integration_logs`, plus OCR-quality/DigiLocker columns on `application_documents`. Row-level security: students see their own rows; officers (`profiles.role = 'officer'`) see everything. |
| `functions/ai-assistant` | Multilingual Study Buddy (English / हिंदी / Hinglish) backed by the **Google Gemini free tier**. The API key stays on the server. |
| `functions/gov-gateway` | DigiLocker (OAuth 2.0 + PKCE) and PFMS payment status. Reports `sandbox` until partner credentials are set. |

## Deploy (project owner, one time)

```bash
npm i -g supabase            # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref uieigcolfhexqqqmzydk

# 1. Database tables + security policies
supabase db push

# 2. AI assistant — free key from https://aistudio.google.com/apikey
supabase secrets set GEMINI_API_KEY=your-key-here
# optional: lock the function to your site(s)
supabase secrets set ALLOWED_ORIGINS=https://your-site.example,http://localhost:8765
supabase functions deploy ai-assistant --no-verify-jwt

# 3. Government gateway (works in sandbox mode with no secrets)
supabase functions deploy gov-gateway --no-verify-jwt
```

Open the site as an officer → **Officer Portal → Integrated Services**, which should
now show the AI assistant as **LIVE**.

## Going live with DigiLocker

Needs DigiLocker **Requester/Partner** onboarding (issued by MeitY / NeGD).

```bash
supabase secrets set \
  DIGILOCKER_CLIENT_ID=... \
  DIGILOCKER_CLIENT_SECRET=... \
  DIGILOCKER_REDIRECT_URIS=https://your-site.example/index.html
# optional, if your partner docs give a different base URL:
supabase secrets set DIGILOCKER_BASE_URL=https://.../public/oauth2
```

Check the endpoint paths in `gov-gateway/index.ts` (`/1/authorize`, `/1/token`,
`/2/files/issued`, `/1/user`) against the API spec you receive. The access token never
leaves the gateway.

## Going live with PFMS

PFMS does not publish an open REST API. Agencies receive an integration spec
(web service / SFTP XML) when onboarding. Set the secrets below, then adapt
`mapPfmsResponse()` in `gov-gateway/index.ts` to that spec:

```bash
supabase secrets set PFMS_BASE_URL=... PFMS_API_KEY=... PFMS_AGENCY_CODE=...
```

## Notes

- **Free-tier privacy:** on Google's free tier, prompts may be used to improve their
  models. The browser redacts Aadhaar, phone, account and IFSC numbers and e-mails
  before sending, and the system prompt tells the model never to ask for them.
- Demo logins ("Demo Student / Demo Officer") are not real Supabase sessions, so their
  data stays in the browser. Only real accounts sync to these tables.
