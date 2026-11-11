/* Store: parts, stock movements, suppliers, purchases */
(function () {
  const { t, esc, R } = G;
  const PART_CATS = ['Engine oil', 'Filters', 'Brakes', 'Suspension', 'Steering', 'Electrical', 'Ignition', 'Cooling', 'A/C', 'Transmission', 'Body', 'Lights', 'Tyres', 'Batteries', 'Fluids', 'Wipers', 'Belts', 'Sensors', 'Gaskets & seals', 'Consumables', 'Accessories', 'Other'];
  const mvLabel = (x) => t('mv_' + x);

  const partFields = (row = {}) => [
    { name: 'part_no' }, { name: 'oem_no', placeholder: '11 42 8 575 211' },
    { name: 'name_en', required: true }, { name: 'name_ar' },
    { name: 'category', list: 'dl-pcat' }, { name: 'brand', placeholder: 'BMW, Mann, Bosch, Mahle...' },
    { name: 'unit', type: 'select', options: [['pcs', G.tl('قطعة', 'pcs')], ['liter', G.tl('لتر', 'liter')], ['set', G.tl('طقم', 'set')], ['kg', G.tl('كجم', 'kg')], ['meter', G.tl('متر', 'meter')]], default: 'pcs', noEmpty: true },
    { name: 'location' },
    ...(row.id ? [] : [{ name: 'qty', label: t('opening_qty'), type: 'number', default: 0 }]),
    { name: 'min_qty', type: 'number', default: 0 },
    ...(G.can(R.SUPP) ? [{ name: 'cost', label: t('cost_price'), type: 'number' }] : []),
    { name: 'price', label: t('sale_price'), type: 'number' },
    ...(G.can(R.SUPP) ? [{ name: 'supplier_id', label: t('supplier'), type: 'lookup', res: 'suppliers', display: row.supplier_name }] : []),
    { name: 'active', type: 'checkbox', default: 1 }, { name: 'notes', type: 'textarea', span: 2 },
  ];
  G.partFields = partFields;
  const catList = `<datalist id="dl-pcat">${PART_CATS.map((c) => `<option value="${c}">`).join('')}</datalist>`;

  const adjustDialog = (p, done) => G.formDialog({
    title: `${t('stock_adjust')} - ${G.tl(p.name_ar, p.name_en)} (${t('in_stock')}: ${G.num(p.qty)})`,
    fields: [{ name: 'type', type: 'segment', options: [['in', '⬆ ' + t('stock_in')], ['out', '⬇ ' + t('stock_out')], ['adjust', '⚖ ' + t('stock_count')]], default: 'in', span: 2 },
      { name: 'qty', type: 'number', required: true }, { name: 'unit_cost', type: 'number', default: p.cost }, { name: 'notes', span: 2 }],
    onSubmit: async (d, close) => { await G.post('/api/stock/adjust', { ...d, part_id: p.id }); close(); G.toast(t('saved')); done && done(); },
  });

  G.addRoute('/parts', (view, p, q) => G.listPage(view, {
    title: t('parts'), res: 'parts', canWrite: G.can(R.STORE), csvName: 'inventory', wide: true,
    fields: partFields, top: catList,
    defaultQuery: { low: q.low || '', q: q.q || '' },
    filters: [{ name: 'category', type: 'select', options: PART_CATS.map((c) => [c, c]) }, { name: 'low', label: t('low_only'), type: 'checkbox' }],
    after: (v) => { if (q.q) v.querySelector('[data-q]').value = q.q; if (q.low) { const c = v.querySelector('[name=low]'); if (c) c.checked = true; } },
    rowCls: (r) => (r.qty <= r.min_qty ? 'row-warn' : ''),
    columns: [
      { key: 'part_no', render: (r) => `<b>${esc(r.part_no || '')}</b>${r.oem_no ? `<br><small>${esc(r.oem_no)}</small>` : ''}` },
      { key: 'name', label: t('name'), render: (r) => `${esc(G.tl(r.name_ar, r.name_en))}${r.brand ? ` <small class="muted">${esc(r.brand)}</small>` : ''}` },
      { key: 'category', hideMobile: true }, { key: 'location', hideMobile: true },
      { key: 'qty', cls: 'num', render: (r) => `<b class="${r.qty <= r.min_qty ? 'neg' : ''}">${G.num(r.qty)}</b> <small>${esc(r.unit || '')}</small>` },
      { key: 'min_qty', cls: 'num', hideMobile: true },
      ...(G.can(R.SUPP) ? [{ key: 'cost', cls: 'num', hideMobile: true, render: (r) => G.num(r.cost) }] : []),
      { key: 'price', cls: 'num', render: (r) => G.num(r.price) },
      ...(G.can(R.SUPP) ? [{ key: 'stock_value', cls: 'num', hideMobile: true, render: (r) => G.num(r.stock_value) }] : []),
      { key: 'a', label: '', cls: 'actions-col', render: () => `${G.can(R.STORE) ? `<button class="icon-btn" data-adj title="${t('stock_adjust')}">±</button><button class="icon-btn" data-edit>✎</button><button class="icon-btn" data-mv title="${t('stock_moves')}">🔄</button>` : ''}${G.can(R.MGMT) ? '<button class="icon-btn danger" data-delete>🗑</button>' : ''}` },
    ],
    bind: (el, rows, reload) => {
      el.querySelectorAll('[data-adj]').forEach((b) => b.onclick = () => adjustDialog(rows[b.closest('tr').dataset.i], reload));
      el.querySelectorAll('[data-mv]').forEach((b) => b.onclick = () => { location.hash = `#/stock-moves?part_id=${rows[b.closest('tr').dataset.i].id}`; });
    },
  }));

  G.addRoute('/stock-moves', (view, p, q) => G.listPage(view, {
    title: t('stock_moves'), res: 'stock-moves', canWrite: false, csvName: 'stock_moves',
    defaultQuery: { part_id: q.part_id || '' },
    filters: [{ name: 'type', type: 'select', options: G.opt(['in', 'out', 'return', 'adjust'], 'mv_') }, { name: 'from', type: 'date' }, { name: 'to', type: 'date' }],
    columns: [
      { key: 'date', render: (r) => G.fdt(r.date) }, { key: 'part_no' }, { key: 'name', label: t('part'), render: (r) => esc(G.tl(r.name_ar, r.name_en)) },
      { key: 'type', render: (r) => G.badge(r.type, 'mv_') }, { key: 'qty', cls: 'num', render: (r) => `<b class="${r.qty < 0 ? 'neg' : 'pos'}">${G.num(r.qty)}</b>` },
      { key: 'unit_cost', cls: 'num', hideMobile: true, render: (r) => G.num(r.unit_cost) },
      { key: 'ref', label: t('reference'), render: (r) => (r.ref_type === 'work_order' ? `<a href="#/work-orders/${r.ref_id}">WO #${r.ref_id}</a>` : r.ref_type === 'purchase' || r.ref_type === 'purchase_return' ? `<a href="#/purchases/${r.ref_id}">${esc(r.ref_type)} #${r.ref_id}</a>` : r.ref_type === 'invoice' ? `<a href="#/invoices/${r.ref_id}">INV #${r.ref_id}</a>` : esc(r.ref_type || '')) },
      { key: 'notes', hideMobile: true }, { key: 'user_name', label: t('user'), hideMobile: true },
    ],
    csvColumns: [{ key: 'date' }, { key: 'part_no' }, { key: 'name_en' }, { key: 'type', csv: (r) => mvLabel(r.type) }, { key: 'qty' }, { key: 'unit_cost' }, { key: 'ref_type' }, { key: 'ref_id' }, { key: 'notes' }],
  }), R.SUPP);

  // ---------------- suppliers ----------------
  const supplierFields = [{ name: 'name', required: true, span: 2 }, { name: 'contact' }, { name: 'phone', type: 'tel' }, { name: 'email', type: 'email' }, { name: 'tax_no' }, { name: 'address', span: 2 }, { name: 'opening_balance', type: 'number', help: G.tl('موجب = مستحق للمورد', 'positive = we owe the supplier') }, { name: 'notes', type: 'textarea', span: 2 }];
  G.addRoute('/suppliers', (view) => G.listPage(view, {
    title: t('suppliers'), res: 'suppliers', csvName: 'suppliers', fields: supplierFields,
    rowLink: (r) => `#/suppliers/${r.id}`,
    columns: [{ key: 'name', render: (r) => `<b>${esc(r.name)}</b>` }, { key: 'contact' }, { key: 'phone', render: (r) => G.contactBtns(r.phone) || '' }, { key: 'email', hideMobile: true },
      { key: 'balance', label: t('payables'), cls: 'num', render: (r) => `<b class="${r.balance > 0 ? 'neg' : ''}">${G.money(r.balance)}</b>` }, G.rowActions(true, G.can(R.MGMT))].filter(Boolean),
  }), R.SUPP);

  G.addRoute('/suppliers/:id', async (view, p) => {
    const d = await G.get(`/api/suppliers/${p.id}/statement`);
    const s = d.supplier;
    view.innerHTML = `<div class="page-head"><h2>🏭 ${esc(s.name)}</h2><div class="head-actions">${G.contactBtns(s.phone)}
        <a class="btn" href="#/purchases/new?supplier_id=${s.id}">🛒 ${t('new_purchase')}</a>
        ${G.can(R.MONEY) ? `<button class="btn btn-primary" data-pay>💵 ${t('pay_supplier')}</button>` : ''}<button class="btn" data-pr>🖨 ${t('print')}</button></div></div>
      <div class="card info-grid">${G.info(t('contact'), s.contact)}${G.info(t('phone'), s.phone)}${G.info(t('email'), s.email)}${G.info(t('tax_no'), s.tax_no)}${G.info(t('address'), s.address)}
        ${G.info(t('balance'), `<b class="${s.balance > 0 ? 'neg' : ''}">${G.money(s.balance)}</b>`, true)}</div>
      <section class="card" data-st><h3>${t('statement')}</h3>${G.table([{ key: 'date' }, { key: 'type', render: (r) => (r.type === 'purchase' ? t('purchase') : r.type === 'purchase_return' ? t('purchase_return') : t('c_' + r.type)) },
    { key: 'ref', label: t('reference'), render: (r) => (r.ref_id ? `<a href="#/purchases/${r.ref_id}">${esc(r.ref)}</a>` : esc(r.ref)) }, { key: 'notes' },
    { key: 'credit', label: t('credit'), cls: 'num', render: (r) => (r.credit ? G.money(r.credit) : '') }, { key: 'debit', label: t('debit'), cls: 'num', render: (r) => (r.debit ? G.money(r.debit) : '') },
    { key: 'balance', cls: 'num', render: (r) => `<b>${G.money(r.balance)}</b>` }], [{ date: '', type: 'opening', ref: t('opening_balance'), balance: d.opening_balance, credit: 0, debit: 0 }, ...d.rows])}</section>`;
    const pb = view.querySelector('[data-pay]');
    if (pb) pb.onclick = async () => {
      const accounts = await G.loadAccounts(true);
      G.formDialog({
        title: t('pay_supplier'),
        fields: [{ name: 'amount', type: 'number', required: true, default: s.balance > 0 ? s.balance : '' }, { name: 'date', type: 'date', default: G.today() },
          { name: 'account_id', label: t('account'), type: 'select', options: accounts.map((a) => [a.id, `${a.name} (${G.num(a.balance)})`]), noEmpty: true },
          { name: 'method', type: 'select', options: G.opt(['cash', 'card', 'transfer', 'wallet', 'cheque'], 'm_'), noEmpty: true }, { name: 'description', span: 2 }],
        onSubmit: async (dd, close) => { await G.post(`/api/suppliers/${s.id}/payments`, dd); close(); G.toast(t('saved')); G.route(); },
      });
    };
    view.querySelector('[data-pr]').onclick = () => G.print(`<h2 class="doc-title">${t('statement')} - ${esc(s.name)}</h2>${view.querySelector('[data-st]').innerHTML}`);
    G.bindRowLinks(view);
  }, R.SUPP);

  // ---------------- purchases ----------------
  G.addRoute('/purchases', (view) => G.listPage(view, {
    title: t('purchases'), res: 'purchases', csvName: 'purchases',
    onNew: () => { location.hash = '#/purchases/new'; },
    extraButtons: `<a class="btn" href="#/purchases/new?return=1">↩ ${t('purchase_return')}</a>`,
    filters: [{ name: 'status', type: 'select', options: [['unpaid', t('unpaid')], ['partial', t('partial')], ['paid', t('paid_full')]] }, { name: 'from', type: 'date' }, { name: 'to', type: 'date' }],
    rowLink: (r) => `#/purchases/${r.id}`,
    columns: [{ key: 'no', render: (r) => `<b>${esc(r.no)}</b> ${r.is_return ? G.badge('purchase_return') : ''}` }, { key: 'date' }, { key: 'supplier_name', label: t('supplier') }, { key: 'supplier_invoice_no', hideMobile: true },
      { key: 'total', cls: 'num', render: (r) => G.money(r.total) }, { key: 'paid', cls: 'num', render: (r) => G.money(r.paid) }, { key: 'status', render: (r) => G.badge(r.status, r.status === 'paid' ? 'paid_' : '') },
      ...(G.can(R.MGMT) ? [{ key: 'a', label: '', cls: 'actions-col', render: () => `<button class="icon-btn danger" data-delpo title="${t('delete')}">🗑</button>` }] : [])],
    bind: (el, rows, reload) => el.querySelectorAll('[data-delpo]').forEach((b) => b.onclick = () => G.deletePurchase(rows[b.closest('tr').dataset.i], reload)),
  }), R.SUPP);
  G.deletePurchase = async (p, after) => {
    const lines = [`${t('delete')} ${p.no}?`, p.is_return ? t('delete_purchase_return_warn') : t('delete_purchase_warn')];
    if (Number(p.paid) > 0) lines.push(`${t('paid')}: ${G.money(p.paid)} ← ${t('delete_purchase_paid')}`);
    if (!(await G.confirm(lines.join('\n')))) return;
    try { await G.del(`/api/purchases/${p.id}`); G.toast(t('deleted')); after(); } catch (e) { G.fail(e); }
  };

  // one form for: new purchase, purchase return (optionally from an existing invoice) and editing an invoice
  const purchaseForm = async (view, { isReturn, supplier, from, edit }) => {
    const accounts = !edit && G.can(R.MONEY) ? await G.loadAccounts(true).catch(() => []) : [];
    const srcInv = edit || from;
    const items = srcInv ? srcInv.items.map((i) => ({ part_id: i.part_id, label: `${i.part_no || ''} ${G.tl(i.name_ar, i.name_en)}`.trim(), qty: Number(i.qty), unit_cost: Number(i.unit_cost), price: Number(i.price) || Number(i.part_price) || 0, max: from ? Number(i.qty) : null })) : [];
    const title = edit ? `${t('edit')} ${edit.no}` : from ? `${t('purchase_return')} - ${from.no}` : isReturn ? t('purchase_return') : t('new_purchase');
    const v = edit || {};
    const draft = G.draft(edit ? `purchase_edit_${edit.id}` : from ? `purchase_return_${from.id}` : isReturn ? 'purchase_return' : 'purchase_new');
    view.innerHTML = `<div class="page-head"><h2>🛒 ${esc(title)}</h2></div>
      <div data-draftbar></div>
      ${edit ? `<p class="alert">${t('purchase_edit_help')}</p>` : from ? `<p class="alert">${t('return_from_help')}</p>` : ''}
      <form class="card" novalidate>
        <div class="form-grid">
          <div class="field"><label>${t('supplier')} <b class="req">*</b></label>${edit || from ? `<input type="text" readonly value="${esc(supplier.name)}"><input type="hidden" name="supplier_id" value="${esc(supplier.id)}">`
    : `<div class="row-flex">${G.lookupHtml({ name: 'supplier_id', res: 'suppliers', required: true, display: supplier ? supplier.name : '' }, supplier ? supplier.id : '', 'sup')}<button type="button" class="btn" data-newsup>＋</button></div>`}</div>
          ${G.field({ name: 'supplier_invoice_no' }, v.supplier_invoice_no)}${G.field({ name: 'date', type: 'date' }, v.date || G.today())}${G.field({ name: 'notes' }, from ? `${t('purchase_return')} ${from.no}` : v.notes)}
        </div>
        <h3 class="mt">${t('items')}</h3>
        ${from ? '' : `<div class="add-line form-grid">
          <div class="field span-2"><label>${isReturn ? t('part') : t('part_or_new')}</label><div class="row-flex">${G.lookupHtml({ name: 'l_part', res: 'parts' }, '', 'lp')}<button type="button" class="btn" data-newpart title="${t('new_part')}">＋</button></div>
            <small class="help" data-newhint hidden>🆕 ${t('new_part_line')}</small></div>
          ${isReturn ? '' : `<div data-newcode hidden>${G.field({ name: 'l_newcode', label: t('new_part_code') })}</div>`}
          ${G.field({ name: 'l_qty', label: t('qty'), type: 'number' }, 1)}${G.field({ name: 'l_cost', label: t('unit_cost'), type: 'number' })}
          ${isReturn ? '' : G.field({ name: 'l_price', label: t('sale_price'), type: 'number' })}
          <div class="field"><label>&nbsp;</label><button type="button" class="btn btn-primary" data-addline>＋ ${t('add_item')}</button></div>
        </div>`}
        <div data-lines></div>
        <div class="form-grid mt">${G.field({ name: 'discount', type: 'number' }, v.discount || 0)}${G.field({ name: 'tax', label: t('vat'), type: 'number' }, v.tax || 0)}
          ${accounts.length ? `${G.field({ name: 'pay_amount', label: isReturn ? t('refund_now') : t('pay_now'), type: 'number' })}${G.field({ name: 'account_id', label: t('account'), type: 'select', options: accounts.map((a) => [a.id, `${a.name} (${G.num(a.balance)})`]), noEmpty: true })}` : ''}</div>
        <div class="totals" data-totals></div>
        <div class="form-actions"><a class="btn" href="${edit ? '#/purchases/' + edit.id : from ? '#/purchases/' + from.id : '#/purchases'}">${t('cancel')}</a><button class="btn btn-primary btn-lg" type="submit">💾 ${t('save')}</button></div>
      </form>${catList}`;
    const form = view.querySelector('form');
    G.bindLookups(form);
    let picked = null;
    const partBox = form.querySelector('.lookup[data-res=parts]');
    const setPicked = (pt) => {
      picked = pt;
      partBox.querySelector('input[type=hidden]').value = pt.id;
      partBox.querySelector('input[type=search]').value = `${pt.part_no || ''} ${G.tl(pt.name_ar, pt.name_en)}`;
      form.querySelector('[name=l_cost]').value = pt.cost || '';
      const lp = form.querySelector('[name=l_price]'); if (lp) lp.value = pt.price || '';
    };
    if (partBox) partBox.addEventListener('pick', (e) => setPicked(e.detail));
    const np = view.querySelector('[data-newpart]');
    if (np) np.onclick = () => G.formDialog({
      title: t('new_part'), wide: true, fields: partFields({}).filter((f) => f.name !== 'qty'),
      onSubmit: async (d, close) => { const pt = await G.post('/api/parts', d); close(); setPicked(pt); },
    });
    const ns = view.querySelector('[data-newsup]');
    if (ns) ns.onclick = () => G.formDialog({
      title: t('supplier'), fields: supplierFields,
      onSubmit: async (d, close) => { const sp = await G.post('/api/suppliers', d); close(); const b = form.querySelector('.lookup[data-res=suppliers]'); b.querySelector('input[type=hidden]').value = sp.id; b.querySelector('input[type=search]').value = sp.name; },
    });
    const calc = () => {
      const sub = items.reduce((sm, i) => sm + i.qty * i.unit_cost, 0);
      const total = sub - (Number(form.querySelector('[name=discount]').value) || 0) + (Number(form.querySelector('[name=tax]').value) || 0);
      view.querySelector('[data-totals]').innerHTML = `<div class="trow"><span>${t('subtotal')}</span><b>${G.money(sub)}</b></div><div class="trow big"><span>${t('total')}</span><b>${G.money(total)}</b></div>`;
      view.querySelectorAll('[data-amt]').forEach((el) => { const i = items[el.dataset.amt]; if (i) el.textContent = G.money(i.qty * i.unit_cost); });
    };
    // lines are editable in place: quantity, cost and sale price
    const inp = (i, f) => `<input type="number" step="any" inputmode="decimal" class="line-in" data-li="${i}" data-f="${f}" value="${esc(items[i][f])}" ${f === 'qty' && items[i].max ? `max="${items[i].max}"` : ''}>`;
    const renderLines = () => {
      view.querySelector('[data-lines]').innerHTML = G.table([
        { key: 'label', label: t('part'), render: (i) => `${esc(i.label)}${i.part_id ? '' : ` <span class="badge b-new">🆕 ${t('new')}</span>`}` },
        { key: 'qty', cls: 'num', render: (i) => inp(items.indexOf(i), 'qty') + (i.max ? `<br><small class="muted">${t('max_qty')}: ${G.num(i.max)}</small>` : '') },
        { key: 'unit_cost', cls: 'num', render: (i) => inp(items.indexOf(i), 'unit_cost') },
        ...(isReturn ? [] : [{ key: 'price', label: t('sale_price'), cls: 'num', render: (i) => inp(items.indexOf(i), 'price') }]),
        { key: 'amount', cls: 'num', render: (i) => `<span data-amt="${items.indexOf(i)}">${G.money(i.qty * i.unit_cost)}</span>` },
        { key: 'x', label: '', render: () => '<button type="button" class="icon-btn danger" data-rm>🗑</button>' }], items);
      view.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { items.splice(Number(b.closest('tr').dataset.i), 1); renderLines(); });
      view.querySelectorAll('.line-in').forEach((el) => el.oninput = () => { items[el.dataset.li][el.dataset.f] = Number(el.value) || 0; calc(); });
      calc();
    };
    form.querySelectorAll('[name=discount],[name=tax]').forEach((i) => i.oninput = calc);
    const al = view.querySelector('[data-addline]');
    if (al) al.onclick = () => {
      const typed = partBox.querySelector('input[type=search]').value.trim();
      const isPicked = picked && partBox.querySelector('input[type=hidden]').value;
      // not in stock yet: the typed name becomes a new part when the invoice is saved (purchases only)
      if (!isPicked && (!typed || isReturn)) { G.toast(t('err_required') + ': ' + t('part'), 'err'); return; }
      const qty = Number(form.querySelector('[name=l_qty]').value) || 0;
      if (qty <= 0) { G.toast(t('err_invalid_qty'), 'err'); return; }
      const lp = form.querySelector('[name=l_price]');
      const lc = form.querySelector('[name=l_newcode]');
      const line = { qty, unit_cost: Number(form.querySelector('[name=l_cost]').value) || 0, price: lp ? Number(lp.value) || 0 : 0 };
      if (isPicked) items.push({ ...line, part_id: picked.id, label: `${picked.part_no || ''} ${G.tl(picked.name_ar, picked.name_en)}` });
      else items.push({ ...line, part_id: null, new_name: typed, new_part_no: lc ? lc.value.trim() : '', label: `${lc && lc.value.trim() ? lc.value.trim() + ' ' : ''}${typed}` });
      if (lc) lc.value = '';
      picked = null; partBox.querySelector('input[type=hidden]').value = ''; partBox.querySelector('input[type=search]').value = ''; syncNew();
      form.querySelector('[name=l_qty]').value = 1; form.querySelector('[name=l_cost]').value = ''; if (lp) lp.value = '';
      renderLines();
    };
    // typing a name that is not picked from the list = a new part
    const nh = view.querySelector('[data-newhint]'); const nc = view.querySelector('[data-newcode]');
    function syncNew() {
      if (!partBox || isReturn) return;
      const isNew = partBox.querySelector('input[type=search]').value.trim() && !partBox.querySelector('input[type=hidden]').value;
      if (nh) nh.hidden = !isNew; if (nc) nc.hidden = !isNew;
    }
    if (partBox) { partBox.querySelector('input[type=search]').addEventListener('input', syncNew); partBox.addEventListener('pick', syncNew); }
    // ---- draft: kept on this device until saved
    let dTimer;
    const saveDraft = () => { clearTimeout(dTimer); dTimer = setTimeout(() => draft.save({ form: G.formState(form), items }), 250); };
    const saved = draft.load();
    if (saved) {
      G.restoreForm(form, saved.data.form);
      items.splice(0, items.length, ...(saved.data.items || []));
      G.draftBanner(view.querySelector('[data-draftbar]'), saved.at, () => { draft.clear(); G.route(); });
    }
    form.addEventListener('input', saveDraft); form.addEventListener('change', saveDraft); form.addEventListener('pick', saveDraft);
    if (al) al.addEventListener('click', saveDraft);
    view.querySelector('[data-lines]').addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) setTimeout(saveDraft, 0); });
    renderLines();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const d = G.readForm(form);
      if (!d.supplier_id) { G.toast(t('err_required') + ': ' + t('supplier'), 'err'); return; }
      const lines = items.filter((i) => i.qty > 0);
      if (!lines.length) { G.toast(t('err_purchase_empty'), 'err'); return; }
      const over = lines.find((i) => i.max && i.qty > i.max);
      if (over) { G.toast(`${t('err_return_qty')}: ${over.label} (${t('max_qty')} ${over.max})`, 'err'); return; }
      const body = { supplier_id: d.supplier_id, supplier_invoice_no: d.supplier_invoice_no, date: d.date, notes: d.notes, discount: d.discount, tax: d.tax, is_return: isReturn ? 1 : 0, items: lines };
      if (Number(d.pay_amount) > 0) body.payment = { amount: d.pay_amount, account_id: d.account_id };
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const r = edit ? await G.put(`/api/purchases/${edit.id}`, body) : await G.post('/api/purchases', body);
        clearTimeout(dTimer); draft.clear();
        G.toast(t('saved')); location.hash = `#/purchases/${r.id}`;
      } catch (err) { G.fail(err); btn.disabled = false; }
    };
  };

  G.addRoute('/purchases/new', async (view, p, q) => {
    let from = null; let supplier = null;
    if (q.from) { from = await G.get(`/api/purchases/${q.from}/full`); supplier = { id: from.supplier_id, name: from.supplier_name }; }
    else if (q.supplier_id) supplier = await G.get(`/api/suppliers/${q.supplier_id}`).catch(() => null);
    await purchaseForm(view, { isReturn: q.return === '1' || !!from, supplier, from });
  }, R.SUPP);
  G.addRoute('/purchases/:id/edit', async (view, p) => {
    const edit = await G.get(`/api/purchases/${p.id}/full`);
    await purchaseForm(view, { isReturn: !!edit.is_return, supplier: { id: edit.supplier_id, name: edit.supplier_name }, edit });
  }, R.MONEY);

  G.addRoute('/purchases/:id', async (view, p) => {
    const d = await G.get(`/api/purchases/${p.id}/full`);
    const due = Math.round((d.total - d.paid) * 100) / 100;
    view.innerHTML = `<div class="page-head"><h2>🛒 ${esc(d.no)} ${d.is_return ? G.badge('purchase_return') : ''} ${G.badge(d.status, d.status === 'paid' ? 'paid_' : '')}</h2><div class="head-actions">
        ${due > 0 && G.can(R.MONEY) ? `<button class="btn btn-primary" data-pay>💵 ${d.is_return ? t('refund') : t('pay_supplier')}</button>` : ''}
        ${G.can(R.MONEY) ? `<a class="btn" href="#/purchases/${d.id}/edit">✎ ${t('edit')}</a>` : ''}
        ${!d.is_return && G.can(R.SUPP) ? `<a class="btn" href="#/purchases/new?from=${d.id}">↩ ${t('return_from_invoice')}</a>` : ''}
        ${G.can(R.MGMT) ? `<button class="btn btn-danger" data-del>🗑 ${t('delete')}</button>` : ''}</div></div>
      <div class="card info-grid">${G.info(t('supplier'), `<a href="#/suppliers/${d.supplier_id}">${esc(d.supplier_name)}</a>`, true)}${G.info(t('supplier_invoice_no'), d.supplier_invoice_no)}${G.info(t('date'), d.date)}${G.info(t('notes'), d.notes)}</div>
      <section class="card"><h3>${t('items')}</h3>${G.table([{ key: 'part_no' }, { key: 'name', label: t('part'), render: (i) => esc(G.tl(i.name_ar, i.name_en)) }, { key: 'qty', cls: 'num' }, { key: 'unit_cost', cls: 'num', render: (i) => G.num(i.unit_cost) }, { key: 'amount', cls: 'num', render: (i) => G.money(i.amount) }], d.items)}</section>
      <div class="grid-2"><section class="card"><h3>${t('payments')}</h3>${G.table([{ key: 'date' }, { key: 'account_name', label: t('account') }, { key: 'amount', cls: 'num', render: (x) => G.money(x.amount) }], d.payments)}</section>
      <section class="card totals"><div class="trow"><span>${t('subtotal')}</span><b>${G.money(d.subtotal)}</b></div><div class="trow"><span>${t('discount')}</span><b>${G.money(d.discount)}</b></div><div class="trow"><span>${t('vat')}</span><b>${G.money(d.tax)}</b></div>
        <div class="trow big"><span>${t('total')}</span><b>${G.money(d.total)}</b></div><div class="trow"><span>${t('paid')}</span><b>${G.money(d.paid)}</b></div><div class="trow big"><span>${t('due')}</span><b class="${due > 0 ? 'neg' : ''}">${G.money(due)}</b></div></section></div>`;
    const pb = view.querySelector('[data-pay]');
    if (pb) pb.onclick = async () => {
      const accounts = await G.loadAccounts(true);
      G.formDialog({
        title: t('add_payment'), fields: [{ name: 'amount', type: 'number', required: true, default: due }, { name: 'date', type: 'date', default: G.today() }, { name: 'account_id', label: t('account'), type: 'select', options: accounts.map((a) => [a.id, `${a.name} (${G.num(a.balance)})`]), noEmpty: true }, { name: 'method', type: 'select', options: G.opt(['cash', 'card', 'transfer', 'wallet', 'cheque'], 'm_'), noEmpty: true }],
        onSubmit: async (dd, close) => { await G.post(`/api/purchases/${d.id}/payments`, dd); close(); G.toast(t('saved')); G.route(); },
      });
    };
    const db = view.querySelector('[data-del]');
    if (db) db.onclick = () => G.deletePurchase(d, () => { location.hash = '#/purchases'; });
  }, R.SUPP);
})();
