/* Administration: employees, service types, users, settings, audit */
(function () {
  const { t, esc, R } = G;
  const JOBS = ['technician', 'electrician', 'advisor', 'manager', 'accountant', 'storekeeper', 'bodyshop', 'washer', 'other'];
  const ROLES = ['admin', 'manager', 'advisor', 'technician', 'accountant', 'storekeeper'];

  G.addRoute('/employees', (view) => G.listPage(view, {
    title: t('employees'), res: 'employees', csvName: 'employees',
    fields: [{ name: 'name', required: true, span: 2 }, { name: 'phone', type: 'tel' }, { name: 'job', type: 'select', options: G.opt(JOBS, 'j_'), default: 'technician', noEmpty: true },
      { name: 'national_id' }, { name: 'hire_date', type: 'date' }, { name: 'salary', type: 'number' }, { name: 'labor_commission', type: 'number', help: G.tl('نسبة من مصنعية الشغلانات التي نفذها', '% of labor the employee performed') },
      { name: 'parts_commission', type: 'number' }, { name: 'active', type: 'checkbox', default: 1 }, { name: 'notes', type: 'textarea', span: 2 }],
    filters: [{ name: 'job', type: 'select', options: G.opt(JOBS, 'j_') }],
    onSaved: () => G.loadEmployees(true),
    rowCls: (r) => (r.active ? '' : 'row-off'),
    columns: [{ key: 'name', render: (r) => `<b>${esc(r.name)}</b>${r.active ? '' : ' ' + G.badge('inactive')}` }, { key: 'job', render: (r) => t('j_' + r.job) }, { key: 'phone' },
      { key: 'hire_date', hideMobile: true }, { key: 'salary', cls: 'num', render: (r) => G.money(r.salary) }, { key: 'labor_commission', cls: 'num', render: (r) => G.num(r.labor_commission) + '%' },
      { key: 'parts_commission', cls: 'num', hideMobile: true, render: (r) => G.num(r.parts_commission) + '%' }, G.rowActions(true, true)],
  }), R.MGMT);

  G.addRoute('/service-types', (view) => G.listPage(view, {
    title: t('service_types'), res: 'service-types', csvName: 'service_types',
    fields: [{ name: 'code' }, { name: 'category', list: 'dl-scat' }, { name: 'name_ar', required: true }, { name: 'name_en', required: true },
      { name: 'labor_hours', type: 'number' }, { name: 'labor_price', type: 'number' }, { name: 'interval_km', type: 'number', help: G.tl('0 = بدون تذكير بالكيلومتر', '0 = no km reminder') },
      { name: 'interval_months', type: 'number', help: G.tl('0 = بدون تذكير زمني', '0 = no time reminder') }, { name: 'active', type: 'checkbox', default: 1 }],
    top: `<datalist id="dl-scat">${['CBS', 'Brakes', 'Engine', 'Drivetrain', 'Electrical', 'Diagnosis', 'A/C', 'Tyres', 'Suspension', 'Body', 'Other'].map((c) => `<option value="${c}">`).join('')}</datalist>`,
    onSaved: () => G.loadServiceTypes(true),
    columns: [{ key: 'code' }, { key: 'name', label: t('name'), render: (r) => esc(G.tl(r.name_ar, r.name_en)) }, { key: 'category' }, { key: 'labor_hours', cls: 'num' },
      { key: 'labor_price', cls: 'num', render: (r) => G.money(r.labor_price) }, { key: 'interval_km', cls: 'num', render: (r) => (r.interval_km ? G.int(r.interval_km) : '-') },
      { key: 'interval_months', cls: 'num', render: (r) => (r.interval_months || '-') }, { key: 'active', render: (r) => (r.active ? '✔' : '✖') }, G.rowActions(true, true)],
  }), R.MGMT);

  G.addRoute('/users', async (view) => {
    await G.loadEmployees(true);
    const fields = (row) => [{ name: 'username', required: !row.id, attrs: row.id ? 'readonly' : 'autocapitalize="none"' }, { name: 'name', required: true },
      { name: 'role', type: 'select', options: G.opt(ROLES, 'r_'), required: true, noEmpty: true }, { name: 'employee_id', label: t('linked_employee'), type: 'select', options: G.empOptions() },
      ...(G.FB && row.id ? [] : [{ name: 'password', type: 'password', required: !row.id, help: row.id ? t('password_hint') : '' }]), { name: 'active', type: 'checkbox', default: 1 }];
    const load = async () => {
      const rows = (await G.get('/api/users')).rows;
      view.innerHTML = `<div class="page-head"><h2>🔐 ${t('users')}</h2><div class="head-actions"><button class="btn btn-primary" data-new>＋ ${t('add')}</button></div></div>
        <div class="card">${G.table([{ key: 'username' }, { key: 'name' }, { key: 'role', render: (r) => G.badge(r.role, 'r_') }, { key: 'employee_name', label: t('linked_employee') }, { key: 'active', render: (r) => (r.active ? '✔' : '✖') }, { key: 'created_at', hideMobile: true }, G.rowActions(true, true)], rows)}</div>
        <div class="card"><h3>${t('role')}</h3><ul class="roles-help">
          <li><b>${t('r_admin')}</b>: ${G.tl('كل الصلاحيات + المستخدمين والإعدادات والنسخ الاحتياطي', 'Everything + users, settings, backup')}</li>
          <li><b>${t('r_manager')}</b>: ${G.tl('كل العمليات والحسابات والتقارير والموظفين', 'All operations, finance, reports, staff')}</li>
          <li><b>${t('r_advisor')}</b>: ${G.tl('العملاء، السيارات، المواعيد، الاستلام، أوامر الشغل، الفواتير والتحصيل', 'Customers, vehicles, appointments, check-in, work orders, invoices & collection')}</li>
          <li><b>${t('r_technician')}</b>: ${G.tl('التشخيص وأوامر الشغل (المصنعية والقطع) بدون أسعار التكلفة', 'Diagnosis & work orders (labor & parts) without cost prices')}</li>
          <li><b>${t('r_accountant')}</b>: ${G.tl('الفواتير، الخزنة، الموردين، المشتريات، البونص والمرتبات، التقارير', 'Invoices, cash, suppliers, purchases, bonuses & payroll, reports')}</li>
          <li><b>${t('r_storekeeper')}</b>: ${G.tl('المخزون، حركة المخزن، الموردين، المشتريات', 'Inventory, stock moves, suppliers, purchases')}</li></ul></div>`;
      view.querySelector('[data-new]').onclick = () => G.formDialog({ title: t('add'), fields: fields({}), onSubmit: async (d, close) => { await G.post('/api/users', d); close(); G.toast(t('saved')); load(); } });
      view.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
        const row = rows[b.closest('tr').dataset.i];
        G.formDialog({ title: t('edit'), fields: fields(row), values: { ...row, password: '' }, onSubmit: async (d, close) => { delete d.username; if (!d.password) delete d.password; await G.put(`/api/users/${row.id}`, d); close(); G.toast(t('saved')); load(); } });
      });
      view.querySelectorAll('[data-delete]').forEach((b) => b.onclick = async () => {
        if (!(await G.confirm(t('confirm_delete')))) return;
        try { await G.del(`/api/users/${rows[b.closest('tr').dataset.i].id}`); load(); } catch (e) { G.fail(e); }
      });
    };
    await load();
  }, R.ADMIN);

  G.addRoute('/settings', async (view) => {
    const s = await G.get('/api/settings');
    const fields = [
      { html: `<h3 class="span-2 sec-title">${t('center_info')}</h3>` },
      { name: 'center_name_ar', required: true }, { name: 'center_name_en', required: true }, { name: 'center_phone', label: t('phone') }, { name: 'center_address', label: t('address') },
      { name: 'tax_no' }, { name: 'currency' }, { name: 'vat_rate', type: 'number' }, { name: 'labor_rate', type: 'number' },
      { name: 'invoice_footer_ar', type: 'textarea', rows: 2 }, { name: 'invoice_footer_en', type: 'textarea', rows: 2 },
      { name: 'allow_negative_stock', type: 'select', options: [['0', t('no')], ['1', t('yes')]], noEmpty: true },
      { html: `<div class="field"><label>${t('logo')}</label><div class="row-flex">${s.logo ? `<img src="${esc(s.logo)}" class="logo-prev" alt="">` : ''}<label class="btn">📁 ${t('logo')}<input type="file" accept="image/*" hidden data-logo></label>${s.logo ? `<button type="button" class="btn btn-ghost" data-rmlogo>✕</button>` : ''}</div><input type="hidden" name="logo" value="${esc(s.logo || '')}"></div>` },
      { html: `<h3 class="span-2 sec-title">${t('reminder_settings')}</h3>` },
      { name: 'reminder_days_ahead', type: 'number' }, { name: 'reminder_km_ahead', type: 'number' }, { name: 'avg_km_per_month', type: 'number' }, { html: '<div></div>' },
      { name: 'whatsapp_template_ar', type: 'textarea', span: 2, help: t('template_hint') }, { name: 'whatsapp_template_en', type: 'textarea', span: 2, help: t('template_hint') },
    ];
    view.innerHTML = `<div class="page-head"><h2>⚙ ${t('settings')}</h2></div>
      <form class="card" novalidate>${G.formHtml(fields, s)}<div class="form-actions"><button class="btn btn-primary btn-lg" type="submit">💾 ${t('save')}</button></div></form>
      <section class="card"><h3>💾 ${t('backup')}</h3><p class="muted">${G.FB ? G.tl('البيانات محفوظة على Firebase. حمّل نسخة JSON كل فترة للاحتياط.', 'Data is stored in Firebase. Download a JSON copy regularly.') : G.tl('يتم حفظ البيانات في ملف data/gear.db - احتفظ بنسخة احتياطية بشكل دوري.', 'Data is stored in data/gear.db - keep regular backups.')}</p><button type="button" class="btn" data-backup>⬇ ${t('download_backup')}</button></section>`;
    view.querySelector('[data-backup]').onclick = () => (G.FB ? G.FB.backup().catch(G.fail) : (location.href = '/api/backup'));
    const form = view.querySelector('form');
    form.querySelector('[data-logo]').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const { data } = await G.resizeImage(f, 300);
      form.querySelector('[name=logo]').value = data;
      G.toast(t('logo') + ' ✔');
    };
    const rm = form.querySelector('[data-rmlogo]');
    if (rm) rm.onclick = () => { form.querySelector('[name=logo]').value = ''; rm.previousElementSibling.previousElementSibling && rm.parentElement.querySelector('img') && rm.parentElement.querySelector('img').remove(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!G.validate(form)) return;
      try { await G.put('/api/settings', G.readForm(form)); await G.reloadSettings(); G.toast(t('saved')); G.renderShell(); G.route(); } catch (err) { G.fail(err); }
    };
  }, R.ADMIN);

  G.addRoute('/audit', async (view) => {
    const rows = (await G.get('/api/audit?limit=500')).rows;
    view.innerHTML = `<div class="page-head"><h2>📜 ${t('audit')}</h2></div><div class="card">${G.table([{ key: 'created_at', label: t('date') }, { key: 'user_name', label: t('user') }, { key: 'action' }, { key: 'entity' }, { key: 'entity_id', label: '#' }, { key: 'details', hideMobile: true }], rows)}</div>`;
  }, R.ADMIN);
})();
