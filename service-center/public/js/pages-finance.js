/* Finance: invoices, cash, reports, bonuses */
(function () {
  const { t, esc, R } = G;
  const METHODS = ['cash', 'card', 'transfer', 'wallet', 'cheque'];
  const EXPENSE_CATS = ['rent', 'utilities', 'salary', 'bonus', 'tools', 'consumables', 'maintenance', 'marketing', 'government', 'transport', 'hospitality', 'towing', 'subcontract', 'owner_withdrawal', 'other_expense'];
  const INCOME_CATS = ['other_income', 'owner_deposit'];
  const invStatus = (s) => G.badge(s, s === 'paid' ? 'paid_' : s === 'cancelled' ? 'st_' : '');
  const both = (k) => `${window.I18N[k] ? window.I18N[k][0] + ' / ' + window.I18N[k][1] : k}`;

  // ---------------- invoices ----------------
  G.addRoute('/invoices', (view, p, q) => G.listPage(view, {
    title: t('invoices'), res: 'invoices', canWrite: G.can(R.BILL), csvName: 'invoices',
    defaultQuery: { unpaid: q.unpaid || '' },
    onNew: () => { location.hash = '#/invoices/new'; },
    filters: [{ name: 'status', type: 'select', options: [['unpaid', t('unpaid')], ['partial', t('partial')], ['paid', t('paid_full')], ['cancelled', t('cancelled')]] },
      { name: 'unpaid', label: t('unpaid_only'), type: 'checkbox' }, { name: 'from', type: 'date' }, { name: 'to', type: 'date' }],
    rowLink: (r) => `#/invoices/${r.id}`,
    columns: [
      { key: 'no', label: t('invoice_no'), render: (r) => `<b>${esc(r.no)}</b>` }, { key: 'date' },
      { key: 'customer_name', label: t('customer') }, { key: 'plate', label: t('vehicle'), render: (r) => esc(`${r.plate || ''} ${r.model || ''}`) },
      { key: 'work_order_no', label: t('wo_no'), hideMobile: true },
      { key: 'total', cls: 'num', render: (r) => G.money(r.total) }, { key: 'paid', cls: 'num', hideMobile: true, render: (r) => G.money(r.paid) },
      { key: 'due', cls: 'num', render: (r) => (r.status !== 'cancelled' && r.due > 0 ? `<b class="neg">${G.money(r.due)}</b>` : '-') },
      { key: 'status', render: (r) => invStatus(r.status) },
    ],
    foot: (rows) => `<tr><td colspan="5" class="hide-m"></td><td class="num" data-label="${t('total')}"><b>${G.money(rows.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + r.total, 0))}</b></td><td class="hide-m"></td><td class="num" data-label="${t('due')}"><b>${G.money(rows.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + r.due, 0))}</b></td><td></td></tr>`,
  }), R.BILL);

  // counter sale / manual invoice
  G.addRoute('/invoices/new', async (view) => {
    const accounts = G.can(R.MONEY.concat(['advisor'])) ? await G.loadAccounts().catch(() => []) : [];
    const items = [];
    view.innerHTML = `<div class="page-head"><h2>🧾 ${t('counter_sale')}</h2></div>
      <form class="card" novalidate>
        <div class="form-grid">
          ${G.field({ name: 'customer_id', label: t('customer'), type: 'lookup', res: 'customers', required: true })}
          ${G.field({ name: 'vehicle_id', label: t('vehicle'), type: 'lookup', res: 'vehicles' })}
          ${G.field({ name: 'date', type: 'date' }, G.today())}${G.field({ name: 'notes' })}
        </div>
        <h3 class="mt">${t('items')}</h3>
        <div class="add-line form-grid">
          ${G.field({ name: 'l_part', label: t('part'), type: 'lookup', res: 'parts', span: 2 })}
          ${G.field({ name: 'l_desc', label: t('description') + ' (' + t('k_other') + ')' })}
          ${G.field({ name: 'l_qty', label: t('qty'), type: 'number' }, 1)}${G.field({ name: 'l_price', label: t('unit_price'), type: 'number' })}
          <div class="field"><label>&nbsp;</label><button type="button" class="btn btn-primary" data-addline>＋ ${t('add_item')}</button></div>
        </div>
        <div data-lines></div>
        <div class="form-grid mt">${G.field({ name: 'discount', type: 'number' }, 0)}${G.field({ name: 'tax_rate', type: 'number' }, G.settings.vat_rate)}
          ${accounts.length ? `${G.field({ name: 'pay_amount', label: t('pay_now'), type: 'number' })}${G.field({ name: 'account_id', label: t('account'), type: 'select', options: accounts.map((a) => [a.id, a.name]), noEmpty: true })}
          ${G.field({ name: 'method', type: 'select', options: G.opt(METHODS, 'm_'), noEmpty: true }, 'cash')}` : ''}</div>
        <div class="totals" data-totals></div>
        <div class="form-actions"><a class="btn" href="#/invoices">${t('cancel')}</a><button class="btn btn-primary btn-lg" type="submit">💾 ${t('save')}</button></div>
      </form>`;
    const form = view.querySelector('form');
    G.bindLookups(form);
    let picked = null;
    form.querySelector('.lookup[data-res=parts]').addEventListener('pick', (e) => { picked = e.detail; form.querySelector('[name=l_price]').value = e.detail.price; });
    form.querySelector('.lookup[data-res=customers]').addEventListener('pick', (e) => { form.querySelector('.lookup[data-res=vehicles]').dataset.filter = `customer_id=${e.detail.id}`; });
    const calc = () => {
      const sub = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
      const disc = Number(form.querySelector('[name=discount]').value) || 0;
      const rate = Number(form.querySelector('[name=tax_rate]').value) || 0;
      const tax = (sub - disc) * rate / 100;
      view.querySelector('[data-totals]').innerHTML = `<div class="trow"><span>${t('subtotal')}</span><b>${G.money(sub)}</b></div><div class="trow"><span>${t('vat')}</span><b>${G.money(tax)}</b></div><div class="trow big"><span>${t('total')}</span><b>${G.money(sub - disc + tax)}</b></div>`;
    };
    const renderLines = () => {
      view.querySelector('[data-lines]').innerHTML = G.table([{ key: 'description' }, { key: 'qty', cls: 'num' }, { key: 'unit_price', cls: 'num', render: (i) => G.num(i.unit_price) }, { key: 'amount', cls: 'num', render: (i) => G.money(i.qty * i.unit_price) }, { key: 'x', label: '', render: () => '<button type="button" class="icon-btn danger" data-rm>🗑</button>' }], items);
      view.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { items.splice(Number(b.closest('tr').dataset.i), 1); renderLines(); });
      calc();
    };
    form.querySelectorAll('[name=discount],[name=tax_rate]').forEach((i) => i.oninput = calc);
    view.querySelector('[data-addline]').onclick = () => {
      const qty = Number(form.querySelector('[name=l_qty]').value) || 1;
      const price = Number(form.querySelector('[name=l_price]').value) || 0;
      const desc = form.querySelector('[name=l_desc]').value.trim();
      const pid = form.querySelector('[name=l_part]').value;
      if (!pid && !desc) { G.toast(t('err_required'), 'err'); return; }
      items.push({ part_id: pid ? Number(pid) : null, description: pid ? `${picked.part_no || ''} ${G.tl(picked.name_ar, picked.name_en)}`.trim() : desc, qty, unit_price: price, kind: pid ? 'part' : 'other' });
      form.querySelector('.lookup[data-res=parts] input[type=search]').value = '';
      form.querySelector('[name=l_part]').value = ''; form.querySelector('[name=l_desc]').value = ''; form.querySelector('[name=l_price]').value = ''; form.querySelector('[name=l_qty]').value = 1;
      picked = null;
      renderLines();
    };
    renderLines();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const cust = form.querySelector('[name=customer_id]').value;
      if (!cust) { G.toast(t('err_required') + ': ' + t('customer'), 'err'); return; }
      if (!items.length) { G.toast(t('err_invoice_empty'), 'err'); return; }
      const d = G.readForm(form);
      const body = { customer_id: cust, vehicle_id: d.vehicle_id || null, date: d.date, notes: d.notes, discount: d.discount, tax_rate: d.tax_rate, items };
      if (Number(d.pay_amount) > 0) body.payment = { amount: d.pay_amount, account_id: d.account_id, method: d.method };
      try { const inv = await G.post('/api/invoices', body); G.toast(t('saved')); location.hash = `#/invoices/${inv.id}`; } catch (err) { G.fail(err); }
    };
  }, R.BILL);

  G.invoicePrint = (inv) => {
    const s = G.settings;
    G.print(`<h2 class="doc-title">${s.tax_no ? both('tax_invoice') : both('invoice')}</h2>
      <table class="ptbl"><tr><th>${both('invoice_no')}</th><td><b>${esc(inv.no)}</b></td><th>${both('date')}</th><td>${esc(inv.date)}</td></tr>
      <tr><th>${both('customer')}</th><td>${esc(inv.customer.name)}<br>${esc(inv.customer.phone || '')}${inv.customer.tax_no ? '<br>' + t('tax_no') + ': ' + esc(inv.customer.tax_no) : ''}</td>
      <th>${both('vehicle')}</th><td>${inv.vehicle ? esc(`${inv.vehicle.plate} - ${inv.vehicle.series || ''} ${inv.vehicle.model || ''}`) + '<br>VIN: ' + esc(inv.vehicle.vin || '') : '-'}</td></tr>
      ${inv.work_order ? `<tr><th>${both('wo_no')}</th><td>${esc(inv.work_order.no)}</td><th>${both('mileage')}</th><td>${G.int(inv.work_order.mileage)}</td></tr>` : ''}</table>
      <table class="ptbl lines"><thead><tr><th>#</th><th>${both('kind')}</th><th>${both('description')}</th><th>${both('qty')}</th><th>${both('unit_price')}</th><th>${both('amount')}</th></tr></thead>
      <tbody>${inv.items.map((i, n) => `<tr><td>${n + 1}</td><td>${t('k_' + i.kind)}</td><td>${esc(i.description)}</td><td>${G.num(i.qty)}</td><td>${G.num(i.unit_price)}</td><td>${G.num(i.amount)}</td></tr>`).join('')}</tbody></table>
      <table class="ptbl ptotals">
        <tr><th>${both('labor_total')}</th><td>${G.money(inv.labor_total)}</td></tr><tr><th>${both('parts_total')}</th><td>${G.money(inv.parts_total)}</td></tr>
        <tr><th>${both('subtotal')}</th><td>${G.money(inv.subtotal)}</td></tr>${inv.discount ? `<tr><th>${both('discount')}</th><td>- ${G.money(inv.discount)}</td></tr>` : ''}
        <tr><th>${both('vat')} (${G.num(inv.tax_rate)}%)</th><td>${G.money(inv.tax)}</td></tr><tr class="grand"><th>${both('grand_total')}</th><td>${G.money(inv.total)}</td></tr>
        <tr><th>${both('paid')}</th><td>${G.money(inv.paid)}</td></tr><tr><th>${both('due')}</th><td>${G.money(inv.total - inv.paid)}</td></tr></table>
      ${inv.notes ? `<div class="pbox">${esc(inv.notes)}</div>` : ''}
      <p class="terms">${esc(s.invoice_footer_ar || '')}<br>${esc(s.invoice_footer_en || '')}</p>
      <div class="signs"><div>${both('customer_signature')}<br><br>..................</div><div>${G.tl('الختم', 'Stamp')} / ${G.tl('التوقيع', 'Signature')}<br><br>..................</div></div>`);
  };

  G.addRoute('/invoices/:id', async (view, p) => {
    let inv = await G.get(`/api/invoices/${p.id}/full`);
    const render = () => {
      const due = Math.round((inv.total - inv.paid) * 100) / 100;
      const shareText = G.tl(
        `${G.settings.center_name_ar}\nفاتورة رقم ${inv.no} بتاريخ ${inv.date}\nالسيارة: ${inv.vehicle ? inv.vehicle.plate : ''}\nالإجمالي: ${G.num(inv.total)} ${G.settings.currency}\nالمدفوع: ${G.num(inv.paid)}\nالمتبقي: ${G.num(due)}\nشكراً لكم`,
        `${G.settings.center_name_en}\nInvoice ${inv.no} - ${inv.date}\nVehicle: ${inv.vehicle ? inv.vehicle.plate : ''}\nTotal: ${G.num(inv.total)} ${G.settings.currency}\nPaid: ${G.num(inv.paid)}\nDue: ${G.num(due)}\nThank you`);
      view.innerHTML = `
        <div class="page-head"><h2>🧾 ${esc(inv.no)} ${invStatus(inv.status)}</h2><div class="head-actions">
          <button class="btn" data-print>🖨 ${t('print')}</button>
          ${inv.customer.phone ? `<a class="btn btn-wa" target="_blank" rel="noopener" href="${G.waLink(inv.customer.phone, shareText)}">🟢 ${t('share')}</a>` : ''}
          ${inv.status !== 'cancelled' && due > 0 && G.can(R.MONEY.concat(['advisor'])) ? `<button class="btn btn-primary" data-pay>💵 ${t('add_payment')}</button>` : ''}
          ${inv.status !== 'cancelled' && G.can(R.MGMT) ? `<button class="btn" data-disc>％ ${t('edit_discount')}</button>` : ''}
          ${inv.status !== 'cancelled' && inv.paid > 0 && G.can(R.MONEY) ? `<button class="btn" data-refund>↩ ${t('refund')}</button>` : ''}
          ${inv.status !== 'cancelled' && inv.paid <= 0 && G.can(R.MGMT) ? `<button class="btn btn-danger" data-cancel>✖ ${t('cancel_invoice')}</button>` : ''}
        </div></div>
        <div class="card info-grid">
          ${G.info(t('customer'), `<a href="#/customers/${inv.customer_id}">${esc(inv.customer.name)}</a>`, true)}${G.info(t('phone'), inv.customer.phone)}
          ${G.info(t('vehicle'), inv.vehicle ? `<a href="#/vehicles/${inv.vehicle.id}">${esc(G.vehLabel(inv.vehicle))}</a>` : '-', true)}
          ${G.info(t('wo_no'), inv.work_order ? `<a href="#/work-orders/${inv.work_order.id}">${esc(inv.work_order.no)}</a>` : '-', true)}${G.info(t('date'), inv.date)}
        </div>
        <section class="card"><h3>${t('items')}</h3>${G.table([{ key: 'kind', render: (i) => t('k_' + i.kind) }, { key: 'description' }, { key: 'technician_name', label: t('technician'), hideMobile: true },
    { key: 'qty', cls: 'num', render: (i) => G.num(i.qty) }, { key: 'unit_price', cls: 'num', render: (i) => G.num(i.unit_price) }, { key: 'amount', cls: 'num', render: (i) => G.money(i.amount) }], inv.items)}</section>
        <div class="grid-2">
          <section class="card"><h3>${t('payments')}</h3>${G.table([{ key: 'date' }, { key: 'account_name', label: t('account') }, { key: 'method', render: (x) => t('m_' + x.method) }, { key: 'direction', render: (x) => (x.direction === 'out' ? G.badge('refund') : '') }, { key: 'amount', cls: 'num', render: (x) => G.money(x.amount) }, { key: 'user_name', label: t('user'), hideMobile: true }], inv.payments)}</section>
          <section class="card totals"><h3>${t('summary')}</h3>
            <div class="trow"><span>${t('labor_total')}</span><b>${G.money(inv.labor_total)}</b></div><div class="trow"><span>${t('parts_total')}</span><b>${G.money(inv.parts_total)}</b></div>
            <div class="trow"><span>${t('subtotal')}</span><b>${G.money(inv.subtotal)}</b></div><div class="trow"><span>${t('discount')}</span><b>- ${G.money(inv.discount)}</b></div>
            <div class="trow"><span>${t('vat')} (${G.num(inv.tax_rate)}%)</span><b>${G.money(inv.tax)}</b></div><div class="trow big"><span>${t('grand_total')}</span><b>${G.money(inv.total)}</b></div>
            <div class="trow"><span>${t('paid')}</span><b class="pos">${G.money(inv.paid)}</b></div><div class="trow big"><span>${t('due')}</span><b class="${due > 0 ? 'neg' : ''}">${G.money(due)}</b></div>
            ${G.can(R.MONEY) && inv.parts_cost !== undefined ? `<div class="trow muted"><span>${t('parts_cost')}</span><b>${G.money(inv.parts_cost)}</b></div><div class="trow muted"><span>${t('gross_profit')}</span><b>${G.money(inv.subtotal - inv.discount - inv.parts_cost)}</b></div>` : ''}
          </section>
        </div>
        ${inv.notes ? `<section class="card"><h3>${t('notes')}</h3><p class="pre">${esc(inv.notes)}</p></section>` : ''}`;
      view.querySelector('[data-print]').onclick = () => G.invoicePrint(inv);
      const payDialog = async (refund) => {
        const accounts = await G.loadAccounts();
        G.formDialog({
          title: refund ? t('refund') : t('add_payment'),
          fields: [{ name: 'amount', type: 'number', required: true, default: refund ? '' : due }, { name: 'date', type: 'date', default: G.today() },
            { name: 'account_id', label: t('account'), type: 'select', options: accounts.map((a) => [a.id, a.name]), noEmpty: true },
            { name: 'method', type: 'select', options: G.opt(METHODS, 'm_'), default: 'cash', noEmpty: true }],
          onSubmit: async (d, close) => { if (refund) d.refund = true; inv = await G.post(`/api/invoices/${inv.id}/payments`, d); close(); G.toast(t('saved')); render(); },
        });
      };
      const pb = view.querySelector('[data-pay]'); if (pb) pb.onclick = () => payDialog(false);
      const rb = view.querySelector('[data-refund]'); if (rb) rb.onclick = () => payDialog(true);
      const db = view.querySelector('[data-disc]');
      if (db) db.onclick = () => G.formDialog({
        title: t('edit_discount'), fields: [{ name: 'discount', type: 'number' }, { name: 'tax_rate', type: 'number' }], values: inv,
        onSubmit: async (d, close) => { inv = await G.post(`/api/invoices/${inv.id}/discount`, d); close(); render(); },
      });
      const cb = view.querySelector('[data-cancel]');
      if (cb) cb.onclick = async () => { if (!(await G.confirm(t('cancel_invoice') + '?'))) return; try { inv = await G.post(`/api/invoices/${inv.id}/cancel`); render(); } catch (e) { G.fail(e); } };
    };
    render();
  }, R.BILL);

  // ---------------- cash / treasury ----------------
  const catLabel = (c) => t('c_' + c);
  G.txDialog = async (direction, done) => {
    const accounts = await G.loadAccounts(true);
    const cats = direction === 'in' ? INCOME_CATS : EXPENSE_CATS;
    await G.loadEmployees();
    G.formDialog({
      title: direction === 'in' ? t('add_income') : t('add_expense'),
      fields: [
        { name: 'amount', type: 'number', required: true }, { name: 'date', type: 'date', default: G.today() },
        { name: 'account_id', label: t('account'), type: 'select', options: accounts.map((a) => [a.id, `${a.name} (${G.num(a.balance)})`]), noEmpty: true },
        { name: 'category', type: 'select', options: cats.map((c) => [c, catLabel(c)]), required: true, noEmpty: true },
        { name: 'party_id', label: t('employee') + ' (' + G.tl('اختياري', 'optional') + ')', type: 'select', options: G.empOptions() },
        { name: 'method', type: 'select', options: G.opt(METHODS, 'm_'), default: 'cash', noEmpty: true },
        { name: 'description', span: 2 },
      ],
      onSubmit: async (d, close) => {
        d.direction = direction;
        if (d.party_id) d.party_type = 'employee'; else delete d.party_id;
        await G.post('/api/transactions', d); close(); G.toast(t('saved')); done && done();
      },
    });
  };

  G.addRoute('/cash', async (view) => {
    view.innerHTML = `<div class="page-head"><h2>💰 ${t('cash')}</h2><div class="head-actions">
        <button class="btn btn-ok" data-in>＋ ${t('add_income')}</button><button class="btn btn-danger" data-out>－ ${t('add_expense')}</button>
        <button class="btn" data-transfer>⇄ ${t('transfer')}</button>${G.can(R.MGMT) ? `<button class="btn" data-acc>＋ ${t('new_account')}</button>` : ''}</div></div>
      <div class="kpis" data-accounts></div><div data-tabs></div>`;
    const loadAccounts = async () => {
      const accs = await G.loadAccounts(true);
      view.querySelector('[data-accounts]').innerHTML = accs.map((a) => `<div class="kpi ${a.balance < 0 ? 'bad' : ''}"><span class="kpi-i">${{ cash: '💵', bank: '🏦', pos: '💳', wallet: '📱' }[a.type] || '💰'}</span><div><small>${esc(a.name)}</small><b>${G.money(a.balance)}</b></div>${G.can(R.MGMT) ? `<button class="icon-btn" data-edit-acc="${a.id}">✎</button>` : ''}</div>`).join('');
      view.querySelectorAll('[data-edit-acc]').forEach((b) => b.onclick = () => accDialog(accs.find((a) => a.id === Number(b.dataset.editAcc))));
    };
    const accDialog = (a = {}) => G.formDialog({
      title: a.id ? t('edit') : t('new_account'),
      fields: [{ name: 'name', required: true, span: 2 }, { name: 'type', type: 'select', options: G.opt(['cash', 'bank', 'pos', 'wallet'], 'acc_'), noEmpty: true }, { name: 'opening_balance', type: 'number' }, { name: 'active', type: 'checkbox', default: 1 }],
      values: a,
      onSubmit: async (d, close) => { if (a.id) await G.put(`/api/accounts/${a.id}`, d); else await G.post('/api/accounts', d); close(); refreshAll(); },
    });
    let reloadTx = () => {};
    const refreshAll = () => { loadAccounts(); reloadTx(); };
    view.querySelector('[data-in]').onclick = () => G.txDialog('in', refreshAll);
    view.querySelector('[data-out]').onclick = () => G.txDialog('out', refreshAll);
    const ab = view.querySelector('[data-acc]'); if (ab) ab.onclick = () => accDialog();
    view.querySelector('[data-transfer]').onclick = async () => {
      const accs = await G.loadAccounts(true);
      const opts = accs.map((a) => [a.id, `${a.name} (${G.num(a.balance)})`]);
      G.formDialog({
        title: t('transfer'),
        fields: [{ name: 'from', label: t('from_account'), type: 'select', options: opts, required: true }, { name: 'to', label: t('to_account'), type: 'select', options: opts, required: true },
          { name: 'amount', type: 'number', required: true }, { name: 'date', type: 'date', default: G.today() }, { name: 'description', span: 2 }],
        onSubmit: async (d, close) => { await G.post('/api/transfer', d); close(); G.toast(t('saved')); refreshAll(); },
      });
    };
    await loadAccounts();
    const accs = G.cache.accounts;
    const allCats = ['invoice_payment', 'refund', 'supplier_payment', 'supplier_refund', 'transfer', ...EXPENSE_CATS, ...INCOME_CATS];
    G.tabs(view.querySelector('[data-tabs]'), [['tx', t('transactions')], ['daily', t('daily_closing')]], async (k, body) => {
      if (k === 'tx') {
        const lp = await G.listPage(body, {
          title: t('transactions'), res: 'transactions', canWrite: false, csvName: 'transactions',
          defaultQuery: { from: G.monthStart() },
          filters: [{ name: 'account_id', label: t('account'), type: 'select', options: accs.map((a) => [a.id, a.name]) }, { name: 'direction', type: 'select', options: [['in', t('d_in')], ['out', t('d_out')]] },
            { name: 'category', type: 'select', options: allCats.map((c) => [c, catLabel(c)]) }, { name: 'from', type: 'date' }, { name: 'to', type: 'date' }],
          columns: [
            { key: 'date' }, { key: 'account_name', label: t('account') }, { key: 'category', render: (r) => catLabel(r.category) },
            { key: 'description', render: (r) => esc(r.description || '') + (r.ref_type === 'invoice' ? ` <a href="#/invoices/${r.ref_id}">↗</a>` : r.ref_type === 'purchase' ? ` <a href="#/purchases/${r.ref_id}">↗</a>` : '') },
            { key: 'party_name', label: t('party'), hideMobile: true }, { key: 'method', hideMobile: true, render: (r) => (r.method ? t('m_' + r.method) : '') },
            { key: 'in', label: t('d_in'), cls: 'num', render: (r) => (r.direction === 'in' ? `<b class="pos">${G.money(r.amount)}</b>` : '') },
            { key: 'out', label: t('d_out'), cls: 'num', render: (r) => (r.direction === 'out' ? `<b class="neg">${G.money(r.amount)}</b>` : '') },
            { key: 'user_name', label: t('user'), hideMobile: true },
            { key: 'a', label: '', render: (r) => (!r.ref_type || r.ref_type === 'transfer' ? '<button class="icon-btn danger" data-delete>🗑</button>' : '') },
          ],
          csvColumns: [{ key: 'date' }, { key: 'account_name', label: t('account') }, { key: 'category', csv: (r) => catLabel(r.category) }, { key: 'description' }, { key: 'party_name', label: t('party') }, { key: 'direction' }, { key: 'amount' }],
          foot: (rows) => { const i = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amount, 0); const o = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amount, 0); return `<tr><td colspan="6" class="hide-m"></td><td class="num" data-label="${t('d_in')}"><b class="pos">${G.money(i)}</b></td><td class="num" data-label="${t('d_out')}"><b class="neg">${G.money(o)}</b></td><td colspan="2" data-label="${t('net')}"><b>${G.money(i - o)}</b></td></tr>`; },
          onSaved: () => loadAccounts(),
        });
        reloadTx = lp.reload;
      } else {
        body.innerHTML = `<div class="toolbar">${G.field({ name: 'date', type: 'date' }, G.today())}<button class="btn" data-pr>🖨 ${t('print')}</button></div><div data-out></div>`;
        const load = async () => {
          const d = await G.get('/api/cash/daily?date=' + body.querySelector('[name=date]').value);
          const html = `<h3>${t('daily_closing')} - ${d.date}</h3>${G.table([{ key: 'name', label: t('account') }, { key: 'opening', cls: 'num', render: (r) => G.money(r.opening) }, { key: 'cash_in', cls: 'num', render: (r) => G.money(r.cash_in) }, { key: 'cash_out', cls: 'num', render: (r) => G.money(r.cash_out) }, { key: 'closing', cls: 'num', render: (r) => `<b>${G.money(r.closing)}</b>` }], d.accounts)}
            <h3 class="mt">${t('category')}</h3>${G.table([{ key: 'category', render: (r) => catLabel(r.category) }, { key: 'direction', render: (r) => t('d_' + r.direction) }, { key: 'n', label: t('count'), cls: 'num' }, { key: 'amount', cls: 'num', render: (r) => G.money(r.amount) }], d.by_category)}`;
          body.querySelector('[data-out]').innerHTML = `<div class="card">${html}</div>`;
          body.querySelector('[data-pr]').onclick = () => G.print(html);
        };
        body.querySelector('[name=date]').onchange = load;
        await load();
      }
    });
  }, R.MONEY);

  // ---------------- reports ----------------
  G.addRoute('/reports', async (view) => {
    const presets = {
      today: () => [G.today(), G.today()], month: () => [G.monthStart(), G.today()],
      last_month: () => { const d = new Date(); const s = new Date(d.getFullYear(), d.getMonth() - 1, 1); const e = new Date(d.getFullYear(), d.getMonth(), 0); const f = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); return [f(s), f(e)]; },
      year: () => [G.today().slice(0, 4) + '-01-01', G.today()],
    };
    view.innerHTML = `<div class="page-head"><h2>📈 ${t('reports')}</h2><div class="head-actions"><button class="btn" data-pr>🖨 ${t('print')}</button></div></div>
      <div class="toolbar">${G.field({ name: 'from', type: 'date' }, G.monthStart())}${G.field({ name: 'to', type: 'date' }, G.today())}
        <button class="btn btn-sm" data-p="today">${t('today')}</button><button class="btn btn-sm" data-p="month">${t('this_month')}</button>
        <button class="btn btn-sm" data-p="last_month">${t('last_month')}</button><button class="btn btn-sm" data-p="year">${t('this_year')}</button></div>
      <div data-out><div class="loading">${t('loading')}</div></div>`;
    const out = view.querySelector('[data-out]');
    const load = async () => {
      const from = view.querySelector('[name=from]').value; const to = view.querySelector('[name=to]').value;
      const r = await G.get(`/api/reports/summary?from=${from}&to=${to}`);
      const k = (label, v, cls = '') => `<div class="kpi ${cls}"><div><small>${label}</small><b>${v}</b></div></div>`;
      const maxD = Math.max(1, ...r.daily.map((x) => x.total));
      out.innerHTML = `
        <h3>${t('profit_loss')} (${r.from} → ${r.to})</h3>
        <div class="kpis">
          ${k(t('sales'), G.money(r.invoices.total))}${k(t('invoices_count'), G.int(r.invoices.n))}${k(t('labor'), G.money(r.invoices.labor))}${k(t('parts_total'), G.money(r.invoices.parts))}
          ${k(t('discount'), G.money(r.invoices.discount))}${k(t('vat'), G.money(r.invoices.tax))}${k(t('net_sales'), G.money(r.net_sales))}${k(t('parts_cost'), G.money(r.invoices.parts_cost))}
          ${k(t('gross_profit'), G.money(r.gross_profit), 'ok')}${k(t('other_income'), G.money(r.other_income))}${k(t('expenses'), G.money(r.total_expenses), 'warn')}${k(t('net_profit'), G.money(r.net_profit), r.net_profit >= 0 ? 'ok' : 'bad')}
          ${k(t('purchases_total'), G.money(r.purchases))}${k(t('cars_serviced'), G.int(r.cars_serviced))}${k(t('new_customers'), G.int(r.new_customers))}
          ${k(t('receivables'), G.money(r.receivables))}${k(t('payables'), G.money(r.payables))}${k(t('stock_value'), G.money(r.stock_value))}
        </div>
        ${r.daily.length ? `<section class="card"><h3>${t('daily_sales')}</h3><div class="bars">${r.daily.map((x) => `<div class="bar" title="${x.date}: ${G.num(x.total)}"><i style="height:${Math.round((x.total / maxD) * 100)}%"></i><small>${x.date.slice(5)}</small></div>`).join('')}</div></section>` : ''}
        <div class="grid-2">
          <section class="card"><h3>${t('expenses')}</h3>${G.table([{ key: 'category', render: (x) => catLabel(x.category) }, { key: 'amount', cls: 'num', render: (x) => G.money(x.amount) }], r.expenses)}</section>
          <section class="card"><h3>${t('cashflow')}</h3>${G.table([{ key: 'name', label: t('account') }, { key: 'cash_in', cls: 'num', render: (x) => G.money(x.cash_in) }, { key: 'cash_out', cls: 'num', render: (x) => G.money(x.cash_out) }], r.cashflow)}</section>
          <section class="card"><h3>${t('top_services')}</h3>${G.table([{ key: 'description' }, { key: 'n', label: t('count'), cls: 'num' }, { key: 'amount', cls: 'num', render: (x) => G.money(x.amount) }], r.top_services)}</section>
          <section class="card"><h3>${t('top_parts')}</h3>${G.table([{ key: 'description' }, { key: 'qty', cls: 'num', render: (x) => G.num(x.qty) }, { key: 'amount', cls: 'num', render: (x) => G.money(x.amount) }, { key: 'profit', cls: 'num', render: (x) => G.money(x.profit) }], r.top_parts)}</section>
          <section class="card"><h3>${t('by_series')}</h3>${G.table([{ key: 'series' }, { key: 'n', label: t('count'), cls: 'num' }, { key: 'amount', cls: 'num', render: (x) => G.money(x.amount) }], r.by_series)}</section>
          <section class="card"><h3>${t('technician_performance')}</h3>${G.table([{ key: 'name', label: t('employee') }, { key: 'jobs', cls: 'num' }, { key: 'hours', cls: 'num', render: (x) => G.num(x.hours) }, { key: 'labor_sales', cls: 'num', render: (x) => G.money(x.labor_sales) }, { key: 'commission', cls: 'num', render: (x) => G.money(x.commission) }], r.technicians)}</section>
        </div>`;
    };
    view.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { const [f, tt] = presets[b.dataset.p](); view.querySelector('[name=from]').value = f; view.querySelector('[name=to]').value = tt; load().catch(G.fail); });
    view.querySelectorAll('[name=from],[name=to]').forEach((i) => i.onchange = () => load().catch(G.fail));
    view.querySelector('[data-pr]').onclick = () => G.print(out.innerHTML);
    await load();
  }, R.MONEY);

  // ---------------- bonuses, commissions, payroll ----------------
  G.addRoute('/bonuses', async (view) => {
    await G.loadEmployees(true);
    view.innerHTML = `<div class="page-head"><h2>🎁 ${t('bonuses')}</h2></div><div data-tabs></div>`;
    G.tabs(view.querySelector('[data-tabs]'), [['list', t('bonus') + ' / ' + t('deduction')], ['comm', t('commissions_calc')], ['payroll', t('payroll')]], async (k, body) => {
      if (k === 'list') {
        await G.listPage(body, {
          title: t('bonus') + ' / ' + t('deduction'), res: 'bonuses', csvName: 'bonuses',
          fields: [{ name: 'employee_id', label: t('employee'), type: 'select', options: G.empOptions(), required: true }, { name: 'type', type: 'select', options: G.opt(['bonus', 'deduction', 'commission']), default: 'bonus', noEmpty: true },
            { name: 'amount', type: 'number', required: true }, { name: 'date', type: 'date', default: G.today() }, { name: 'period', label: t('month'), type: 'month', default: G.today().slice(0, 7) }, { name: 'reason', span: 2 }],
          filters: [{ name: 'employee_id', label: t('employee'), type: 'select', options: G.empOptions() }, { name: 'type', type: 'select', options: G.opt(['bonus', 'deduction', 'commission']) },
            { name: 'paid', label: t('is_paid'), type: 'select', options: [['1', t('yes')], ['0', t('no')]] }, { name: 'from', type: 'date' }, { name: 'to', type: 'date' }],
          columns: [{ key: 'date' }, { key: 'employee_name', label: t('employee') }, { key: 'type', render: (r) => G.badge(r.type) }, { key: 'amount', cls: 'num', render: (r) => `<b class="${r.type === 'deduction' ? 'neg' : 'pos'}">${G.money(r.amount)}</b>` },
            { key: 'period', label: t('month') }, { key: 'reason' }, { key: 'paid', label: t('is_paid'), render: (r) => (r.paid ? '✔' : '') },
            { key: 'a', label: '', render: (r) => (r.paid ? '' : '<button class="icon-btn" data-edit>✎</button><button class="icon-btn danger" data-delete>🗑</button>') }],
        });
      } else if (k === 'comm') {
        body.innerHTML = `<div class="toolbar">${G.field({ name: 'from', type: 'date' }, G.monthStart())}${G.field({ name: 'to', type: 'date' }, G.today())}<button class="btn btn-primary" data-approve>✔ ${t('approve_commissions')}</button></div><div class="card" data-out></div>`;
        const load = async () => {
          const from = body.querySelector('[name=from]').value; const to = body.querySelector('[name=to]').value;
          const rows = await G.get(`/api/bonuses/commissions?from=${from}&to=${to}`);
          body.querySelector('[data-out]').innerHTML = G.table([
            { key: 'name', label: t('employee') }, { key: 'job', render: (r) => t('j_' + r.job) }, { key: 'jobs', cls: 'num' }, { key: 'hours', cls: 'num', render: (r) => G.num(r.hours) },
            { key: 'labor_sales', cls: 'num', render: (r) => G.money(r.labor_sales) }, { key: 'labor_commission_rate', label: t('labor_commission'), cls: 'num', render: (r) => G.num(r.labor_commission_rate) + '%' },
            { key: 'parts_sales', cls: 'num', render: (r) => G.money(r.parts_sales) }, { key: 'parts_commission_rate', label: t('parts_commission'), cls: 'num', render: (r) => G.num(r.parts_commission_rate) + '%' },
            { key: 'commission', label: t('commission_total'), cls: 'num', render: (r) => `<b>${G.money(r.commission)}</b>` }, { key: 'commission_recorded', label: t('recorded'), cls: 'num', render: (r) => G.money(r.commission_recorded) },
          ], rows);
        };
        body.querySelectorAll('[name=from],[name=to]').forEach((i) => i.onchange = () => load().catch(G.fail));
        body.querySelector('[data-approve]').onclick = async () => {
          if (!(await G.confirm(t('approve_commissions') + '?'))) return;
          try { const r = await G.post('/api/bonuses/commissions/approve', { from: body.querySelector('[name=from]').value, to: body.querySelector('[name=to]').value }); G.toast(`${t('saved')} (${r.created})`); load(); } catch (e) { G.fail(e); }
        };
        await load();
      } else {
        body.innerHTML = `<div class="toolbar">${G.field({ name: 'period', label: t('month'), type: 'month' }, G.today().slice(0, 7))}</div><div class="card" data-out></div>`;
        const load = async () => {
          const period = body.querySelector('[name=period]').value;
          const rows = await G.get('/api/payroll?period=' + period);
          body.querySelector('[data-out]').innerHTML = G.table([
            { key: 'name', label: t('employee') }, { key: 'job', render: (r) => t('j_' + r.job) }, { key: 'salary', cls: 'num', render: (r) => G.money(r.salary) },
            { key: 'salary_paid', cls: 'num', render: (r) => G.money(r.salary_paid) }, { key: 'bonuses', label: t('bonus'), cls: 'num', render: (r) => `<span class="pos">${G.money(r.bonuses)}</span>` },
            { key: 'deductions', cls: 'num', render: (r) => `<span class="neg">${G.money(r.deductions)}</span>` }, { key: 'net', cls: 'num', render: (r) => `<b>${G.money(r.net)}</b>` },
            { key: 'a', label: '', render: (r) => (r.net > 0 ? `<button class="btn btn-sm btn-primary" data-pay>💵 ${t('pay')}</button>` : '') },
          ], rows, { foot: `<tr><td colspan="6" data-label=""></td><td class="num" data-label="${t('net')}"><b>${G.money(rows.reduce((s, r) => s + Math.max(0, r.net), 0))}</b></td><td></td></tr>` });
          body.querySelectorAll('[data-pay]').forEach((b) => b.onclick = async () => {
            const r = rows[b.closest('tr').dataset.i];
            const accounts = await G.loadAccounts(true);
            G.formDialog({
              title: `${t('pay')} - ${r.name} (${G.money(r.net)})`,
              fields: [{ name: 'account_id', label: t('account'), type: 'select', options: accounts.map((a) => [a.id, `${a.name} (${G.num(a.balance)})`]), noEmpty: true }],
              onSubmit: async (d, close) => { await G.post('/api/payroll/pay', { employee_id: r.employee_id, account_id: d.account_id, period }); close(); G.toast(t('saved')); load(); },
            });
          });
        };
        body.querySelector('[name=period]').onchange = () => load().catch(G.fail);
        await load();
      }
    });
  }, R.MONEY);
})();
