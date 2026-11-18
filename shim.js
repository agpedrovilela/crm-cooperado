/* CRM do Cooperado: ligação do app com o Supabase (versão instalável).
   Oferece ao app as mesmas funções que ele usava dentro do Claude:
   db (registros), assets (fotos), sample (IA em texto), downloads, user e __VOZ (áudio). */
(function () {
  'use strict';
  const conf = window.CRM_CONFIG || {};
  let URL_SB = (conf.supabaseUrl || '').trim().replace(/\/+$/, '');
  let KEY = (conf.supabaseKey || conf.supabaseAnonKey || '').trim();
  try {
    if (!URL_SB || !KEY) {
      const s = JSON.parse(localStorage.getItem('crm-config') || 'null');
      if (s && s.url && s.key) { URL_SB = s.url; KEY = s.key; }
    }
  } catch (e) {}

  window.__BLOB = './_blob/';
  const FOTOS = 'fotos';
  const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

  /* ---------- tela de entrada ---------- */
  const css = `.lg{position:fixed;inset:0;z-index:200;background:var(--bg,#F1F4F0);display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit}
  .lg[hidden]{display:none}.lg form{width:100%;max-width:380px;display:flex;flex-direction:column;gap:12px;background:var(--surface,#fff);border:1px solid var(--line,#D5DDD6);border-radius:16px;padding:22px}
  .lg h1{margin:0;font-size:1.35rem}.lg p{margin:0;color:var(--muted,#4D5C55);font-size:.92rem}.lg label{display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:.9rem}
  .lg input{font:inherit;font-size:16px;min-height:46px;padding:8px 12px;border:1.5px solid var(--line,#D5DDD6);border-radius:10px;background:var(--bg,#fff);color:inherit}
  .lg button{font:inherit;font-weight:700;min-height:48px;border:0;border-radius:10px;background:var(--leaf,#3B7A36);color:#fff;cursor:pointer}.lg button[disabled]{opacity:.6}
  .lg .err{color:var(--crit,#B3261E);min-height:1.2em}.lg .lk{background:none;color:var(--accent,#2747C7);min-height:auto;font-weight:600;padding:4px}`;
  function tela(modo, msg) {
    let el = document.getElementById('lg');
    if (!el) {
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      el = document.createElement('div'); el.id = 'lg'; el.className = 'lg'; document.body.appendChild(el);
    }
    el.hidden = false;
    if (modo === 'config') {
      el.innerHTML = `<form id="lg-f"><h1>Configurar o app</h1><p>Cole os dados do seu projeto Supabase (Project Settings, Data API e API Keys). Só precisa fazer isso uma vez neste aparelho.</p>
      <label>Project URL<input id="lg-u" placeholder="https://xxxx.supabase.co" autocomplete="off" required></label>
      <label>Publishable key (ou anon key)<input id="lg-k" placeholder="sb_publishable_..." autocomplete="off" required></label>
      <div class="err" id="lg-e">${msg || ''}</div><button type="submit">Salvar</button></form>`;
      document.getElementById('lg-f').onsubmit = (ev) => {
        ev.preventDefault();
        const u = document.getElementById('lg-u').value.trim().replace(/\/+$/, ''), k = document.getElementById('lg-k').value.trim();
        if (!/^https:\/\/.+/.test(u)) { document.getElementById('lg-e').textContent = 'A URL começa com https://'; return; }
        localStorage.setItem('crm-config', JSON.stringify({ url: u, key: k }));
        location.reload();
      };
      return;
    }
    el.innerHTML = `<form id="lg-f"><h1>CRM do Cooperado</h1><p>Entre com o e-mail e a senha que você criou no Supabase.</p>
      <label>E-mail<input id="lg-m" type="email" autocomplete="username" required></label>
      <label>Senha<input id="lg-s" type="password" autocomplete="current-password" required></label>
      <div class="err" id="lg-e">${msg || ''}</div><button type="submit" id="lg-b">Entrar</button>
      <button type="button" class="lk" id="lg-c">Trocar projeto Supabase</button></form>`;
    document.getElementById('lg-c').onclick = () => { localStorage.removeItem('crm-config'); tela('config'); };
    document.getElementById('lg-f').onsubmit = async (ev) => {
      ev.preventDefault();
      const b = document.getElementById('lg-b'), e = document.getElementById('lg-e');
      b.disabled = true; e.textContent = '';
      const { data, error } = await sb.auth.signInWithPassword({ email: document.getElementById('lg-m').value.trim(), password: document.getElementById('lg-s').value });
      b.disabled = false;
      if (error) { e.textContent = navigator.onLine === false ? 'Sem internet. O primeiro acesso precisa de sinal.' : 'E-mail ou senha incorretos.'; return; }
      el.hidden = true; entrou(data.session);
    };
  }

  /* ---------- sessão ---------- */
  let sb = null, uid = null, token = null, resolverPronto;
  const pronto = new Promise((r) => (resolverPronto = r));
  function entrou(sess) {
    if (!sess || !sess.user) return;
    uid = sess.user.id; token = sess.access_token; avisarSW(); resolverPronto(true);
  }
  function sessaoGuardada() {
    try {
      const ref = new URL(URL_SB).hostname.split('.')[0];
      const raw = localStorage.getItem('sb-' + ref + '-auth-token');
      const s = raw && JSON.parse(raw);
      return s && s.user ? s : null;
    } catch (e) { return null; }
  }
  async function tokenAtual() {
    try { const { data } = await sb.auth.getSession(); if (data && data.session) { token = data.session.access_token; uid = data.session.user.id; } } catch (e) {}
    return token;
  }
  function avisarSW() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller || !token) return;
    navigator.serviceWorker.controller.postMessage({ tipo: 'auth', url: URL_SB, key: KEY, uid, token });
  }
  async function iniciar() {
    if (!URL_SB || !KEY) { tela('config'); return; }
    if (!window.supabase || !window.supabase.createClient) { tela('config', 'Biblioteca do Supabase não carregou. Abra com internet uma vez.'); return; }
    sb = window.supabase.createClient(URL_SB, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    sb.auth.onAuthStateChange((ev, sess) => { if (sess) { token = sess.access_token; uid = sess.user.id; avisarSW(); } });
    if (location.hash === '#sair') { try { await sb.auth.signOut(); } catch (e) {} history.replaceState(null, '', location.pathname + '#hoje'); tela('login', 'Você saiu da conta.'); return; }
    let sess = null;
    try { const { data } = await sb.auth.getSession(); sess = data && data.session; } catch (e) {}
    if (sess) { entrou(sess); return; }
    const g = sessaoGuardada();
    if (g && navigator.onLine === false) { uid = g.user.id; token = g.access_token; resolverPronto(true); return; }
    tela('login');
  }

  /* ---------- erros ---------- */
  function mapErr(e, status) {
    const st = status || (e && e.status) || 0, code = (e && e.code) || '', msg = String((e && e.message) || '');
    if (!st || st >= 500 || st === 401 || code === 'PGRST301' || /fetch|network|load failed|timeout/i.test(msg)) return { code: 'unavailable', message: msg };
    if (st === 413 || /too large|exceeded the maximum/i.test(msg)) return { code: 'too_large', message: msg };
    if (st === 403 || code === '42501') return { code: 'not_granted', message: msg };
    return { code: 'invalid_request', message: msg };
  }
  async function exec(q) {
    let r;
    try { r = await q; } catch (e) { throw { code: 'unavailable', message: String(e && e.message || e) }; }
    if (r.error) throw mapErr(r.error, r.status);
    return r.data;
  }

  /* ---------- registros (db) ---------- */
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const merge = (a, b) => { const r = isObj(a) ? { ...a } : {}; for (const k in b) r[k] = isObj(b[k]) && isObj(r[k]) ? merge(r[k], b[k]) : b[k]; return r; };
  const cols = {};
  function estado(col) {
    return cols[col] || (cols[col] = { map: new Map(), subs: new Set(), carregado: false, t: null, ultimo: 0 });
  }
  function emitir(col, agora) {
    const s = estado(col); clearTimeout(s.t);
    const vai = () => {
      const docs = [...s.map].map(([id, d]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(d)) }));
      const snap = { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
      s.subs.forEach((f) => { try { f.next(snap); } catch (e) { console.error(e); } });
    };
    if (agora) vai(); else s.t = setTimeout(vai, 30);
  }
  async function carregar(col) {
    const s = estado(col);
    try {
      const todos = []; let de = 0;
      for (;;) {
        const lote = await exec(sb.from('docs').select('id,data').eq('col', col).order('id').range(de, de + 999));
        todos.push(...lote); if (lote.length < 1000) break; de += 1000;
      }
      s.map = new Map(todos.map((x) => [x.id, x.data])); s.carregado = true; s.ultimo = Date.now(); emitir(col);
    } catch (e) {
      if (!s.carregado) s.subs.forEach((f) => f.err && f.err(e));
    }
  }
  let canal = null;
  function tempoReal() {
    if (canal) return;
    canal = sb.channel('crm-docs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, (p) => {
        const n = p.new || {}, o = p.old || {}, col = n.col || o.col; if (!col || !cols[col]) return;
        const s = cols[col];
        if (p.eventType === 'DELETE') s.map.delete(o.id); else s.map.set(n.id, n.data);
        emitir(col);
      })
      .subscribe((st) => { if (st === 'SUBSCRIBED') Object.keys(cols).forEach((c) => { if (Date.now() - cols[c].ultimo > 5000) carregar(c); }); });
  }
  const recarregarTudo = () => { if (navigator.onLine === false || !sb) return; Object.keys(cols).forEach(carregar); };
  addEventListener('online', recarregarTudo);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Object.keys(cols).forEach((c) => { if (Date.now() - cols[c].ultimo > 60000) carregar(c); }); });
  setInterval(() => { if (document.visibilityState === 'visible') recarregarTudo(); }, 5 * 60 * 1000);

  function parte(path) { const i = path.indexOf('/'); return { col: path.slice(0, i), id: path.slice(i + 1) }; }
  const db = {
    collection(col) {
      return {
        onSnapshot(next, err) {
          const s = estado(col), sub = { next, err }; s.subs.add(sub);
          if (s.carregado) emitir(col); else carregar(col);
          tempoReal();
          return () => s.subs.delete(sub);
        },
      };
    },
    doc(path) {
      const { col, id } = parte(path);
      return {
        id,
        async set(data) {
          await exec(sb.from('docs').upsert({ user_id: uid, col, id, data, updated_at: new Date().toISOString() }, { onConflict: 'user_id,col,id' }));
          estado(col).map.set(id, data); emitir(col, true);
        },
        async update(patch) {
          const ok = await exec(sb.rpc('doc_merge', { p_col: col, p_id: id, p_patch: patch }));
          if (ok === false) throw { code: 'invalid_argument', message: 'registro não existe' };
          const s = estado(col); if (s.map.has(id)) { s.map.set(id, merge(s.map.get(id), patch)); emitir(col, true); }
        },
        async delete() {
          await exec(sb.from('docs').delete().eq('col', col).eq('id', id));
          estado(col).map.delete(id); emitir(col, true);
        },
      };
    },
  };

  /* ---------- fotos (assets) ---------- */
  const assets = {
    aceitaId: true,
    async upload(blob, o = {}) {
      const id = o.id && /^[\w-]{6,64}$/.test(o.id) ? o.id : hex(16);
      const type = o.type || blob.type || 'image/jpeg';
      let r;
      try { r = await sb.storage.from(FOTOS).upload(uid + '/' + id, blob, { contentType: type, upsert: true, cacheControl: '31536000' }); }
      catch (e) { throw { code: 'unavailable', message: String(e && e.message || e) }; }
      if (r.error) throw mapErr(r.error, r.error.statusCode ? +r.error.statusCode : r.error.status);
      try { const c = await caches.open('crm-fotos'); await c.put(new Request(new URL('./_blob/' + id, location.href).href), new Response(blob, { headers: { 'Content-Type': type } })); } catch (e) {}
      return { id, url: './_blob/' + id, sizeBytes: blob.size, contentType: type };
    },
  };

  /* ---------- IA (texto e áudio) ---------- */
  async function chamar(body, ehForm) {
    const tk = await tokenAtual();
    let r;
    try {
      r = await fetch(URL_SB + '/functions/v1/ia', {
        method: 'POST',
        headers: Object.assign({ Authorization: 'Bearer ' + tk, apikey: KEY }, ehForm ? {} : { 'Content-Type': 'application/json' }),
        body: ehForm ? body : JSON.stringify(body),
      });
    } catch (e) { throw { code: 'unavailable', message: 'Sem conexão com o servidor.' }; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 404) throw { code: 'sem_funcao', message: 'A função de IA ainda não foi publicada no Supabase (nome: ia).' };
      if (r.status >= 500 && j.codigo === 'unavailable') throw { code: 'unavailable', message: j.erro };
      throw { code: j.codigo || 'erro', message: j.erro || 'Erro ' + r.status };
    }
    return j;
  }
  const sample = { async json(prompt) { const j = await chamar({ acao: 'json', prompt }); return j.json; } };
  window.__VOZ = {
    async processar(blob, meta) {
      const ext = /mp4|m4a|aac/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : /wav/.test(blob.type) ? 'wav' : 'webm';
      const fd = new FormData(); fd.append('audio', blob, 'audio.' + ext); fd.append('meta', JSON.stringify(meta));
      return chamar(fd, true);
    },
  };

  /* ---------- downloads e usuário ---------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: /\.csv$/i.test(filename) ? 'text/csv;charset=utf-8' : 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      return { status: 'saved' };
    },
  };
  const user = { can: async () => true, id: async () => uid };

  const caps = { db, assets, sample, downloads, user };
  window.claude = { use: async (n) => { await pronto; return caps[n] || null; } };

  /* ---------- funcionamento sem internet ---------- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (ev) => { if (ev.data && ev.data.tipo === 'pedeToken') { tokenAtual().then(avisarSW); } });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      avisarSW();
      document.querySelectorAll('img[src*="_blob/"]').forEach((i) => { const s = i.src; i.removeAttribute('src'); i.src = s; });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
