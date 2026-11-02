/* GEAR app shell: login, navigation, global search, boot */
(function () {
  const { t, esc } = G;
  const R = G.R;

  G.MENU = [
    { group: null, items: [['#/', 'nav_dashboard', '📊', '*']] },
    { group: 'nav_front', items: [
      ['#/appointments', 'appointments', '📅', R.FRONT], ['#/receptions', 'receptions', '🚘', R.FRONT], ['#/customers', 'customers', '👥', '*'],
      ['#/vehicles', 'vehicles', '🚗', '*'], ['#/reminders', 'reminders', '🔔', R.FRONT]] },
    { group: 'nav_workshop', items: [['#/diagnoses', 'diagnoses', '🩺', R.SHOP], ['#/work-orders', 'work_orders', '🔧', '*']] },
    { group: 'nav_finance', items: [['#/invoices', 'invoices', '🧾', R.BILL], ['#/cash', 'cash', '💰', R.MONEY], ['#/reports', 'reports', '📈', R.MONEY]] },
    { group: 'nav_store', items: [['#/parts', 'parts', '📦', '*'], ['#/stock-moves', 'stock_moves', '🔄', R.SUPP], ['#/purchases', 'purchases', '🛒', R.SUPP], ['#/suppliers', 'suppliers', '🏭', R.SUPP]] },
    { group: 'nav_hr', items: [['#/employees', 'employees', '🧑‍🔧', R.MGMT], ['#/attendance', 'attendance', '🕘', '*'], ['#/bonuses', 'bonuses', '🎁', R.MONEY]] },
    { group: 'nav_admin', items: [['#/service-types', 'service_types', '🛠', R.MGMT], ['#/users', 'users', '🔐', R.ADMIN], ['#/settings', 'settings', '⚙', R.ADMIN], ['#/audit', 'audit', '📜', R.ADMIN]] },
  ];

  G.renderShell = () => {
    const app = document.getElementById('app');
    if (!G.user) return;
    const s = G.settings;
    const nav = G.MENU.map((g) => {
      const items = g.items.filter((i) => G.can(i[3]));
      if (!items.length) return '';
      return `${g.group ? `<div class="nav-group">${t(g.group)}</div>` : ''}${items.map(([href, key, icon]) => `<a href="${href}"><span class="ni">${icon}</span><span>${t(key)}</span></a>`).join('')}`;
    }).join('');
    app.innerHTML = `
      <aside class="sidebar">
        <div class="brand">${s.logo ? `<img src="${esc(s.logo)}" alt="">` : '<img src="/icons/icon.svg" alt="">'}<div><b>${esc(G.tl(s.center_name_ar, s.center_name_en))}</b><small>GEAR</small></div></div>
        <nav class="nav">${nav}</nav>
        <div class="side-foot">
          <div class="me">👤 ${esc(G.user.name)} <small>${(G.user.roles || [G.user.role]).map((r) => t('r_' + r)).join(' + ')}</small></div>
          <button class="btn btn-ghost btn-sm" data-pw>🔑 ${t('change_password')}</button>
          <button class="btn btn-ghost btn-sm" data-logout>⎋ ${t('logout')}</button>
        </div>
      </aside>
      <div class="nav-backdrop" data-nav-close></div>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn burger" data-burger aria-label="${t('menu')}">☰</button>
          <div class="gsearch"><input type="search" placeholder="${t('global_search')}" data-gsearch><div class="gsearch-res" hidden></div></div>
          <button class="icon-btn" data-theme title="${t('theme')}">🌓</button>
          <button class="btn btn-sm" data-lang>${t('language')}</button>
          <button class="btn btn-sm btn-primary" data-install hidden title="${t('install_app')}">⬇ <span class="hide-sm">${t('install_app')}</span></button>
        </header>
        <div class="mstripe"></div>
        <main id="view" class="view"></main>
      </div>
      <nav class="bottom-nav">
        <a href="#/"><span>📊</span><small>${t('nav_dashboard')}</small></a>
        ${G.can(R.FRONT) ? `<a href="#/receptions/new"><span>🚘</span><small>${t('reception')}</small></a>` : ''}
        <a href="#/work-orders"><span>🔧</span><small>${t('work_orders')}</small></a>
        ${G.can(R.FRONT) ? `<a href="#/reminders"><span>🔔</span><small>${t('reminders')}</small></a>` : `<a href="#/parts"><span>📦</span><small>${t('parts')}</small></a>`}
        <a href="javascript:void 0" data-burger><span>☰</span><small>${t('menu')}</small></a>
      </nav>`;
    app.querySelectorAll('[data-burger]').forEach((b) => b.onclick = () => document.body.classList.toggle('nav-open'));
    app.querySelector('[data-nav-close]').onclick = () => document.body.classList.remove('nav-open');
    app.querySelector('[data-lang]').onclick = G.toggleLang;
    app.querySelector('[data-theme]').onclick = G.toggleTheme;
    app.querySelector('[data-logout]').onclick = async () => { try { await G.post('/api/auth/logout'); } catch (_) { /* ignore */ } G.user = null; G.showLogin(); };
    app.querySelector('[data-pw]').onclick = G.changePassword;
    const ib = app.querySelector('[data-install]');
    if (G.installPrompt) ib.hidden = false;
    ib.onclick = async () => { if (G.installPrompt) { G.installPrompt.prompt(); G.installPrompt = null; ib.hidden = true; } };
    bindGlobalSearch(app.querySelector('.gsearch'));
  };

  function bindGlobalSearch(box) {
    const input = box.querySelector('input');
    const res = box.querySelector('.gsearch-res');
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = input.value.trim();
        if (q.length < 2) { res.hidden = true; return; }
        try {
          const d = await G.get('/api/search?q=' + encodeURIComponent(q));
          const sec = (title, rows, href, label) => (rows && rows.length ? `<div class="gs-sec">${t(title)}</div>${rows.map((r) => `<a href="${href(r)}">${esc(label(r))}</a>`).join('')}` : '');
          res.innerHTML = sec('customers', d.customers, (r) => `#/customers/${r.id}`, (r) => `${r.name} ${r.phone || ''}`)
            + sec('vehicles', d.vehicles, (r) => `#/vehicles/${r.id}`, (r) => `${G.vehLabel(r)} | ${r.customer_name || ''} ${r.vin ? '| ' + r.vin : ''}`)
            + sec('work_orders', d.work_orders, (r) => `#/work-orders/${r.id}`, (r) => `${r.no} | ${r.plate || ''} | ${t('wo_' + r.status)}`)
            + (G.can(R.BILL) ? sec('invoices', d.invoices, (r) => `#/invoices/${r.id}`, (r) => `${r.no} | ${G.num(r.total)}`) : '')
            + sec('parts', d.parts, (r) => `#/parts?q=${encodeURIComponent(r.part_no || r.name_en)}`, (r) => `${r.part_no || ''} ${G.tl(r.name_ar, r.name_en)} (${G.num(r.qty)})`)
            || `<div class="gs-empty">${t('no_data')}</div>`;
          res.hidden = false;
        } catch (e) { G.fail(e); }
      }, 250);
    });
    res.addEventListener('click', (e) => { if (e.target.closest('a')) { res.hidden = true; input.value = ''; } });
    input.addEventListener('blur', () => setTimeout(() => { res.hidden = true; }, 250));
  }

  G.changePassword = (forced) => G.formDialog({
    title: t('change_password'),
    extra: forced === true ? `<p class="alert">${t('default_pw_warning')}</p>` : '',
    fields: [{ name: 'current', label: t('current_password'), type: 'password', required: true, span: 2 }, { name: 'password', label: t('new_password'), type: 'password', required: true, span: 2 }],
    onSubmit: async (d, close) => { await G.post('/api/auth/password', d); close(); G.toast(t('saved')); },
  });

  G.showLogin = async () => {
    let pub = {};
    try { pub = await G.get('/api/public/settings'); } catch (_) { /* ignore */ }
    document.getElementById('app').innerHTML = `
      <div class="login-page"><form class="login-card" novalidate>
        <div class="login-brand">${pub.logo ? `<img src="${esc(pub.logo)}" alt="">` : '<img src="/icons/icon.svg" alt="">'}
          <h1>${esc(G.tl(pub.center_name_ar, pub.center_name_en) || t('app_name'))}</h1><p>${t('app_name')}</p></div>
        <div class="mstripe"></div>
        ${G.field({ name: 'username', label: t('username'), required: true, attrs: 'autocomplete="username" autocapitalize="none"' })}
        ${G.field({ name: 'password', label: t('password'), type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
        <button class="btn btn-primary btn-block" type="submit">${t('login')}</button>
        <button class="btn btn-ghost btn-block" type="button" data-lang>${t('language')}</button>
      </form></div>`;
    if (pub.needs_setup) return showSetup();
    const form = document.querySelector('.login-card');
    form.querySelector('[data-lang]').onclick = () => { G.lang = G.lang === 'ar' ? 'en' : 'ar'; G.setPref('lang', G.lang); G.applyLang(); G.showLogin(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!G.validate(form)) return;
      try {
        const d = G.readForm(form);
        const r = await G.post('/api/auth/login', d);
        await start(r.user);
        if (r.mustChange) G.changePassword(true);
      } catch (err) { G.fail(err); }
    };
  };

  // Firebase mode, first run: create the administrator account and the center
  function showSetup() {
    const form = document.querySelector('.login-card');
    form.innerHTML = `<div class="login-brand"><img src="/icons/icon.svg" alt=""><h1>${G.tl('إعداد النظام لأول مرة', 'First-time setup')}</h1>
        <p>${G.tl('أنشئ حساب مدير النظام وبيانات المركز', 'Create the administrator account and your center')}</p></div><div class="mstripe"></div>
      ${G.field({ name: 'center_name_ar', label: t('center_name_ar'), required: true }, 'مركز صيانة BMW')}
      ${G.field({ name: 'center_name_en', label: t('center_name_en'), required: true }, 'BMW Service Center')}
      ${G.field({ name: 'name', label: t('name'), required: true })}
      ${G.field({ name: 'username', label: t('username'), required: true, help: G.tl('حروف إنجليزية صغيرة وأرقام', 'lowercase letters and digits'), attrs: 'autocapitalize="none"' }, 'admin')}
      ${G.field({ name: 'password', label: t('password'), type: 'password', required: true, help: G.tl('6 أحرف على الأقل', 'at least 6 characters') })}
      <button class="btn btn-primary btn-block" type="submit">${t('save')}</button>
      <button class="btn btn-ghost btn-block" type="button" data-lang>${t('language')}</button>`;
    form.querySelector('[data-lang]').onclick = () => { G.lang = G.lang === 'ar' ? 'en' : 'ar'; G.setPref('lang', G.lang); G.applyLang(); G.showLogin(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!G.validate(form)) return;
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try { const r = await G.post('/api/auth/setup', G.readForm(form)); await start(r.user); } catch (err) { G.fail(err); btn.disabled = false; }
    };
  }

  async function start(user) {
    G.user = user;
    G.settings = await G.get('/api/settings');
    G.cache = {};
    await G.loadEmployees().catch(() => { G.cache.employees = []; });
    G.renderShell();
    G.route();
  }
  G.reloadSettings = async () => { G.settings = await G.get('/api/settings'); };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    G.installPrompt = e;
    const b = document.querySelector('[data-install]');
    if (b) b.hidden = false;
  });

  document.addEventListener('DOMContentLoaded', async () => {
    G.applyLang(); G.applyTheme();
    G.settings = {};
    try {
      const me = await G.get('/api/auth/me');
      await start(me.user);
    } catch (_) { G.showLogin(); }
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
})();
