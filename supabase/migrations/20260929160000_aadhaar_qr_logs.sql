-- Aadhaar Secure QR checks (aadhaar-qr Edge Function) are logged to
-- integration_logs alongside DigiLocker / PFMS / AI calls.
alter table public.integration_logs
  drop constraint if exists integration_logs_service_check;

alter table public.integration_logs
  add constraint integration_logs_service_check
  check (service in ('digilocker', 'pfms', 'ai', 'aadhaar'));
