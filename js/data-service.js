/* ===========================================================================
   TRIBALSCHOLAR — DATA SERVICE
   One place that decides where feature data lives:

   • Real Supabase session  → rows are mirrored to Supabase tables
                              (payments, grievances, chat_messages,
                               integration_logs) and pulled back on render.
   • Demo / fallback login  → localStorage only (works offline, no backend).

   localStorage stays the fast local cache in both modes, so the existing
   synchronous readStore()/writeStore() code keeps working unchanged.

   Loads AFTER script.js. Uses its globals: supabaseClient, currentUser,
   currentProfile.
   =========================================================================== */
(function () {
  "use strict";

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUuid = v => UUID_RE.test(String(v || ""));

  /* localStorage key → Supabase table mapping. Each row keeps a few
     indexed columns (for row-level security + filtering) and the full
     object in `data`, so the front-end shape can evolve freely. */
  const COLLECTIONS = {
    tribalScholarPayments: {
      table: "payments",
      key: "id",
      conflict: "id",
      writers: "officer",            // only officers create/advance payments
      owner: p => p.userId,
      toRow: p => ({
        id: p.id,
        application_id: p.applicationId,
        user_id: p.userId,
        email: p.email || null,
        stage: p.stage,
        amount: p.amount,
        data: p,
        updated_at: lastEventAt(p)
      })
    },
    tribalScholarGrievances: {
      table: "grievances",
      key: "ticketId",
      conflict: "ticket_id",
      writers: "owner-or-officer",   // students raise/reopen, officers update
      owner: t => t.userId,
      toRow: t => ({
        ticket_id: t.ticketId,
        user_id: t.userId,
        email: t.email || null,
        status: t.status,
        department: t.department,
        data: t,
        updated_at: lastEventAt(t)
      })
    }
  };

  function lastEventAt(obj) {
    const h = Array.isArray(obj.history) ? obj.history : [];
    return h[h.length - 1]?.at || new Date().toISOString();
  }

  /* Tables that failed once (not migrated yet, RLS denied, offline) are
     skipped for the rest of the session instead of spamming errors.
     Reads and writes are tracked separately so a rejected write never
     stops a user from seeing synced data. */
  const unavailable = new Set();
  const unwritable = new Set();

  function isRemote() {
    return Boolean(currentUser && !currentUser.is_fallback && isUuid(currentUser.id));
  }

  function isOfficer() {
    return currentProfile?.role === "officer";
  }

  function readLocal(key) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  function markUnavailable(table, error) {
    if (!unavailable.has(table)) {
      console.info(`[DataService] "${table}" not reachable in Supabase — using this device only.`, error?.message || error);
    }
    unavailable.add(table);
  }

  /* Push local rows the current user is allowed to write. Fire-and-forget:
     callers never wait on the network. */
  async function mirror(localKey, rows) {
    const cfg = COLLECTIONS[localKey];
    if (!cfg || !isRemote() || unwritable.has(cfg.table)) return;
    if (cfg.writers === "officer" && !isOfficer()) return;

    const writable = (rows || []).filter(r => {
      const owner = cfg.owner(r);
      if (!isUuid(owner)) return false;          // demo-only rows stay local
      return isOfficer() || owner === currentUser.id;
    });
    if (!writable.length) return;

    try {
      const { error } = await supabaseClient
        .from(cfg.table)
        .upsert(writable.map(cfg.toRow), { onConflict: cfg.conflict });
      if (error) {
        unwritable.add(cfg.table);
        console.info(`[DataService] could not save "${cfg.table}" to Supabase — kept on this device.`, error.message);
      }
    } catch (e) {
      unwritable.add(cfg.table);
    }
  }

  /* Pull rows visible to this user (RLS decides) and merge them into the
     local cache, keeping whichever copy has the newer last event. */
  async function pull(localKey) {
    const cfg = COLLECTIONS[localKey];
    if (!cfg || !isRemote() || unavailable.has(cfg.table)) return false;

    try {
      const { data, error } = await supabaseClient
        .from(cfg.table)
        .select("data")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) {
        markUnavailable(cfg.table, error);
        return false;
      }

      const local = readLocal(localKey);
      const byKey = new Map(local.map(r => [r[cfg.key], r]));
      (data || []).forEach(({ data: remote }) => {
        if (!remote || !remote[cfg.key]) return;
        const mine = byKey.get(remote[cfg.key]);
        if (!mine || new Date(lastEventAt(remote)) > new Date(lastEventAt(mine))) {
          byKey.set(remote[cfg.key], remote);
        }
      });
      localStorage.setItem(localKey, JSON.stringify([...byKey.values()]));
      return true;
    } catch (e) {
      markUnavailable(cfg.table, e);
      return false;
    }
  }

  /* Append-only logs. Silently no-op for demo sessions. */
  async function insertLog(table, row) {
    if (!isRemote() || unavailable.has(table)) return;
    try {
      const { error } = await supabaseClient.from(table).insert({ ...row, user_id: currentUser.id });
      if (error) markUnavailable(table, error);
    } catch (e) {
      markUnavailable(table, e);
    }
  }

  function logChat(sessionId, role, content, meta = {}) {
    return insertLog("chat_messages", {
      session_id: sessionId,
      role,
      content: String(content).slice(0, 4000),
      lang: meta.lang || null,
      source: meta.source || null
    });
  }

  function logIntegration(service, action, mode, status, detail = {}) {
    return insertLog("integration_logs", {
      service,
      action,
      mode,
      status,
      detail
    });
  }

  /* Call a Supabase Edge Function. Never throws: returns
     { ok, status, data } and status 0 when unreachable / not deployed. */
  async function callFunction(name, body, { timeoutMs = 15000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY };
      if (isRemote()) {
        const { data } = await supabaseClient.auth.getSession();
        const token = data?.session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body || {}),
        signal: ctrl.signal
      });
      let data = null;
      try {
        data = await res.json();
      } catch {}
      return { ok: res.ok, status: res.status, data };
    } catch (error) {
      return { ok: false, status: 0, data: null, error };
    } finally {
      clearTimeout(timer);
    }
  }

  function status() {
    if (!currentUser) return { mode: "signed-out", label: "Not signed in" };
    if (!isRemote()) return { mode: "local", label: "Demo session — stored on this device" };
    const down = [...new Set([...unavailable, ...unwritable])];
    return down.length
      ? { mode: "partial", label: `Supabase connected · local fallback for: ${down.join(", ")}` }
      : { mode: "remote", label: "Supabase connected — synced to cloud database" };
  }

  window.DataService = { mirror, pull, logChat, logIntegration, callFunction, status, isRemote };
})();
