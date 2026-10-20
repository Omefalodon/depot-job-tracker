// Stand-in for supabase-js in UI tests: same calls the app uses, backed by window.__db (Node side).
var supabase = { createClient() {
  let session = null; const authCbs = []; const rtHandlers = [];
  const fire = (ev) => authCbs.forEach(cb => cb(ev, session));
  window.__rt = () => rtHandlers.forEach(h => h({}));
  function from(table) {
    const st = { table, op: "select", filters: [], row: null, ret: false, single: false };
    const b = {
      select() { st.ret = true; return b; }, order() { return b; }, limit() { return b; },
      eq(k, v) { st.filters.push([k, v]); return b; },
      insert(row) { st.op = "insert"; st.row = row; return b; },
      update(row) { st.op = "update"; st.row = row; return b; },
      upsert(row) { st.op = "upsert"; st.row = row; return b; },
      delete() { st.op = "delete"; return b; },
      maybeSingle() { st.single = true; return b; },
      then(res, rej) { return window.__db(JSON.stringify(st)).then(r => JSON.parse(r)).then(res, rej); }
    };
    return b;
  }
  const call = (st) => window.__db(JSON.stringify(st)).then(r => JSON.parse(r));
  const storage = { from(bucket) { return {
    upload(path, file, opts) { return call({ op: "upload", bucket, path, size: file.size, contentType: opts && opts.contentType }); },
    remove(paths) { return call({ op: "remove", bucket, paths }); },
    createSignedUrl(path, ttl, opts) { return call({ op: "sign", bucket, path, download: opts && opts.download }); }
  }; } };
  return {
    from, storage,
    auth: {
      async signInWithPassword({ email, password }) { const r = JSON.parse(await window.__db(JSON.stringify({ op: "login", email, password }))); if (r.error) return r; session = { user: r.user }; fire("SIGNED_IN"); return { data: { session }, error: null }; },
      async signOut() { await window.__db(JSON.stringify({ op: "logout" })); session = null; fire("SIGNED_OUT"); return { error: null }; },
      async updateUser() { return { data: {}, error: null }; },
      onAuthStateChange(cb) { authCbs.push(cb); setTimeout(() => cb("INITIAL_SESSION", session), 0); return { data: { subscription: { unsubscribe() { } } } }; }
    },
    channel() { const ch = { on(_t, _f, h) { rtHandlers.push(h); return ch; }, subscribe(cb) { setTimeout(() => cb("SUBSCRIBED"), 0); return ch; } }; return ch; },
    removeChannel() { rtHandlers.length = 0; }
  };
} };
