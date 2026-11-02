/* Front office pages */
(function () {
  const { t, esc, R } = G;

  // ---------------- constants ----------------
  G.BMW_SERIES = ['1 Series', '2 Series', '3 Series', '4 Series', '5 Series', '6 Series', '7 Series', '8 Series', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'XM',
    'Z4', 'i3', 'i4', 'i5', 'i7', 'iX', 'iX1', 'iX2', 'iX3', 'M2', 'M3', 'M4', 'M5', 'M8', 'X3 M', 'X5 M', 'X6 M', 'MINI', 'Rolls-Royce', 'Other'];
  G.CHASSIS = ['E30', 'E36', 'E39', 'E46', 'E60', 'E65', 'E70', 'E71', 'E84', 'E87', 'E90', 'E92', 'F01', 'F07', 'F10', 'F15', 'F16', 'F20', 'F22', 'F25', 'F26', 'F30', 'F32', 'F36', 'F40', 'F44', 'F45', 'F48', 'F80', 'F82', 'F90',
    'G01', 'G02', 'G05', 'G06', 'G07', 'G11', 'G12', 'G14', 'G15', 'G16', 'G20', 'G21', 'G22', 'G26', 'G29', 'G30', 'G31', 'G42', 'G45', 'G60', 'G61', 'G70', 'G80', 'G82', 'G87', 'G09', 'I01', 'I20', 'U06', 'U10', 'U11'];
  G.CHECK_ITEMS = ['spare_tyre', 'jack', 'tools', 'triangle', 'first_aid', 'mats', 'radio', 'service_book', 'key2', 'wheel_lock', 'charging_cable', 'antenna', 'hubcaps'];
  G.WARNING_LIGHTS = ['engine', 'abs', 'airbag', 'oil', 'battery', 'brake', 'tpms', 'dsc', 'coolant', 'service', 'gearbox', 'steering'];
  G.ZONES = [['front_bumper', 'صدام أمامي', 'Front bumper'], ['hood', 'كبوت', 'Hood'], ['windshield', 'زجاج أمامي', 'Windshield'], ['roof', 'سقف', 'Roof'],
    ['trunk', 'شنطة', 'Trunk'], ['rear_bumper', 'صدام خلفي', 'Rear bumper'], ['fl_fender', 'رفرف أمامي شمال', 'Front-left fender'], ['fr_fender', 'رفرف أمامي يمين', 'Front-right fender'],
    ['left_doors', 'أبواب شمال', 'Left doors'], ['right_doors', 'أبواب يمين', 'Right doors'], ['rl_quarter', 'رفرف خلفي شمال', 'Rear-left quarter'], ['rr_quarter', 'رفرف خلفي يمين', 'Rear-right quarter'],
    ['rims', 'جنوط', 'Rims'], ['mirrors', 'مرايات', 'Mirrors'], ['lights', 'فوانيس', 'Lights'], ['interior', 'الصالون الداخلي', 'Interior']];
  G.FUEL_LEVELS = [['E', 'E'], ['1/4', '¼'], ['1/2', '½'], ['3/4', '¾'], ['F', 'F']];
  G.empOptions = (jobs) => (G.cache.employees || []).filter((e) => e.active && (!jobs || jobs.includes(e.job))).map((e) => [e.id, e.name]);
  G.zoneLabel = (k) => { const z = G.ZONES.find((x) => x[0] === k); return z ? G.tl(z[1], z[2]) : k; };
  G.parseJson = (s, d = {}) => { try { return s ? JSON.parse(s) : d; } catch (_) { return d; } };

  const datalists = () => `<datalist id="dl-chassis">${G.CHASSIS.map((c) => `<option value="${c}">`).join('')}</datalist>`;

  G.customerFields = () => [
    { name: 'name', required: true, span: 2 }, { name: 'phone', type: 'tel', required: true }, { name: 'phone2', type: 'tel' },
    { name: 'type', label: t('customer_type'), type: 'select', options: G.opt(['individual', 'company']), default: 'individual', noEmpty: true },
    { name: 'tax_no' }, { name: 'email', type: 'email' }, { name: 'address' }, { name: 'notes', type: 'textarea', span: 2 },
  ];
  G.vehicleFields = (row = {}, withCustomer = true) => [
    ...(withCustomer ? [{ name: 'customer_id', label: t('customer'), type: 'lookup', res: 'customers', required: true, display: row.customer_name, span: 2 }] : []),
    { name: 'plate', required: true }, { name: 'vin', attrs: 'maxlength="17" style="text-transform:uppercase"' },
    { name: 'make', default: 'BMW' }, { name: 'series', type: 'select', options: G.BMW_SERIES.map((s) => [s, s]) },
    { name: 'model', placeholder: '320i, 530e, X5 xDrive40i' }, { name: 'chassis_code', list: 'dl-chassis' },
    { name: 'year', type: 'number' }, { name: 'color' }, { name: 'engine', placeholder: 'B48, B58, N55, S58...' },
    { name: 'fuel', type: 'select', options: G.opt(['petrol', 'diesel', 'hybrid', 'electric']) },
    { name: 'transmission', type: 'select', options: G.opt(['automatic', 'manual']), default: 'automatic' },
    { name: 'mileage', type: 'number' }, { name: 'warranty_until', type: 'date' }, { name: 'notes', type: 'textarea', span: 2 },
  ];

  G.newCustomerVehicle = (onDone) => {
    const cf = G.customerFields().map((f) => ({ ...f, name: 'c_' + f.name, label: t(f.name === 'type' ? 'customer_type' : f.name) }));
    const vf = G.vehicleFields({}, false);
    G.formDialog({
      title: t('customer_and_vehicle'), wide: true,
      fields: [{ html: `<h4 class="span-2 sec-title">👤 ${t('customer')}</h4>` }, ...cf, { html: `<h4 class="span-2 sec-title">🚗 ${t('vehicle')}</h4>${datalists()}` }, ...vf],
      onSubmit: async (d, close) => {
        const c = {}; const v = {};
        for (const [k, val] of Object.entries(d)) { if (k.startsWith('c_')) c[k.slice(2)] = val; else v[k] = val; }
        const cust = await G.post('/api/customers', c);
        v.customer_id = cust.id;
        const veh = await G.post('/api/vehicles', v);
        close(); G.toast(t('saved'));
        onDone && onDone(veh, cust);
      },
    });
  };

  // ---------------- dashboard ----------------
  G.addRoute('/', async (view) => {
    const d = await G.get('/api/dashboard');
    const money = G.can(R.MONEY);
    const kpi = (icon, label, value, href, cls = '') => `<a class="kpi ${cls}" href="${href || 'javascript:void 0'}"><span class="kpi-i">${icon}</span><div><small>${label}</small><b>${value}</b></div></a>`;
    const maxDay = Math.max(1, ...(d.daily || []).map((x) => x.total));
    view.innerHTML = `
      <div class="page-head"><h2>${t('nav_dashboard')}</h2><div class="head-actions">
        ${G.can(R.FRONT) ? `<a class="btn btn-primary" href="#/receptions/new">🚘 ${t('new_reception')}</a><button class="btn" data-newcust>👤 ${t('new_customer')}</button><button class="btn" data-newappt>📅 ${t('new_appointment')}</button>` : ''}
        ${G.can(R.BILL) ? `<a class="btn" href="#/invoices/new">🧾 ${t('counter_sale')}</a>` : ''}</div></div>
      <div data-punch></div>
      <div class="kpis">
        ${kpi('🔧', t('in_workshop'), G.int(d.in_workshop), '#/work-orders')}
        ${kpi('✅', t('ready_for_delivery'), G.int(d.ready_for_delivery), '#/work-orders?status=completed', 'ok')}
        ${kpi('⏳', t('waiting_parts'), G.int(d.waiting_parts), '#/work-orders?status=waiting_parts', 'warn')}
        ${kpi('🚘', t('receptions_today'), G.int(d.receptions_today), '#/receptions')}
        ${kpi('🔔', t('reminders_due'), G.int(d.reminders_due), '#/reminders', d.reminders_due ? 'warn' : '')}
        ${kpi('📦', t('low_stock'), G.int(d.low_stock), '#/parts?low=1', d.low_stock ? 'bad' : '')}
        ${money ? kpi('💵', t('revenue_today'), G.money(d.revenue_today), '#/invoices') + kpi('📅', t('revenue_month'), G.money(d.revenue_month), '#/reports')
        + kpi('💰', t('collected_today'), G.money(d.collected_today), '#/cash') + kpi('🏦', t('cash_balance'), G.money(d.cash_balance), '#/cash')
        + kpi('📌', t('receivables'), G.money(d.receivables), '#/invoices?unpaid=1', d.receivables ? 'warn' : '') + kpi('💸', t('expenses_month'), G.money(d.expenses_month), '#/cash') : ''}
      </div>
      <div class="grid-2">
        <section class="card"><h3>${t('active_orders')}</h3>
          ${G.table([
    { key: 'no', label: t('wo_no'), render: (r) => `<b>${esc(r.no)}</b>${r.priority !== 'normal' ? ' ' + G.badge(r.priority) : ''}` },
    { key: 'vehicle', label: t('vehicle'), render: (r) => esc(`${r.plate || ''} ${r.series || ''} ${r.model || ''}`) },
    { key: 'customer_name', label: t('customer') },
    { key: 'status', render: (r) => G.badge(r.status, 'wo_') }], d.active_orders, { rowLink: (r) => `#/work-orders/${r.id}` })}
        </section>
        <section class="card"><h3>${t('appointments_today')}</h3>
          ${G.table([{ key: 'time' }, { key: 'customer_name', label: t('customer') }, { key: 'plate', label: t('vehicle'), render: (r) => esc(`${r.plate || ''} ${r.model || ''}`) },
    { key: 'service', label: t('service_requested') }, { key: 'x', label: '', render: (r) => (r.vehicle_id ? `<a class="btn btn-sm" href="#/receptions/new?vehicle_id=${r.vehicle_id}&appointment_id=${r.id}">${t('start_checkin')}</a>` : '') }], d.appointments_today)}
          ${money && d.daily && d.daily.length ? `<h3 class="mt">${t('last_14_days')}</h3><div class="bars">${d.daily.map((x) => `<div class="bar" title="${x.date}: ${G.num(x.total)}"><i style="height:${Math.round((x.total / maxDay) * 100)}%"></i><small>${x.date.slice(8)}</small></div>`).join('')}</div>` : ''}
        </section>
      </div>`;
    G.bindRowLinks(view);
    if (G.punchCard) G.punchCard(view.querySelector('[data-punch]'));
    const nc = view.querySelector('[data-newcust]');
    if (nc) nc.onclick = () => G.newCustomerVehicle((v) => { location.hash = `#/vehicles/${v.id}`; });
    const na = view.querySelector('[data-newappt]');
    if (na) na.onclick = () => G.appointmentDialog({}, () => G.route());
  });

  // ---------------- customers ----------------
  G.addRoute('/customers', (view) => G.listPage(view, {
    title: t('customers'), res: 'customers', csvName: 'customers', canWrite: G.can(R.FRONT),
    fields: G.customerFields(),
    filters: [{ name: 'type', label: t('customer_type'), type: 'select', options: G.opt(['individual', 'company']) }],
    extraButtons: G.can(R.FRONT) ? `<button class="btn" data-cv>＋ ${t('customer_and_vehicle')}</button>` : '',
    after: (v, reload) => { const b = v.querySelector('[data-cv]'); if (b) b.onclick = () => G.newCustomerVehicle(() => reload()); },
    afterCreate: (r) => { location.hash = `#/customers/${r.id}`; },
    rowLink: (r) => `#/customers/${r.id}`,
    columns: [
      { key: 'name', render: (r) => `<b>${esc(r.name)}</b>${r.type === 'company' ? ' ' + G.badge('company') : ''}` },
      { key: 'phone', render: (r) => `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` },
      { key: 'vehicles_count', cls: 'num' },
      ...(G.can(R.BILL) ? [{ key: 'balance', label: t('due'), cls: 'num', render: (r) => (r.balance > 0 ? `<b class="neg">${G.money(r.balance)}</b>` : '-') }] : []),
      { key: 'created_at', hideMobile: true, render: (r) => G.fdate(r.created_at) },
      G.rowActions(G.can(R.FRONT), G.can(R.MGMT)),
    ].filter(Boolean),
  }));

  G.addRoute('/customers/:id', async (view, p) => {
    const c = await G.get(`/api/customers/${p.id}/full`);
    view.innerHTML = `
      <div class="page-head"><h2>👤 ${esc(c.name)}</h2><div class="head-actions">${G.contactBtns(c.phone, '')}
        ${G.can(R.FRONT) ? `<button class="btn" data-edit>✎ ${t('edit')}</button><button class="btn btn-primary" data-addv>＋ ${t('add_vehicle')}</button>` : ''}</div></div>
      <div class="card info-grid">
        ${info(t('phone'), c.phone)}${info(t('phone2'), c.phone2)}${info(t('email'), c.email)}${info(t('customer_type'), t(c.type))}
        ${info(t('tax_no'), c.tax_no)}${info(t('address'), c.address)}${G.can(R.BILL) ? info(t('customer_balance'), `<b class="${c.balance > 0 ? 'neg' : ''}">${G.money(c.balance)}</b>`, true) : ''}${info(t('notes'), c.notes)}
      </div>
      <section class="card"><h3>🚗 ${t('vehicles')}</h3>${G.table([
    { key: 'plate', render: (v) => `<b>${esc(v.plate)}</b>` }, { key: 'model', label: t('model'), render: (v) => esc(`${v.series || ''} ${v.model || ''} ${v.chassis_code ? '(' + v.chassis_code + ')' : ''}`) },
    { key: 'year' }, { key: 'vin', hideMobile: true }, { key: 'mileage', cls: 'num', render: (v) => G.int(v.mileage) },
    { key: 'x', label: '', render: (v) => (G.can(R.FRONT) ? `<a class="btn btn-sm" href="#/receptions/new?vehicle_id=${v.id}">🚘 ${t('reception')}</a>` : '') }], c.vehicles, { rowLink: (v) => `#/vehicles/${v.id}` })}</section>
      <div class="grid-2">
        <section class="card"><h3>🔧 ${t('work_orders')}</h3>${G.table([{ key: 'no' }, { key: 'date', render: (r) => G.fdate(r.date) }, { key: 'plate' }, { key: 'status', render: (r) => G.badge(r.status, 'wo_') }], c.work_orders, { rowLink: (r) => `#/work-orders/${r.id}` })}</section>
        ${G.can(R.BILL) ? `<section class="card"><h3>🧾 ${t('invoices')}</h3>${G.table([{ key: 'no' }, { key: 'date' }, { key: 'plate' }, { key: 'total', cls: 'num', render: (r) => G.money(r.total) }, { key: 'status', render: (r) => G.badge(r.status, r.status === 'paid' ? 'paid_' : '') }], c.invoices, { rowLink: (r) => `#/invoices/${r.id}` })}</section>` : ''}
      </div>
      <section class="card"><h3>🔔 ${t('reminders')}</h3>${G.table([{ key: 'plate' }, { key: 'title' }, { key: 'due_date' }, { key: 'due_mileage', cls: 'num', render: (r) => G.int(r.due_mileage) }, { key: 'status', render: (r) => G.badge(r.status) }], c.reminders)}</section>`;
    G.bindRowLinks(view);
    const eb = view.querySelector('[data-edit]');
    if (eb) eb.onclick = () => G.formDialog({ title: t('edit'), fields: G.customerFields(), values: c, onSubmit: async (d, close) => { await G.put(`/api/customers/${c.id}`, d); close(); G.toast(t('saved')); G.route(); } });
    const ab = view.querySelector('[data-addv]');
    if (ab) ab.onclick = () => G.formDialog({
      title: t('add_vehicle'), wide: true, fields: G.vehicleFields({}, false), extra: datalists(),
      onSubmit: async (d, close) => { d.customer_id = c.id; const v = await G.post('/api/vehicles', d); close(); G.toast(t('saved')); location.hash = `#/vehicles/${v.id}`; },
    });
  });
  const info = (label, val, raw) => `<div class="info"><small>${esc(label)}</small><div>${raw ? val : esc(val || '-')}</div></div>`;
  G.info = info;

  // ---------------- vehicles ----------------
  G.addRoute('/vehicles', (view) => G.listPage(view, {
    title: t('vehicles'), res: 'vehicles', csvName: 'vehicles', canWrite: G.can(R.FRONT), wide: true,
    fields: (row) => G.vehicleFields(row, true), top: datalists(),
    filters: [{ name: 'series', type: 'select', options: G.BMW_SERIES.map((s) => [s, s]) }],
    rowLink: (r) => `#/vehicles/${r.id}`,
    afterCreate: (r) => { location.hash = `#/vehicles/${r.id}`; },
    columns: [
      { key: 'plate', render: (r) => `<b>${esc(r.plate)}</b>` },
      { key: 'model', render: (r) => esc(`${r.series || ''} ${r.model || ''}`) },
      { key: 'chassis_code', hideMobile: true }, { key: 'year' }, { key: 'vin', hideMobile: true },
      { key: 'customer_name', label: t('customer') }, { key: 'customer_phone', label: t('phone'), hideMobile: true },
      { key: 'mileage', cls: 'num', render: (r) => G.int(r.mileage) },
      G.rowActions(G.can(R.FRONT), G.can(R.MGMT)),
    ].filter(Boolean),
  }));

  G.addRoute('/vehicles/:id', async (view, p) => {
    const v = await G.get(`/api/vehicles/${p.id}/full`);
    view.innerHTML = `
      <div class="page-head"><h2>🚗 ${esc(G.vehLabel(v))}</h2><div class="head-actions">
        ${G.can(R.FRONT) ? `<a class="btn btn-primary" href="#/receptions/new?vehicle_id=${v.id}">🚘 ${t('new_reception')}</a>
        <button class="btn" data-appt>📅 ${t('new_appointment')}</button><button class="btn" data-rem>🔔 ${t('new_reminder')}</button><button class="btn" data-edit>✎ ${t('edit')}</button>` : ''}</div></div>
      <div class="card info-grid">
        ${info(t('customer'), `<a href="#/customers/${v.customer_id}">${esc(v.customer.name)}</a> ${G.contactBtns(v.customer.phone)}`, true)}
        ${info(t('plate'), v.plate)}${info(t('vin'), v.vin)}${info(t('series'), v.series)}${info(t('model'), v.model)}${info(t('chassis_code'), v.chassis_code)}
        ${info(t('year'), v.year)}${info(t('color'), v.color)}${info(t('engine'), v.engine)}${info(t('fuel'), v.fuel ? t(v.fuel) : '')}${info(t('transmission'), v.transmission ? t(v.transmission) : '')}
        ${info(t('mileage'), G.int(v.mileage))}${info(t('warranty_until'), v.warranty_until)}${info(t('notes'), v.notes)}
      </div>
      <div class="card" data-tabs></div>`;
    G.tabs(view.querySelector('[data-tabs]'), [['history', t('service_history')], ['wo', t('work_orders')], ['parts', t('parts_history')], ['rec', t('receptions')], ['diag', t('diagnoses')], ['rem', t('reminders')]], (k, body) => {
      if (k === 'history') body.innerHTML = G.table([{ key: 'date' }, { key: 'no', label: t('wo_no') }, { key: 'mileage', cls: 'num', render: (r) => G.int(r.mileage) }, { key: 'description', render: (r) => esc(r.description || G.tl(r.name_ar, r.name_en)) }, { key: 'technician_name', label: t('technician') }], v.history, { rowLink: (r) => `#/work-orders/${r.work_order_id}` });
      if (k === 'wo') body.innerHTML = G.table([{ key: 'no' }, { key: 'date', render: (r) => G.fdate(r.date) }, { key: 'mileage', cls: 'num', render: (r) => G.int(r.mileage) }, { key: 'description', render: (r) => esc((r.description || '').slice(0, 80)) }, { key: 'status', render: (r) => G.badge(r.status, 'wo_') }, { key: 'invoice_no', label: t('invoice') }], v.work_orders, { rowLink: (r) => `#/work-orders/${r.id}` });
      if (k === 'parts') body.innerHTML = G.table([{ key: 'date' }, { key: 'no', label: t('wo_no') }, { key: 'part_no' }, { key: 'name', label: t('part'), render: (r) => esc(r.description || G.tl(r.name_ar, r.name_en)) }, { key: 'qty', cls: 'num' }], v.parts_history);
      if (k === 'rec') body.innerHTML = G.table([{ key: 'no' }, { key: 'date', render: (r) => G.fdt(r.date) }, { key: 'mileage', cls: 'num', render: (r) => G.int(r.mileage) }, { key: 'complaints', render: (r) => esc((r.complaints || '').slice(0, 80)) }, { key: 'status', render: (r) => G.badge(r.status, 'st_') }], v.receptions, { rowLink: (r) => `#/receptions/${r.id}` });
      if (k === 'diag') body.innerHTML = G.table([{ key: 'date', render: (r) => G.fdt(r.date) }, { key: 'fault_codes' }, { key: 'findings', render: (r) => esc((r.findings || '').slice(0, 100)) }, { key: 'approval', render: (r) => G.badge(r.approval) }], v.diagnoses, { rowLink: () => '#/diagnoses' });
      if (k === 'rem') body.innerHTML = G.table([{ key: 'title', render: (r) => esc(r.title || G.tl(r.name_ar, r.name_en)) }, { key: 'last_service_date', label: t('last_service') }, { key: 'due_date' }, { key: 'due_mileage', cls: 'num', render: (r) => G.int(r.due_mileage) }, { key: 'status', render: (r) => G.badge(r.status) }], v.reminders);
      G.bindRowLinks(body);
    });
    const eb = view.querySelector('[data-edit]');
    if (eb) eb.onclick = () => G.formDialog({ title: t('edit'), wide: true, fields: G.vehicleFields(v, true), values: v, extra: datalists(), onSubmit: async (d, close) => { await G.put(`/api/vehicles/${v.id}`, d); close(); G.toast(t('saved')); G.route(); } });
    const ap = view.querySelector('[data-appt]');
    if (ap) ap.onclick = () => G.appointmentDialog({ customer_id: v.customer_id, customer_name: v.customer.name, vehicle_id: v.id, plate: v.plate, model: v.model }, () => G.toast(t('saved')));
    const rb = view.querySelector('[data-rem]');
    if (rb) rb.onclick = () => G.reminderDialog({ vehicle_id: v.id, display: G.vehLabel(v) }, () => G.route());
  });

  // ---------------- appointments ----------------
  G.appointmentDialog = (row, done) => G.formDialog({
    title: row.id ? t('edit') : t('new_appointment'),
    fields: [
      { name: 'customer_id', label: t('customer'), type: 'lookup', res: 'customers', required: true, display: row.customer_name, span: 2 },
      { name: 'vehicle_id', label: t('vehicle'), type: 'lookup', res: 'vehicles', display: row.plate ? `${row.plate} ${row.model || ''}` : '', filter: row.customer_id ? `customer_id=${row.customer_id}` : '', span: 2 },
      { name: 'date', type: 'date', required: true, default: G.today() }, { name: 'time', type: 'time' },
      { name: 'service', label: t('service_requested'), span: 2 }, { name: 'advisor_id', label: t('advisor'), type: 'select', options: G.empOptions() },
      { name: 'status', type: 'select', options: G.opt(['scheduled', 'arrived', 'no_show', 'cancelled']), default: 'scheduled', noEmpty: true },
      { name: 'notes', type: 'textarea', span: 2 },
    ],
    values: row,
    onMount: (m, form) => {
      const vbox = form.querySelector('.lookup[data-res=vehicles]');
      form.querySelector('.lookup[data-res=customers]').addEventListener('pick', (e) => { vbox.dataset.filter = `customer_id=${e.detail.id}`; });
      vbox.addEventListener('pick', (e) => {
        const ch = form.querySelector('.lookup[data-res=customers]');
        ch.querySelector('input[type=hidden]').value = e.detail.customer_id;
        ch.querySelector('input[type=search]').value = e.detail.customer_name;
      });
    },
    onSubmit: async (d, close) => { if (row.id) await G.put(`/api/appointments/${row.id}`, d); else await G.post('/api/appointments', d); close(); G.toast(t('saved')); done && done(); },
  });

  G.addRoute('/appointments', (view) => G.listPage(view, {
    title: t('appointments'), res: 'appointments', canWrite: G.can(R.FRONT), csvName: 'appointments',
    defaultQuery: { from: G.today() },
    filters: [{ name: 'from', type: 'date' }, { name: 'to', type: 'date' }, { name: 'status', type: 'select', options: G.opt(['scheduled', 'arrived', 'no_show', 'cancelled']) }],
    onNew: (reload) => G.appointmentDialog({}, reload),
    onEdit: (row, reload) => G.appointmentDialog(row, reload),
    rowCls: (r) => (r.date === G.today() ? 'hl' : ''),
    columns: [
      { key: 'date' }, { key: 'time' }, { key: 'customer_name', label: t('customer'), render: (r) => `<a href="#/customers/${r.customer_id}">${esc(r.customer_name)}</a>` },
      { key: 'customer_phone', label: t('phone'), render: (r) => G.contactBtns(r.customer_phone, `${G.tl('تذكير بموعدكم', 'Reminder of your appointment')} ${r.date} ${r.time || ''} - ${G.tl(G.settings.center_name_ar, G.settings.center_name_en)}`) },
      { key: 'plate', label: t('vehicle'), render: (r) => esc(`${r.plate || ''} ${r.model || ''}`) }, { key: 'service', label: t('service_requested') },
      { key: 'advisor_name', label: t('advisor'), hideMobile: true }, { key: 'status', render: (r) => G.badge(r.status) },
      { key: 'go', label: '', render: (r) => (r.status === 'scheduled' && r.vehicle_id ? `<a class="btn btn-sm btn-primary" href="#/receptions/new?vehicle_id=${r.vehicle_id}&appointment_id=${r.id}">${t('start_checkin')}</a>` : '') },
      G.rowActions(G.can(R.FRONT), G.can(R.FRONT)),
    ].filter(Boolean),
  }), R.FRONT);

  // ---------------- receptions (check-in) ----------------
  G.addRoute('/receptions', (view) => G.listPage(view, {
    title: t('receptions'), res: 'receptions', canWrite: G.can(R.FRONT), csvName: 'receptions',
    onNew: () => { location.hash = '#/receptions/new'; },
    filters: [{ name: 'status', type: 'select', options: G.opt(['open', 'diagnosed', 'in_work', 'done', 'delivered', 'cancelled'], 'st_') }, { name: 'from', type: 'date' }, { name: 'to', type: 'date' }],
    rowLink: (r) => `#/receptions/${r.id}`,
    columns: [
      { key: 'no', label: t('reception_no'), render: (r) => `<b>${esc(r.no)}</b>` }, { key: 'date', render: (r) => G.fdt(r.date) },
      { key: 'plate', label: t('vehicle'), render: (r) => esc(`${r.plate || ''} ${r.series || ''} ${r.model || ''}`) },
      { key: 'customer_name', label: t('customer') }, { key: 'mileage', cls: 'num', render: (r) => G.int(r.mileage), hideMobile: true },
      { key: 'complaints', hideMobile: true, render: (r) => esc((r.complaints || '').slice(0, 60)) },
      { key: 'advisor_name', label: t('advisor'), hideMobile: true }, { key: 'status', render: (r) => G.badge(r.status, 'st_') },
    ],
  }), R.FRONT);

  const receptionForm = async (view, rec, query) => {
    const isNew = !rec.id;
    let vehicle = null;
    const vid = rec.vehicle_id || query.vehicle_id;
    if (vid) vehicle = await G.get(`/api/vehicles/${vid}`);
    const ck = G.parseJson(rec.checklist, {});
    const pendingFiles = [];
    view.innerHTML = `
      <div class="page-head"><h2>🚘 ${isNew ? t('new_reception') : `${t('edit')} ${esc(rec.no)}`}</h2></div>
      <form class="card rec-form" novalidate>
        <div class="form-grid">
          <div class="field span-2"><label>${t('choose_vehicle')} <b class="req">*</b></label>
            <div class="row-flex">${G.lookupHtml({ name: 'vehicle_id', res: 'vehicles', required: true, display: vehicle ? `${G.vehLabel(vehicle)} | ${vehicle.customer_name}` : '' }, vehicle ? vehicle.id : '', 'veh')}
            ${G.can(R.FRONT) ? `<button type="button" class="btn" data-newcv>＋ ${t('customer_and_vehicle')}</button>` : ''}</div>
            <div class="veh-card" data-vcard></div></div>
          ${G.field({ name: 'mileage', type: 'number', required: true }, rec.mileage)}
          ${G.field({ name: 'advisor_ids', label: t('advisors'), type: 'chips', options: G.empOptions(), span: 2 }, rec.advisor_ids || rec.advisor_id || G.user.employee_id || '')}
          ${G.field({ name: 'fuel_level', type: 'segment', options: G.FUEL_LEVELS, span: 2 }, rec.fuel_level || '1/2')}
          ${G.field({ name: 'complaints', type: 'textarea', rows: 4, required: true, span: 2 }, rec.complaints)}
          ${G.field({ name: 'warning_lights', type: 'chips', options: G.WARNING_LIGHTS.map((k) => [k, t('wl_' + k)]), span: 2 }, rec.warning_lights)}
          ${G.field({ name: 'ck_items', label: t('checklist'), type: 'chips', options: G.CHECK_ITEMS.map((k) => [k, t('ck_' + k)]), span: 2 }, ck.items)}
          ${G.field({ name: 'ck_zones', label: t('damages'), type: 'chips', options: G.ZONES.map((z) => [z[0], G.tl(z[1], z[2])]), span: 2 }, ck.zones)}
          ${G.field({ name: 'damages', label: t('damages') + ' - ' + t('details'), type: 'textarea', span: 2 }, rec.damages)}
          ${G.field({ name: 'belongings', type: 'textarea', rows: 2, span: 2 }, rec.belongings)}
          ${G.field({ name: 'expected_delivery', type: 'datetime-local' }, rec.expected_delivery)}
          ${G.field({ name: 'keys_count', label: G.tl('عدد المفاتيح', 'Keys count'), type: 'number' }, ck.keys_count || 1)}
          ${G.field({ name: 'driver_name' }, rec.driver_name)}${G.field({ name: 'driver_phone', type: 'tel' }, rec.driver_phone)}
          ${!isNew ? G.field({ name: 'status', type: 'select', options: G.opt(['open', 'diagnosed', 'in_work', 'done', 'delivered', 'cancelled'], 'st_'), noEmpty: true }, rec.status) : ''}
          ${G.field({ name: 'notes', type: 'textarea', rows: 2, span: 2 }, rec.notes)}
          ${isNew ? `<div class="field span-2"><label>${t('photos')}</label><label class="btn upload-btn">📷 ${t('add_photos')}<input type="file" accept="image/*" capture="environment" multiple hidden data-files></label><div class="photo-grid" data-preview></div></div>` : ''}
        </div>
        <div class="form-actions"><a class="btn" href="${isNew ? '#/receptions' : '#/receptions/' + rec.id}">${t('cancel')}</a><button class="btn btn-primary btn-lg" type="submit">💾 ${t('save')}</button></div>
      </form>`;
    const form = view.querySelector('form');
    G.bindLookups(form);
    const vcard = view.querySelector('[data-vcard]');
    const showVehicle = (v) => {
      if (!v) { vcard.innerHTML = ''; return; }
      vcard.innerHTML = `<b>${esc(G.vehLabel(v))}</b> · VIN: ${esc(v.vin || '-')} · ${t('mileage')}: ${G.int(v.mileage)} · 👤 ${esc(v.customer_name || '')} ${esc(v.customer_phone || '')}`;
      const m = form.querySelector('[name=mileage]');
      if (!m.value && v.mileage) m.placeholder = `≥ ${v.mileage}`;
    };
    showVehicle(vehicle);
    form.querySelector('.lookup').addEventListener('pick', (e) => showVehicle(e.detail));
    const ncv = view.querySelector('[data-newcv]');
    if (ncv) ncv.onclick = () => G.newCustomerVehicle((v, c) => {
      v.customer_name = c.name; v.customer_phone = c.phone;
      form.querySelector('.lookup input[type=hidden]').value = v.id;
      form.querySelector('.lookup input[type=search]').value = `${G.vehLabel(v)} | ${c.name}`;
      if (v.mileage) form.querySelector('[name=mileage]').value = v.mileage;
      showVehicle(v);
    });
    const fi = view.querySelector('[data-files]');
    if (fi) fi.onchange = async () => {
      for (const f of fi.files) {
        const r = await G.resizeImage(f);
        pendingFiles.push({ ...r, name: f.name });
      }
      fi.value = '';
      view.querySelector('[data-preview]').innerHTML = pendingFiles.map((p) => `<div class="photo"><img src="${p.data}" alt=""></div>`).join('');
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!G.validate(form)) return;
      const d = G.readForm(form);
      d.checklist = JSON.stringify({ items: d.ck_items, zones: d.ck_zones, keys_count: d.keys_count });
      delete d.ck_items; delete d.ck_zones; delete d.keys_count;
      d.mileage = Number(d.mileage) || null;
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        let r;
        if (isNew) {
          r = await G.post('/api/receptions', d);
          for (const p of pendingFiles) await G.post('/api/attachments', { ref_type: 'reception', ref_id: r.id, name: p.name, mime: p.mime, data: p.data });
          if (query.appointment_id) await G.put(`/api/appointments/${query.appointment_id}`, { status: 'arrived' }).catch(() => {});
        } else r = await G.put(`/api/receptions/${rec.id}`, d);
        G.toast(t('saved'));
        location.hash = `#/receptions/${r.id}`;
      } catch (err) { G.fail(err); btn.disabled = false; }
    };
  };
  G.addRoute('/receptions/new', (view, p, q) => receptionForm(view, {}, q), R.FRONT);
  G.addRoute('/receptions/:id/edit', async (view, p) => receptionForm(view, await G.get(`/api/receptions/${p.id}`), {}), R.FRONT);

  G.receptionPrint = (r) => {
    const ck = G.parseJson(r.checklist, {});
    const split = (s) => String(s || '').split(',').filter(Boolean);
    const both = (k) => `${window.I18N[k] ? window.I18N[k][0] + ' / ' + window.I18N[k][1] : k}`;
    G.print(`<h2 class="doc-title">${both('reception')} - ${esc(r.no)}</h2>
      <table class="ptbl"><tr><th>${both('date')}</th><td>${G.fdt(r.date)}</td><th>${both('advisors')}</th><td>${esc(r.advisor_name || '')}</td></tr>
      <tr><th>${both('customer')}</th><td>${esc(r.customer_name)} - ${esc(r.customer_phone || '')}</td><th>${both('plate')}</th><td>${esc(r.plate)}</td></tr>
      <tr><th>${both('vehicle')}</th><td>${esc(`${r.series || ''} ${r.model || ''} ${r.year || ''} ${r.color || ''}`)}</td><th>VIN</th><td>${esc(r.vin || '')}</td></tr>
      <tr><th>${both('mileage')}</th><td>${G.int(r.mileage)}</td><th>${both('fuel_level')}</th><td>${esc(r.fuel_level || '')}</td></tr>
      <tr><th>${both('expected_delivery')}</th><td>${G.fdt(r.expected_delivery)}</td><th>${G.tl('عدد المفاتيح', 'Keys')}</th><td>${esc(ck.keys_count || '')}</td></tr></table>
      <h3>${both('complaints')}</h3><div class="pbox">${esc(r.complaints || '').replace(/\n/g, '<br>')}</div>
      <h3>${both('warning_lights')}</h3><div class="pbox">${split(r.warning_lights).map((k) => t('wl_' + k)).join(' • ') || '-'}</div>
      <h3>${both('checklist')}</h3><div class="pbox">${G.CHECK_ITEMS.map((k) => `${split(ck.items).includes(k) ? '☑' : '☐'} ${t('ck_' + k)}`).join(' &nbsp; ')}</div>
      <h3>${both('damages')}</h3><div class="pbox">${split(ck.zones).map(G.zoneLabel).join(' • ')}${r.damages ? '<br>' + esc(r.damages) : ''}</div>
      <h3>${both('belongings')}</h3><div class="pbox">${esc(r.belongings || '-')}</div>
      <p class="terms">${window.I18N.checkin_terms[0]}<br>${window.I18N.checkin_terms[1]}</p>
      <div class="signs"><div>${both('customer_signature')}<br><br>..................</div><div>${both('advisor_signature')}<br><br>..................</div></div>`);
  };

  G.addRoute('/receptions/:id', async (view, p) => {
    const r = await G.get(`/api/receptions/${p.id}`);
    const diags = (await G.get(`/api/diagnoses?reception_id=${r.id}`)).rows;
    const ck = G.parseJson(r.checklist, {});
    const split = (s) => String(s || '').split(',').filter(Boolean);
    view.innerHTML = `
      <div class="page-head"><h2>🚘 ${esc(r.no)} ${G.badge(r.status, 'st_')}</h2><div class="head-actions">
        <button class="btn" data-print>🖨 ${t('print_checkin')}</button>
        ${G.can(R.FRONT) ? `<a class="btn" href="#/receptions/${r.id}/edit">✎ ${t('edit')}</a>` : ''}
        ${G.can(R.SHOP) ? `<button class="btn" data-diag>🩺 ${t('add_diagnosis')}</button>` : ''}
        ${r.work_order_id ? `<a class="btn btn-primary" href="#/work-orders/${r.work_order_id}">🔧 ${t('work_order')}</a>` : G.can(R.SHOP) ? `<button class="btn btn-primary" data-wo>🔧 ${t('create_wo')}</button>` : ''}
      </div></div>
      <div class="card info-grid">
        ${info(t('customer'), `<a href="#/customers/${r.customer_id}">${esc(r.customer_name)}</a> ${G.contactBtns(r.customer_phone)}`, true)}
        ${info(t('vehicle'), `<a href="#/vehicles/${r.vehicle_id}">${esc(`${r.plate} ${r.series || ''} ${r.model || ''}`)}</a>`, true)}
        ${info('VIN', r.vin)}${info(t('date'), G.fdt(r.date))}${info(t('mileage'), G.int(r.mileage))}${info(t('fuel_level'), r.fuel_level)}
        ${info(t('advisors'), r.advisor_name)}${info(t('expected_delivery'), G.fdt(r.expected_delivery))}${info(t('driver_name'), [r.driver_name, r.driver_phone].filter(Boolean).join(' - '))}
      </div>
      <div class="grid-2">
        <section class="card"><h3>${t('complaints')}</h3><p class="pre">${esc(r.complaints || '-')}</p>
          <h4>${t('warning_lights')}</h4><div class="tags">${split(r.warning_lights).map((k) => `<span class="tag warn">${t('wl_' + k)}</span>`).join('') || '-'}</div>
          <h4>${t('belongings')}</h4><p class="pre">${esc(r.belongings || '-')}</p><h4>${t('notes')}</h4><p class="pre">${esc(r.notes || '-')}</p></section>
        <section class="card"><h3>${t('checklist')}</h3><div class="tags">${G.CHECK_ITEMS.map((k) => `<span class="tag ${split(ck.items).includes(k) ? 'ok' : 'off'}">${split(ck.items).includes(k) ? '✔' : '✖'} ${t('ck_' + k)}</span>`).join('')}</div>
          <p>${G.tl('عدد المفاتيح', 'Keys')}: <b>${esc(ck.keys_count || '-')}</b></p>
          <h4>${t('damages')}</h4><div class="tags">${split(ck.zones).map((z) => `<span class="tag bad">${esc(G.zoneLabel(z))}</span>`).join('') || '-'}</div><p class="pre">${esc(r.damages || '')}</p></section>
      </div>
      <section class="card"><h3>📷 ${t('photos')}</h3>${G.photosBlock('reception', r.id, G.can(R.SHOP))}</section>
      <section class="card"><h3>🩺 ${t('diagnoses')}</h3>${G.table([{ key: 'date', render: (d) => G.fdt(d.date) }, { key: 'technician_name', label: t('technician') }, { key: 'fault_codes' }, { key: 'findings', render: (d) => `<span class="pre">${esc(d.findings || '')}</span>` }, { key: 'recommendations', render: (d) => `<span class="pre">${esc(d.recommendations || '')}</span>` }, { key: 'estimated_cost', cls: 'num', render: (d) => G.money(d.estimated_cost) }, { key: 'approval', render: (d) => G.badge(d.approval) },
    { key: 'a', label: '', render: () => (G.can(R.SHOP) ? `<button class="icon-btn" data-edit>✎</button>` : '') }], diags)}</section>`;
    G.bindPhotos(view);
    view.querySelector('[data-print]').onclick = () => G.receptionPrint(r);
    const db = view.querySelector('[data-diag]');
    if (db) db.onclick = () => G.diagnosisDialog({ reception_id: r.id, vehicle_id: r.vehicle_id, reception_no: r.no, plate: r.plate, model: r.model }, () => G.route());
    view.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => G.diagnosisDialog(diags[b.closest('tr').dataset.i], () => G.route()));
    const wb = view.querySelector('[data-wo]');
    if (wb) wb.onclick = async () => { try { const w = await G.post(`/api/receptions/${r.id}/work-order`, {}); location.hash = `#/work-orders/${w.id}`; } catch (e) { G.fail(e); } };
  }, R.FRONT.concat(['technician']));

  // ---------------- diagnoses ----------------
  G.diagnosisDialog = (row, done) => G.formDialog({
    title: row.id ? t('edit') + ' - ' + t('diagnosis') : t('add_diagnosis'), wide: true,
    fields: [
      { name: 'reception_id', label: t('reception'), type: 'lookup', res: 'receptions', display: row.reception_no ? `${row.reception_no} | ${row.plate || ''}` : '' },
      { name: 'vehicle_id', label: t('vehicle'), type: 'lookup', res: 'vehicles', display: row.plate ? `${row.plate} ${row.model || ''}` : '' },
      { name: 'technician_id', label: t('technician'), type: 'select', options: G.empOptions(), default: G.user.employee_id },
      { name: 'tool', type: 'select', options: ['ISTA+', 'ISTA-D', 'ISTA-P', 'E-Sys', 'Autel', 'Launch', 'Visual inspection', 'Road test', 'Other'].map((x) => [x, x]), default: 'ISTA+' },
      { name: 'fault_codes', span: 2, placeholder: '2A87, 130308, 480A13...' },
      { name: 'findings', type: 'textarea', rows: 4, span: 2 }, { name: 'recommendations', type: 'textarea', rows: 4, span: 2 },
      { name: 'estimated_cost', type: 'number' }, { name: 'estimated_hours', type: 'number' },
      { name: 'approval', type: 'select', options: G.opt(['pending', 'approved', 'rejected']), default: 'pending', noEmpty: true },
      { name: 'notes' },
    ],
    values: row,
    onMount: (m, form) => {
      form.querySelector('.lookup[data-res=receptions]').addEventListener('pick', (e) => {
        const vb = form.querySelector('.lookup[data-res=vehicles]');
        vb.querySelector('input[type=hidden]').value = e.detail.vehicle_id;
        vb.querySelector('input[type=search]').value = `${e.detail.plate || ''} ${e.detail.model || ''}`;
      });
    },
    onSubmit: async (d, close) => {
      if (!d.vehicle_id && !d.reception_id) throw new Error(t('err_required') + ': ' + t('vehicle'));
      if (row.id) await G.put(`/api/diagnoses/${row.id}`, d); else await G.post('/api/diagnoses', d);
      close(); G.toast(t('saved')); done && done();
    },
  });

  G.addRoute('/diagnoses', (view) => G.listPage(view, {
    title: t('diagnoses'), res: 'diagnoses', canWrite: G.can(R.SHOP), csvName: 'diagnoses',
    onNew: (reload) => G.diagnosisDialog({}, reload), onEdit: (row, reload) => G.diagnosisDialog(row, reload),
    filters: [{ name: 'approval', type: 'select', options: G.opt(['pending', 'approved', 'rejected']) }, { name: 'from', type: 'date' }, { name: 'to', type: 'date' }],
    columns: [
      { key: 'date', render: (r) => G.fdt(r.date) }, { key: 'reception_no', label: t('reception'), render: (r) => (r.reception_id ? `<a href="#/receptions/${r.reception_id}">${esc(r.reception_no)}</a>` : '-') },
      { key: 'plate', label: t('vehicle'), render: (r) => `<a href="#/vehicles/${r.vehicle_id}">${esc(`${r.plate || ''} ${r.model || ''}`)}</a>` },
      { key: 'customer_name', label: t('customer'), hideMobile: true }, { key: 'technician_name', label: t('technician') },
      { key: 'fault_codes' }, { key: 'findings', hideMobile: true, render: (r) => esc((r.findings || '').slice(0, 80)) },
      { key: 'estimated_cost', cls: 'num', render: (r) => G.money(r.estimated_cost) }, { key: 'approval', render: (r) => G.badge(r.approval) },
      { key: 'x', label: '', render: (r) => `${r.customer_phone ? `<a class="btn btn-sm btn-wa" target="_blank" rel="noopener" href="${G.waLink(r.customer_phone, estimateText(r))}">🟢 ${t('send_estimate')}</a>` : ''}
        ${r.approval !== 'rejected' && G.can(R.SHOP) ? `<button class="btn btn-sm btn-primary" data-mkwo>🔧 ${t('create_wo')}</button>` : ''}` },
      G.rowActions(G.can(R.SHOP), G.can(R.MGMT)),
    ].filter(Boolean),
    bind: (el, rows) => el.querySelectorAll('[data-mkwo]').forEach((b) => b.onclick = async () => {
      const d = rows[b.closest('tr').dataset.i];
      try {
        if (d.approval !== 'approved') await G.put(`/api/diagnoses/${d.id}`, { approval: 'approved' });
        const w = d.reception_id ? await G.post(`/api/receptions/${d.reception_id}/work-order`, {})
          : await G.post('/api/work-orders', { vehicle_id: d.vehicle_id, diagnosis_id: d.id, description: d.recommendations || d.findings });
        location.hash = `#/work-orders/${w.id}`;
      } catch (e) { G.fail(e); }
    }),
  }), R.SHOP);
  const estimateText = (r) => G.tl(
    `عميلنا العزيز ${r.customer_name || ''}\nنتيجة فحص سيارتكم ${r.plate || ''} ${r.model || ''}:\n${r.findings || ''}\nالإصلاحات المقترحة:\n${r.recommendations || ''}\nالتكلفة التقديرية: ${G.num(r.estimated_cost)} ${G.settings.currency}\nبرجاء الرد بالموافقة.\n${G.settings.center_name_ar}`,
    `Dear ${r.customer_name || ''}\nDiagnosis for your ${r.plate || ''} ${r.model || ''}:\n${r.findings || ''}\nRecommended repairs:\n${r.recommendations || ''}\nEstimated cost: ${G.num(r.estimated_cost)} ${G.settings.currency}\nPlease reply to approve.\n${G.settings.center_name_en}`);

  // ---------------- reminders ----------------
  G.reminderText = (r) => {
    const s = G.settings;
    const tpl = G.tl(s.whatsapp_template_ar, s.whatsapp_template_en) || G.tl(
      'عميلنا العزيز {customer}، نذكركم بموعد صيانة سيارتكم {model} رقم {plate}: {service} (موعد الاستحقاق {date}). للحجز اتصل بنا {phone} - {center}',
      'Dear {customer}, your {model} ({plate}) is due for: {service} on {date}. To book please call {phone} - {center}');
    return tpl.replace(/\{customer\}/g, r.customer_name || '').replace(/\{plate\}/g, r.plate || '').replace(/\{model\}/g, `${r.series || ''} ${r.model || ''}`.trim())
      .replace(/\{service\}/g, G.tl(r.service_name_ar, r.service_name_en) || r.title || '').replace(/\{date\}/g, r.due_date || '')
      .replace(/\{center\}/g, G.tl(s.center_name_ar, s.center_name_en)).replace(/\{phone\}/g, s.center_phone || '');
  };
  G.reminderDialog = (row, done) => G.formDialog({
    title: row.id ? t('edit') : t('new_reminder'),
    fields: [
      { name: 'vehicle_id', label: t('vehicle'), type: 'lookup', res: 'vehicles', required: true, display: row.display || (row.plate ? `${row.plate} ${row.model || ''}` : ''), span: 2 },
      { name: 'service_type_id', label: t('service_type'), type: 'select', options: () => (G.cache.service_types || []).map((s) => [s.id, G.tl(s.name_ar, s.name_en)]) },
      { name: 'title' }, { name: 'due_date', type: 'date', required: true }, { name: 'due_mileage', type: 'number' },
      { name: 'status', type: 'select', options: G.opt(['pending', 'contacted', 'booked', 'done', 'dismissed']), default: 'pending', noEmpty: true }, { name: 'notes' },
    ],
    values: row,
    onSubmit: async (d, close) => { if (row.id) await G.put(`/api/reminders/${row.id}`, d); else await G.post('/api/reminders', d); close(); G.toast(t('saved')); done && done(); },
  });

  G.addRoute('/reminders', async (view) => {
    await G.loadServiceTypes();
    view.innerHTML = `<div class="page-head"><h2>🔔 ${t('reminders')}</h2><div class="head-actions"><button class="btn btn-primary" data-new>＋ ${t('new_reminder')}</button></div></div><div data-tabs></div>`;
    view.querySelector('[data-new]').onclick = () => G.reminderDialog({}, () => G.route());
    const setStatus = async (r, status, reload) => { try { await G.put(`/api/reminders/${r.id}`, { status }); G.toast(t('saved')); reload(); } catch (e) { G.fail(e); } };
    const actions = (r) => `${G.contactBtns(r.customer_phone, G.reminderText(r))}
      <button class="btn btn-sm" data-st="contacted">☑ ${t('contacted')}</button><button class="btn btn-sm" data-book>📅 ${t('book')}</button>
      <button class="btn btn-sm" data-st="done">✔ ${t('done')}</button><button class="btn btn-sm btn-ghost" data-st="dismissed">✖ ${t('dismissed')}</button>`;
    const cols = [
      { key: 'customer_name', label: t('customer'), render: (r) => `<a href="#/customers/${r.customer_id}">${esc(r.customer_name)}</a><br><small>${esc(r.customer_phone || '')}</small>` },
      { key: 'plate', label: t('vehicle'), render: (r) => `<a href="#/vehicles/${r.vehicle_id}">${esc(`${r.plate || ''} ${r.series || ''} ${r.model || ''}`)}</a>` },
      { key: 'title', label: t('service_type'), render: (r) => esc(G.tl(r.service_name_ar, r.service_name_en) || r.title) },
      { key: 'last_service_date', label: t('last_service'), hideMobile: true },
      { key: 'due_date', render: (r) => `${esc(r.due_date || '')} ${r.overdue ? G.badge('overdue') : ''}` },
      { key: 'due_mileage', cls: 'num', render: (r) => `${G.int(r.due_mileage)}${r.current_mileage ? `<br><small>${t('current_mileage')}: ${G.int(r.current_mileage)}</small>` : ''}` },
      { key: 'status', render: (r) => G.badge(r.status) },
    ];
    const bindActions = (el, rows, reload) => {
      el.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => setStatus(rows[b.closest('tr').dataset.i], b.dataset.st, reload));
      el.querySelectorAll('[data-book]').forEach((b) => b.onclick = () => {
        const r = rows[b.closest('tr').dataset.i];
        G.appointmentDialog({ customer_id: r.customer_id, customer_name: r.customer_name, vehicle_id: r.vehicle_id, plate: r.plate, model: r.model, service: G.tl(r.service_name_ar, r.service_name_en) || r.title, date: r.due_date && r.due_date > G.today() ? r.due_date : G.today() },
          () => setStatus(r, 'booked', reload));
      });
    };
    G.tabs(view.querySelector('[data-tabs]'), [['due', t('due_list')], ['all', t('all_reminders')]], async (k, body) => {
      if (k === 'due') {
        const load = async () => {
          const rows = (await G.get('/api/reminders/due')).rows;
          body.innerHTML = `<div class="card">${G.table([...cols, { key: 'a', label: t('actions'), cls: 'actions-wide', render: actions }], rows, { rowCls: (r) => (r.overdue ? 'row-bad' : '') })}</div>`;
          bindActions(body, rows, load);
        };
        await load();
      } else {
        await G.listPage(body, {
          title: t('all_reminders'), res: 'reminders', canWrite: false, csvName: 'reminders',
          filters: [{ name: 'status', type: 'select', options: G.opt(['pending', 'contacted', 'booked', 'done', 'dismissed']) }, { name: 'from', type: 'date' }, { name: 'to', type: 'date' }],
          onEdit: (row, reload) => G.reminderDialog(row, reload),
          columns: [...cols, { key: 'a', label: t('actions'), cls: 'actions-wide', render: (r) => `${actions(r)}<button class="icon-btn" data-edit>✎</button><button class="icon-btn danger" data-delete>🗑</button>` }],
          bind: bindActions,
        });
      }
    });
  }, R.FRONT);
})();
