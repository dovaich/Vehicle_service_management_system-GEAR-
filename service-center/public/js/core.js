/* GEAR core: state, i18n, API, UI helpers, router */
(function () {
  const G = (window.G = { pages: {}, cache: {}, state: {} });

  // ---------------- storage-safe prefs ----------------
  const pref = (k, d) => { try { return localStorage.getItem('gear_' + k) || d; } catch (_) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem('gear_' + k, v); } catch (_) { /* ignore */ } };
  G.pref = pref; G.setPref = setPref;

  // ---------------- i18n ----------------
  G.lang = pref('lang', 'ar');
  G.t = (k) => { const v = window.I18N[k]; return v ? v[G.lang === 'ar' ? 0 : 1] : k; };
  G.tl = (ar, en) => (G.lang === 'ar' ? ar || en : en || ar) || '';
  G.applyLang = () => {
    document.documentElement.lang = G.lang;
    document.documentElement.dir = G.lang === 'ar' ? 'rtl' : 'ltr';
  };
  G.toggleLang = () => { G.lang = G.lang === 'ar' ? 'en' : 'ar'; setPref('lang', G.lang); G.applyLang(); G.renderShell(); G.route(); };
  G.theme = pref('theme', 'light');
  G.applyTheme = () => { document.documentElement.dataset.theme = G.theme; };
  G.toggleTheme = () => { G.theme = G.theme === 'dark' ? 'light' : 'dark'; setPref('theme', G.theme); G.applyTheme(); };
  const t = G.t;

  // ---------------- formatting ----------------
  const esc = (G.esc = (s) => (s === null || s === undefined ? '' : String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))));
  // Latin digits in both languages (plates, VINs and invoices stay consistent)
  G.num = (n, d = 2, min = 0) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: d });
  G.money = (n) => `${G.num(n, 2, 2)} ${esc(G.settings.currency || '')}`;
  G.int = (n) => (n === null || n === undefined || n === '' ? '' : G.num(n, 0));
  G.fdate = (s) => (s ? String(s).slice(0, 10) : '');
  G.fdt = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');
  G.today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  G.monthStart = () => G.today().slice(0, 8) + '01';
  G.nowLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  G.empName = (id) => { const e = (G.cache.employees || []).find((x) => x.id === Number(id)); return e ? e.name : ''; };
  G.vehLabel = (v) => {
    const model = v.model && v.series && String(v.model).startsWith(v.series) ? v.model : [v.series, v.model].filter(Boolean).join(' ');
    return [v.plate ? `\u2068${v.plate}\u2069` : '', [v.make && v.make !== 'BMW' ? v.make : '', model].filter(Boolean).join(' '), v.year].filter(Boolean).join(' - ');
  };

  // ---------------- API ----------------
  G.api = async (method, url, body) => {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
      });
    } catch (e) {
      const err = new Error(t('err_network')); err.code = 'network'; throw err;
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && !url.includes('/api/auth/')) { G.user = null; G.showLogin(); }
      const code = (data && data.error) || 'server_error';
      let msg = t('err_' + code);
      if (msg === 'err_' + code) msg = code;
      if (data && data.field) msg += `: ${t(data.field.replace(/_id$/, ''))}`;
      if (data && data.part) msg += ` (${data.part} - ${t('in_stock')}: ${data.available})`;
      if (data && data.due !== undefined) msg += ` (${t('due')}: ${data.due})`;
      const err = new Error(msg); err.code = code; err.data = data; throw err;
    }
    return data;
  };
  G.get = (u) => G.api('GET', u);
  G.post = (u, b) => G.api('POST', u, b || {});
  G.put = (u, b) => G.api('PUT', u, b || {});
  G.del = (u) => G.api('DELETE', u);
  G.qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  G.loadEmployees = async (force) => {
    if (!G.cache.employees || force) G.cache.employees = (await G.get('/api/employees?limit=1000')).rows;
    return G.cache.employees;
  };
  G.loadServiceTypes = async (force) => {
    if (!G.cache.service_types || force) G.cache.service_types = (await G.get('/api/service-types?limit=1000&active=1')).rows;
    return G.cache.service_types;
  };
  G.loadAccounts = async (force) => {
    if (!G.cache.accounts || force) G.cache.accounts = (await G.get('/api/accounts?active=1')).rows;
    return G.cache.accounts;
  };

  // ---------------- permissions ----------------
  G.can = (roles) => G.user && (roles === '*' || roles.includes(G.user.role));
  G.R = {
    FRONT: ['admin', 'manager', 'advisor'], SHOP: ['admin', 'manager', 'advisor', 'technician'], MONEY: ['admin', 'manager', 'accountant'],
    STORE: ['admin', 'manager', 'storekeeper'], MGMT: ['admin', 'manager'], ADMIN: ['admin'], BILL: ['admin', 'manager', 'advisor', 'accountant'],
    SUPP: ['admin', 'manager', 'accountant', 'storekeeper'],
  };

  // ---------------- toast ----------------
  G.toast = (msg, type = 'ok') => {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, type === 'err' ? 5000 : 2500);
  };
  G.fail = (e) => { console.error(e); G.toast(e.message || String(e), 'err'); };

  // ---------------- modal ----------------
  G.modal = ({ title, body, wide, onMount, footer }) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="${t('close')}">✕</button></div>
      <div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ''}</div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    const close = () => { wrap.remove(); if (!document.querySelector('.modal-wrap')) document.body.classList.remove('no-scroll'); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    wrap.close = close;
    if (onMount) onMount(wrap.querySelector('.modal'), close);
    const first = wrap.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
    if (first && window.innerWidth > 700) setTimeout(() => first.focus(), 50);
    return wrap;
  };
  G.confirm = (msg) => new Promise((resolve) => {
    G.modal({
      title: t('confirm'), body: `<p class="confirm-msg">${esc(msg)}</p>`,
      footer: `<button class="btn" data-close>${t('no')}</button><button class="btn btn-danger" data-yes>${t('yes')}</button>`,
      onMount: (m, close) => {
        m.querySelector('[data-yes]').onclick = () => { close(); resolve(true); };
        m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => resolve(false)));
      },
    });
  });

  // ---------------- forms ----------------
  // field: {name, label, type, options:[[value,label]], required, span, placeholder, attrs, help, step}
  G.opt = (arr, prefix) => arr.map((v) => [v, t(prefix ? prefix + v : v)]);
  G.field = (f, val) => {
    const id = 'f_' + f.name + '_' + Math.random().toString(36).slice(2, 7);
    const label = f.label !== undefined ? f.label : t(f.name);
    const req = f.required ? 'required' : '';
    const v = val === null || val === undefined ? (f.default !== undefined ? f.default : '') : val;
    let input;
    const attrs = f.attrs || '';
    switch (f.type) {
      case 'textarea':
        input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 3}" ${req} ${attrs} placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
        break;
      case 'select': {
        const opts = (typeof f.options === 'function' ? f.options() : f.options) || [];
        input = `<select id="${id}" name="${f.name}" ${req} ${attrs}>${f.noEmpty ? '' : `<option value="">${t('select')}</option>`}${opts.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
        break;
      }
      case 'checkbox':
        return `<label class="check ${f.span ? 'span-' + f.span : ''}"><input type="checkbox" name="${f.name}" ${Number(v) || v === true ? 'checked' : ''} ${attrs}> <span>${esc(label)}</span></label>`;
      case 'lookup':
        input = G.lookupHtml(f, v, id);
        break;
      case 'chips': {
        const set = new Set(Array.isArray(v) ? v : String(v || '').split(',').filter(Boolean));
        input = `<div class="chips" data-chips="${f.name}">${f.options.map(([ov, ol]) => `<label class="chip"><input type="checkbox" value="${esc(ov)}" ${set.has(ov) ? 'checked' : ''}><span>${esc(ol)}</span></label>`).join('')}</div>`;
        break;
      }
      case 'segment':
        input = `<div class="segment">${f.options.map(([ov, ol]) => `<label><input type="radio" name="${f.name}" value="${esc(ov)}" ${String(ov) === String(v) ? 'checked' : ''}><span>${esc(ol)}</span></label>`).join('')}</div>`;
        break;
      default:
        input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${req} ${f.step ? `step="${f.step}"` : f.type === 'number' ? 'step="any"' : ''} ${attrs} placeholder="${esc(f.placeholder || '')}" ${f.list ? `list="${f.list}"` : ''} ${f.type === 'number' || f.type === 'tel' ? 'inputmode="decimal"' : ''}>`;
    }
    return `<div class="field ${f.span ? 'span-' + f.span : ''}"><label for="${id}">${esc(label)}${f.required ? ' <b class="req">*</b>' : ''}</label>${input}${f.help ? `<small class="help">${esc(f.help)}</small>` : ''}</div>`;
  };
  G.formHtml = (fields, values = {}) => `<div class="form-grid">${fields.filter((f) => !f.hidden || !f.hidden(values)).map((f) => (f.html ? f.html : G.field(f, values[f.name]))).join('')}</div>`;
  G.readForm = (root, fields) => {
    const out = {};
    root.querySelectorAll('[name]').forEach((el) => {
      if (el.closest('.lookup') && el.type !== 'hidden') return;
      if (el.type === 'checkbox') out[el.name] = el.checked ? 1 : 0;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    });
    root.querySelectorAll('[data-chips]').forEach((c) => {
      out[c.dataset.chips] = [...c.querySelectorAll('input:checked')].map((i) => i.value).join(',');
    });
    if (fields) {
      for (const f of fields) {
        if (f.type === 'number' && out[f.name] !== undefined && out[f.name] !== '') out[f.name] = Number(out[f.name]);
      }
    }
    return out;
  };
  G.validate = (root) => {
    let ok = true;
    root.querySelectorAll('[required]').forEach((el) => {
      const empty = !String(el.value || '').trim();
      el.closest('.field') && el.closest('.field').classList.toggle('invalid', empty);
      if (empty) ok = false;
    });
    root.querySelectorAll('.lookup[data-required]').forEach((l) => {
      const empty = !l.querySelector('input[type=hidden]').value;
      l.closest('.field').classList.toggle('invalid', empty);
      if (empty) ok = false;
    });
    if (!ok) G.toast(t('err_required'), 'err');
    return ok;
  };
  // Modal with a form; onSubmit(data) -> Promise
  G.formDialog = ({ title, fields, values = {}, onSubmit, wide, extra, onMount, submitLabel }) => G.modal({
    title, wide,
    body: `<form class="dlg-form" novalidate>${G.formHtml(fields, values)}${extra || ''}<button type="submit" hidden></button></form>`,
    footer: `<button class="btn" data-close type="button">${t('cancel')}</button><button class="btn btn-primary" data-submit type="button">${submitLabel || t('save')}</button>`,
    onMount: (m, close) => {
      const form = m.querySelector('form');
      G.bindLookups(form);
      const submit = async () => {
        if (!G.validate(form)) return;
        const btn = m.querySelector('[data-submit]');
        btn.disabled = true;
        try {
          await onSubmit(G.readForm(form, fields), close, form);
        } catch (e) { G.fail(e); } finally { btn.disabled = false; }
      };
      m.querySelector('[data-submit]').onclick = submit;
      form.onsubmit = (e) => { e.preventDefault(); submit(); };
      if (onMount) onMount(m, form, close);
    },
  });

  // ---------------- lookups (remote search select) ----------------
  G.LOOKUPS = {
    customers: { url: '/api/customers', label: (r) => `${r.name}${r.phone ? ' - ' + r.phone : ''}` },
    vehicles: { url: '/api/vehicles', label: (r) => `${G.vehLabel(r)} | ${r.customer_name || ''}` },
    parts: { url: '/api/parts', extra: 'active=1', label: (r) => `${r.part_no ? r.part_no + ' | ' : ''}${G.tl(r.name_ar, r.name_en)} (${t('in_stock')}: ${G.num(r.qty)}) - ${G.num(r.price)}` },
    suppliers: { url: '/api/suppliers', label: (r) => `${r.name}${r.phone ? ' - ' + r.phone : ''}` },
    receptions: { url: '/api/receptions', label: (r) => `${r.no} | ${r.plate || ''} | ${r.customer_name || ''}` },
  };
  G.lookupHtml = (f, v, id) => `<div class="lookup" data-res="${f.res}" ${f.required ? 'data-required' : ''} ${f.filter ? `data-filter="${esc(f.filter)}"` : ''}>
      <input id="${id}" type="search" autocomplete="off" placeholder="${esc(f.placeholder || t('search') + '...')}" value="${esc(f.display || '')}">
      <input type="hidden" name="${f.name}" value="${esc(v)}">
      <div class="lookup-list" hidden></div></div>`;
  G.bindLookups = (root) => {
    root.querySelectorAll('.lookup:not([data-bound])').forEach((box) => {
      box.dataset.bound = 1;
      const cfg = G.LOOKUPS[box.dataset.res];
      const input = box.querySelector('input[type=search]');
      const hidden = box.querySelector('input[type=hidden]');
      const list = box.querySelector('.lookup-list');
      let timer; let rows = []; let seq = 0;
      const search = async () => {
        const my = ++seq;
        try {
          const extra = [cfg.extra, box.dataset.filter].filter(Boolean).join('&');
          const found = (await G.get(`${cfg.url}?limit=15&q=${encodeURIComponent(input.value.trim())}${extra ? '&' + extra : ''}`)).rows;
          if (my !== seq || hidden.value) return; // stale response or already picked
          rows = found;
          list.innerHTML = rows.length ? rows.map((r, i) => `<div class="lookup-item" data-i="${i}">${esc(cfg.label(r))}</div>`).join('') : `<div class="lookup-empty">${t('no_data')}</div>`;
          list.hidden = false;
        } catch (e) { G.fail(e); }
      };
      input.addEventListener('input', () => { hidden.value = ''; clearTimeout(timer); timer = setTimeout(search, 250); });
      input.addEventListener('focus', () => { if (!hidden.value) search(); });
      input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 200));
      list.addEventListener('mousedown', (e) => {
        const it = e.target.closest('.lookup-item');
        if (!it) return;
        e.preventDefault();
        const r = rows[it.dataset.i];
        seq++;
        hidden.value = r.id;
        input.value = cfg.label(r);
        list.hidden = true;
        box.closest('.field') && box.closest('.field').classList.remove('invalid');
        box.dispatchEvent(new CustomEvent('pick', { detail: r, bubbles: true }));
      });
    });
  };

  // ---------------- tables (responsive: cards on mobile) ----------------
  // columns: [{key, label, render(row), cls, hideMobile}]
  G.table = (columns, rows, opts = {}) => {
    if (!rows || !rows.length) return `<div class="empty">${t('no_data')}</div>`;
    return `<div class="table-wrap"><table class="tbl ${opts.cls || ''}">
      <thead><tr>${columns.map((c) => `<th class="${c.cls || ''}">${esc(c.label !== undefined ? c.label : t(c.key))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-i="${i}" ${opts.rowLink ? `data-href="${esc(opts.rowLink(r))}" class="clickable ${opts.rowCls ? opts.rowCls(r) : ''}"` : opts.rowCls ? `class="${opts.rowCls(r)}"` : ''}>${columns.map((c) => `<td class="${c.cls || ''} ${c.hideMobile ? 'hide-m' : ''}" data-label="${esc(c.label !== undefined ? c.label : t(c.key))}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>
      ${opts.foot ? `<tfoot>${opts.foot}</tfoot>` : ''}</table></div>`;
  };
  G.bindRowLinks = (root) => root.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, select, label')) return;
    location.hash = tr.dataset.href;
  }));
  G.badge = (status, prefix = '') => `<span class="badge b-${esc(status)}">${esc(t(prefix + status))}</span>`;
  G.csv = (filename, columns, rows) => {
    const cell = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
    const lines = [columns.map((c) => cell(c.label || t(c.key))).join(',')].concat(rows.map((r) => columns.map((c) => cell(c.csv ? c.csv(r) : r[c.key])).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename + '.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ---------------- generic list page ----------------
  // cfg: {title, res, columns, fields, filters:[field], canWrite, rowLink, newValues, onSaved, extraButtons, csvName, defaultQuery}
  G.listPage = async (view, cfg) => {
    const state = { q: '', offset: 0, rows: [], filters: { ...(cfg.defaultQuery || {}) } };
    const canWrite = cfg.canWrite === undefined ? true : cfg.canWrite;
    view.innerHTML = `<div class="page-head"><h2>${esc(cfg.title)}</h2><div class="head-actions">
        ${cfg.extraButtons || ''}
        ${cfg.csvName ? `<button class="btn" data-csv>⬇ ${t('export_csv')}</button>` : ''}
        ${canWrite && (cfg.fields || cfg.onNew) ? `<button class="btn btn-primary" data-new>＋ ${t('add')}</button>` : ''}</div></div>
      <div class="toolbar"><input type="search" class="search" placeholder="${t('search_placeholder')}" data-q>
        ${(cfg.filters || []).map((f) => `<div class="tb-filter">${G.field({ ...f, attrs: 'data-filter' }, state.filters[f.name])}</div>`).join('')}</div>
      ${cfg.top || ''}
      <div data-list><div class="loading">${t('loading')}</div></div>
      <div class="more-wrap" data-more hidden><button class="btn">${t('load_more')}</button></div>`;
    const listEl = view.querySelector('[data-list]');
    const moreEl = view.querySelector('[data-more]');
    const load = async (append) => {
      try {
        const q = G.qs({ ...state.filters, q: state.q, limit: 100, offset: state.offset });
        const data = await G.get(`/api/${cfg.res}?${q}`);
        state.rows = append ? state.rows.concat(data.rows) : data.rows;
        state.total = data.total;
        listEl.innerHTML = `<div class="count-line">${t('count')}: ${G.int(data.total)}</div>` + G.table(cfg.columns, state.rows, { rowLink: cfg.rowLink, rowCls: cfg.rowCls, foot: cfg.foot ? cfg.foot(state.rows) : '' });
        G.bindRowLinks(listEl);
        listEl.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => edit(state.rows[b.closest('tr').dataset.i]));
        listEl.querySelectorAll('[data-delete]').forEach((b) => b.onclick = () => remove(state.rows[b.closest('tr').dataset.i]));
        if (cfg.bind) cfg.bind(listEl, state.rows, () => load());
        moreEl.hidden = state.rows.length >= data.total;
      } catch (e) { G.fail(e); listEl.innerHTML = ''; }
    };
    const edit = (row) => {
      if (cfg.onEdit) return cfg.onEdit(row, () => load());
      G.formDialog({
        title: `${t('edit')} - ${cfg.title}`, fields: typeof cfg.fields === 'function' ? cfg.fields(row) : cfg.fields, values: row, wide: cfg.wide,
        onSubmit: async (data, close) => { await G.put(`/api/${cfg.res}/${row.id}`, data); close(); G.toast(t('saved')); if (cfg.onSaved) cfg.onSaved(); load(); },
      });
    };
    const remove = async (row) => {
      if (!(await G.confirm(t('confirm_delete')))) return;
      try { await G.del(`/api/${cfg.res}/${row.id}`); G.toast(t('deleted')); if (cfg.onSaved) cfg.onSaved(); load(); } catch (e) { G.fail(e); }
    };
    let timer;
    view.querySelector('[data-q]').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value; state.offset = 0; load(); }, 300); });
    view.querySelectorAll('[data-filter]').forEach((el) => el.addEventListener('change', () => {
      state.filters[el.name] = el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value; state.offset = 0; load();
    }));
    moreEl.querySelector('button').onclick = () => { state.offset = state.rows.length; load(true); };
    const nb = view.querySelector('[data-new]');
    if (nb) nb.onclick = () => {
      if (cfg.onNew) return cfg.onNew(() => load());
      G.formDialog({
        title: `${t('add')} - ${cfg.title}`, fields: typeof cfg.fields === 'function' ? cfg.fields({}) : cfg.fields, values: cfg.newValues ? cfg.newValues() : {}, wide: cfg.wide,
        onSubmit: async (data, close) => { const r = await G.post(`/api/${cfg.res}`, data); close(); G.toast(t('saved')); if (cfg.onSaved) cfg.onSaved(r); if (cfg.afterCreate) cfg.afterCreate(r); else load(); },
      });
    };
    const cb = view.querySelector('[data-csv]');
    if (cb) cb.onclick = async () => {
      const q = G.qs({ ...state.filters, q: state.q, limit: 2000 });
      const data = await G.get(`/api/${cfg.res}?${q}`);
      G.csv(cfg.csvName, cfg.csvColumns || cfg.columns.filter((c) => c.key && c.key !== 'actions'), data.rows);
    };
    if (cfg.after) cfg.after(view, () => load());
    await load();
    return { reload: () => load() };
  };
  G.rowActions = (canEdit, canDelete) => (canEdit || canDelete ? {
    key: 'actions', cls: 'actions-col', render: () => `${canEdit ? `<button class="icon-btn" data-edit title="${t('edit')}">✎</button>` : ''}${canDelete ? `<button class="icon-btn danger" data-delete title="${t('delete')}">🗑</button>` : ''}`,
  } : null);

  // ---------------- tabs ----------------
  G.tabs = (root, tabs, onChange, initial) => {
    const key = initial || tabs[0][0];
    root.innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === key ? 'active' : ''}" data-tab="${k}">${esc(l)}</button>`).join('')}</div><div class="tab-body"></div>`;
    const body = root.querySelector('.tab-body');
    root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => {
      root.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
      onChange(b.dataset.tab, body);
    });
    onChange(key, body);
  };

  // ---------------- photos ----------------
  G.resizeImage = (file, max = 1600) => new Promise((resolve, reject) => {
    if (file.type === 'application/pdf') { const r = new FileReader(); r.onload = () => resolve({ data: r.result, mime: file.type }); r.onerror = reject; r.readAsDataURL(file); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ data: c.toDataURL('image/jpeg', 0.82), mime: 'image/jpeg' });
    };
    img.onerror = reject;
    img.src = url;
  });
  G.photosBlock = (refType, refId, canEdit = true) => `<div class="photos" data-photos="${refType}:${refId}">
      <div class="photo-grid"></div>
      ${canEdit ? `<label class="btn btn-sm upload-btn">📷 ${t('add_photos')}<input type="file" accept="image/*,application/pdf" capture="environment" multiple hidden></label>` : ''}</div>`;
  G.bindPhotos = async (root) => {
    for (const box of root.querySelectorAll('[data-photos]')) {
      const [refType, refId] = box.dataset.photos.split(':');
      const grid = box.querySelector('.photo-grid');
      const render = async () => {
        const rows = (await G.get(`/api/attachments?ref_type=${refType}&ref_id=${refId}`)).rows;
        grid.innerHTML = rows.map((a) => `<div class="photo">${a.mime === 'application/pdf' ? `<a href="/uploads/${a.filename}" target="_blank" class="pdf">PDF</a>` : `<a href="/uploads/${a.filename}" target="_blank"><img src="/uploads/${a.filename}" loading="lazy" alt=""></a>`}
          ${G.can(G.R.SHOP) ? `<button class="icon-btn danger" data-del-photo="${a.id}">✕</button>` : ''}</div>`).join('') || `<div class="muted">${t('no_data')}</div>`;
        grid.querySelectorAll('[data-del-photo]').forEach((b) => b.onclick = async () => {
          if (!(await G.confirm(t('confirm_delete')))) return;
          await G.del('/api/attachments/' + b.dataset.delPhoto); render();
        });
      };
      const input = box.querySelector('input[type=file]');
      if (input) input.onchange = async () => {
        G.toast(t('uploading'));
        try {
          for (const f of input.files) {
            const { data, mime } = await G.resizeImage(f);
            await G.post('/api/attachments', { ref_type: refType, ref_id: Number(refId), name: f.name, mime, data });
          }
          input.value = '';
          G.toast(t('saved'));
          render();
        } catch (e) { G.fail(e); }
      };
      render().catch(G.fail);
    }
  };

  // ---------------- printing ----------------
  G.print = (html) => {
    const el = document.getElementById('print-area');
    const s = G.settings;
    el.innerHTML = `<div class="print-doc" dir="${G.lang === 'ar' ? 'rtl' : 'ltr'}">
      <div class="print-head">
        <div>${s.logo ? `<img src="${esc(s.logo)}" class="print-logo" alt="">` : '<div class="print-logo-text">BMW</div>'}</div>
        <div class="print-center"><h1>${esc(s.center_name_ar)}</h1><h2>${esc(s.center_name_en)}</h2>
        <div>${esc(s.center_address || '')} ${s.center_phone ? ' | ☎ ' + esc(s.center_phone) : ''} ${s.tax_no ? ' | ' + t('tax_no') + ': ' + esc(s.tax_no) : ''}</div></div>
      </div><div class="mstripe"></div>${html}</div>`;
    setTimeout(() => window.print(), 100);
  };

  // ---------------- WhatsApp ----------------
  G.waPhone = (p) => {
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0') && d.length === 11) d = '20' + d.slice(1); // Egypt local mobile
    return d;
  };
  G.waLink = (phone, text) => `https://wa.me/${G.waPhone(phone)}?text=${encodeURIComponent(text)}`;
  G.contactBtns = (phone, text) => (phone ? `<a class="btn btn-sm btn-wa" target="_blank" rel="noopener" href="${G.waLink(phone, text || '')}">🟢 ${t('whatsapp')}</a><a class="btn btn-sm" href="tel:${esc(phone)}">📞 ${t('call')}</a>` : '');

  // ---------------- router ----------------
  G.routes = [];
  G.addRoute = (pattern, handler, roles = '*') => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    G.routes.push({ re, keys, handler, roles });
  };
  G.route = async () => {
    if (!G.user) return;
    const hash = (location.hash || '#/').slice(1).split('?')[0] || '/';
    const query = Object.fromEntries(new URLSearchParams((location.hash.split('?')[1]) || ''));
    const view = document.getElementById('view');
    document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', hash === a.getAttribute('href').slice(1) || (a.getAttribute('href') !== '#/' && hash.startsWith(a.getAttribute('href').slice(1) + '/'))));
    document.body.classList.remove('nav-open');
    for (const r of G.routes) {
      const m = hash.match(r.re);
      if (m) {
        if (!G.can(r.roles)) { view.innerHTML = `<div class="empty">${t('err_forbidden')}</div>`; return; }
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        view.innerHTML = `<div class="loading">${t('loading')}</div>`;
        window.scrollTo(0, 0);
        try { await r.handler(view, params, query); } catch (e) { G.fail(e); view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
        return;
      }
    }
    view.innerHTML = `<div class="empty">404</div>`;
  };
  window.addEventListener('hashchange', () => G.route());
})();
