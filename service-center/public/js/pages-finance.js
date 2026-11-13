/* Finance: invoices, cash, reports, bonuses */
(function () {
  const { t, esc, R } = G;
  const METHODS = ['cash', 'card', 'transfer', 'wallet', 'cheque'];
  const EXPENSE_CATS = ['rent', 'utilities', 'salary', 'bonus', 'tools', 'consumables', 'maintenance', 'marketing', 'government', 'transport', 'hospitality', 'towing', 'subcontract', 'owner_withdrawal', 'other_expense'];
  const INCOME_CATS = ['other_income', 'owner_deposit'];
  const invStatus = (s) => G.badge(s, s === 'paid' ? 'paid_' : s === 'cancelled' ? 'st_' : '');
  const both = (k) => `${window.I18N[k] ? window.I18N[k][0] + ' / ' + window.I18N[k][1] : k}`;

  // ---------------- invoices ----------------
  // permanent delete with a clear warning about what is reversed
  G.deleteInvoice = async (inv, after) => {
    const lines = [`${t('delete_invoice')} ${inv.no}?`, t('delete_invoice_warn')];
    if (Number(inv.paid) > 0) lines.push(`${t('paid')}: ${G.money(inv.paid)} ← ${t('delete_invoice_paid')}`);
    if (!(await G.confirm(lines.join('\n')))) return;
    try { await G.del(`/api/invoices/${inv.id}`); G.toast(t('deleted')); after(); } catch (e) { G.fail(e); }
  };
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
      ...(G.can(R.MGMT) ? [{ key: 'a', label: '', cls: 'actions-col', render: () => `<button class="icon-btn danger" data-delinv title="${t('delete_invoice')}">🗑</button>` }] : []),
    ],
    bind: (el, rows, reload) => el.querySelectorAll('[data-delinv]').forEach((b) => b.onclick = () => G.deleteInvoice(rows[b.closest('tr').dataset.i], reload)),
    foot: (rows) => `<tr><td colspan="5" class="hide-m"></td><td class="num" data-label="${t('total')}"><b>${G.money(rows.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + r.total, 0))}</b></td><td class="hide-m"></td><td class="num" data-label="${t('due')}"><b>${G.money(rows.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + r.due, 0))}</b></td><td></td></tr>`,
  }), R.BILL);

  // quick invoice: labor + parts + anything else, no work order needed; the customer and car are optional and
  // are registered automatically from what is typed (nothing typed = the shared cash customer)
  // edit = an existing invoice to change (its lines, customer, car...); otherwise a new quick invoice
  const quickInvoiceForm = async (view, edit) => {
    const [accounts0, sts] = await Promise.all([G.loadAccounts().catch(() => []), G.loadServiceTypes().catch(() => []), G.loadEmployees()]);
    const accounts = edit ? [] : accounts0; // payments of an existing invoice are added from its page
    const items = [];
    const techs = () => G.empOptions();
    const draft = G.draft(edit ? `invoice_edit_${edit.id}` : 'quick_invoice');
    let pickedCust = null;
    view.innerHTML = `<div class="page-head"><h2>🧾 ${edit ? `${t('edit_invoice')} ${esc(edit.no)}` : t('quick_invoice')}</h2></div>
      <div data-draftbar></div>
      <form novalidate>
        <section class="card"><h3>👤 ${t('customer')} <small class="muted">(${t('optional')})</small></h3>
          <div class="form-grid">
            ${G.field({ name: 'customer_id', label: t('existing_customer'), type: 'lookup', res: 'customers', span: 2, placeholder: t('search_customer') })}
            <div class="span-2 qi-new" data-newcust><div class="form-grid">
              ${G.field({ name: 'c_name', label: t('name') })}${G.field({ name: 'c_phone', label: t('phone'), type: 'tel' })}
            </div></div>
            <div class="span-2 qi-picked" data-picked hidden></div>
          </div>
          <small class="help">${t('quick_customer_help')}</small>
        </section>
        <section class="card"><h3>🚗 ${t('vehicle')} <small class="muted">(${t('optional')})</small></h3>
          <div class="form-grid">
            ${G.field({ name: 'vehicle_id', label: t('existing_vehicle'), type: 'lookup', res: 'vehicles', span: 2 })}
            <div class="span-2" data-newveh><div class="form-grid">
              ${G.field({ name: 'v_plate', label: t('plate') })}${G.field({ name: 'v_model', label: t('model'), placeholder: '320i, X5...' })}
            </div></div>
            ${G.field({ name: 'v_mileage', label: t('mileage'), type: 'number' })}
          </div>
        </section>
        <section class="card"><h3>🧾 ${t('items')}</h3>
          ${G.field({ name: 'l_kind', label: '', type: 'segment', options: [['labor', '🛠 ' + t('k_labor')], ['part', '📦 ' + t('k_part')], ['other', '➕ ' + t('k_other')]] }, 'labor')}
          <div class="add-line form-grid mt">
            <div data-k="labor">${G.field({ name: 'l_service', label: t('service_type'), type: 'select', options: sts.map((x) => [x.id, `${x.code ? x.code + ' - ' : ''}${G.tl(x.name_ar, x.name_en)} (${G.num(x.labor_price)})`]) })}</div>
            <div data-k="part" class="span-2" hidden>${G.field({ name: 'l_part', label: t('part'), type: 'lookup', res: 'parts' })}</div>
            <div data-k="labor other">${G.field({ name: 'l_desc', label: t('description') })}</div>
            <div data-k="labor">${G.field({ name: 'l_tech', label: t('technician'), type: 'select', options: techs() })}</div>
            ${G.field({ name: 'l_qty', label: t('qty'), type: 'number' }, 1)}${G.field({ name: 'l_price', label: t('price'), type: 'number' })}
            <div class="field"><label>&nbsp;</label><button type="button" class="btn btn-primary" data-addline>＋ ${t('add_item')}</button></div>
          </div>
          <div data-lines></div>
        </section>
        <section class="card">
          <div class="form-grid">${G.field({ name: 'discount', type: 'number' }, 0)}${G.field({ name: 'tax_rate', type: 'number' }, G.settings.vat_rate)}
            ${G.field({ name: 'date', type: 'date' }, G.today())}${G.field({ name: 'notes' })}</div>
          <div class="totals mt" data-totals></div>
          ${accounts.length ? `<h4 class="sec-title">💵 ${t('pay_now')}</h4><div class="form-grid">
            <div class="field"><label>${t('amount')}</label><div class="row-flex"><input type="number" step="any" inputmode="decimal" name="pay_amount" style="flex:1"><button type="button" class="btn" data-full>${t('pay_full')}</button></div></div>
            ${G.field({ name: 'account_id', label: t('account'), type: 'select', options: accounts.map((a) => [a.id, a.name]), noEmpty: true })}
            ${G.field({ name: 'method', type: 'select', options: G.opt(METHODS, 'm_'), noEmpty: true }, 'cash')}</div>` : ''}
        </section>
        <div class="form-actions"><a class="btn" href="${edit ? '#/invoices/' + edit.id : '#/invoices'}">${t('cancel')}</a>
          <button class="btn btn-lg" type="button" data-saveprint>🖨 ${t('save_print')}</button>
          <button class="btn btn-primary btn-lg" type="submit">💾 ${t('save')}</button></div>
      </form>`;
    const form = view.querySelector('form');
    G.bindLookups(form);
    const val = (n) => form.querySelector(`[name=${n}]`);
    // customer: pick one, or type a new one
    const custBox = form.querySelector('.lookup[data-res=customers]');
    const vehBox = form.querySelector('.lookup[data-res=vehicles]');
    custBox.addEventListener('pick', (e) => {
      const c = e.detail;
      pickedCust = { id: c.id, name: c.name, phone: c.phone };
      form.querySelector('[data-newcust]').hidden = true;
      const pk = form.querySelector('[data-picked]');
      pk.hidden = false;
      pk.innerHTML = `<b>${esc(c.name)}</b> ${esc(c.phone || '')} <button type="button" class="btn btn-sm btn-ghost" data-unpick>✕ ${t('other_customer')}</button>`;
      pk.querySelector('[data-unpick]').onclick = () => {
        custBox.querySelector('input[type=hidden]').value = ''; custBox.querySelector('input[type=search]').value = '';
        pk.hidden = true; form.querySelector('[data-newcust]').hidden = false; delete vehBox.dataset.filter; pickedCust = null; saveDraft();
      };
      vehBox.dataset.filter = `customer_id=${c.id}`;
    });
    vehBox.addEventListener('pick', (e) => {
      const v = e.detail;
      form.querySelector('[data-newveh]').hidden = true;
      if (!custBox.querySelector('input[type=hidden]').value) {
        custBox.querySelector('input[type=hidden]').value = v.customer_id;
        custBox.querySelector('input[type=search]').value = v.customer_name || '';
        custBox.dispatchEvent(new CustomEvent('pick', { detail: { id: v.customer_id, name: v.customer_name, phone: v.customer_phone } }));
      }
    });
    vehBox.querySelector('input[type=search]').addEventListener('input', () => { form.querySelector('[data-newveh]').hidden = false; });
    // the line being added
    const kind = () => form.querySelector('[name=l_kind]:checked').value;
    const syncKind = () => form.querySelectorAll('[data-k]').forEach((el) => { el.hidden = !el.dataset.k.split(' ').includes(kind()); });
    form.querySelectorAll('[name=l_kind]').forEach((r) => r.onchange = syncKind);
    syncKind();
    let picked = null;
    form.querySelector('.lookup[data-res=parts]').addEventListener('pick', (e) => { picked = e.detail; val('l_price').value = e.detail.price || ''; });
    val('l_service').onchange = () => {
      const st = sts.find((x) => String(x.id) === val('l_service').value);
      if (st) { val('l_price').value = st.labor_price; if (!val('l_desc').value) val('l_desc').placeholder = G.tl(st.name_ar, st.name_en); }
    };
    const total = () => {
      const sub = items.reduce((sm, i) => sm + i.qty * i.unit_price, 0);
      const disc = Number(val('discount').value) || 0; const rate = Number(val('tax_rate').value) || 0;
      return { sub, tax: Math.round((sub - disc) * rate) / 100, total: Math.round((sub - disc) * (1 + rate / 100) * 100) / 100 };
    };
    const calc = () => {
      const x = total();
      view.querySelector('[data-totals]').innerHTML = `<div class="trow"><span>${t('subtotal')}</span><b>${G.money(x.sub)}</b></div><div class="trow"><span>${t('vat')}</span><b>${G.money(x.tax)}</b></div><div class="trow big"><span>${t('total')}</span><b>${G.money(x.total)}</b></div>`;
      view.querySelectorAll('[data-amt]').forEach((el) => { const i = items[el.dataset.amt]; if (i) el.textContent = G.money(i.qty * i.unit_price); });
    };
    const inp = (i, f, type = 'number') => `<input type="${type}" ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} class="line-in ${type === 'text' ? 'wide' : ''}" data-li="${i}" data-f="${f}" value="${esc(items[i][f] ?? '')}">`;
    const renderLines = () => {
      view.querySelector('[data-lines]').innerHTML = G.table([
        { key: 'kind', render: (i) => G.badge(i.kind === 'labor' ? 'k_labor' : i.kind === 'part' ? 'k_part' : 'k_other', '') },
        { key: 'description', render: (i) => (i.part_id ? esc(i.description) : inp(items.indexOf(i), 'description', 'text')) },
        { key: 'technician_id', label: t('technician'), render: (i) => (i.kind === 'labor' ? `<select class="line-in wide" data-li="${items.indexOf(i)}" data-f="technician_id"><option value="">-</option>${techs().map(([id, nm]) => `<option value="${id}" ${String(id) === String(i.technician_id) ? 'selected' : ''}>${esc(nm)}</option>`).join('')}</select>` : '') },
        { key: 'qty', cls: 'num', render: (i) => inp(items.indexOf(i), 'qty') },
        { key: 'unit_price', cls: 'num', render: (i) => inp(items.indexOf(i), 'unit_price') },
        { key: 'amount', cls: 'num', render: (i) => `<span data-amt="${items.indexOf(i)}">${G.money(i.qty * i.unit_price)}</span>` },
        { key: 'x', label: '', render: () => '<button type="button" class="icon-btn danger" data-rm>🗑</button>' }], items);
      view.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { items.splice(Number(b.closest('tr').dataset.i), 1); renderLines(); });
      view.querySelectorAll('[data-li]').forEach((el) => {
        el.oninput = el.onchange = () => { const it = items[el.dataset.li]; const f = el.dataset.f; it[f] = ['qty', 'unit_price'].includes(f) ? Number(el.value) || 0 : el.value; calc(); };
      });
      calc();
    };
    form.querySelectorAll('[name=discount],[name=tax_rate]').forEach((i) => i.oninput = calc);
    view.querySelector('[data-addline]').onclick = () => {
      const k = kind(); const qty = Number(val('l_qty').value) || 1; const price = Number(val('l_price').value) || 0;
      const desc = val('l_desc').value.trim();
      if (k === 'part') {
        if (!picked || !val('l_part').value) { G.toast(t('err_required') + ': ' + t('part'), 'err'); return; }
        items.push({ kind: 'part', part_id: picked.id, description: `${picked.part_no || ''} ${G.tl(picked.name_ar, picked.name_en)}`.trim(), qty, unit_price: price });
        form.querySelector('.lookup[data-res=parts] input[type=search]').value = ''; val('l_part').value = ''; picked = null;
      } else if (k === 'labor') {
        const st = sts.find((x) => String(x.id) === val('l_service').value);
        if (!st && !desc) { G.toast(t('err_required') + ': ' + t('description'), 'err'); return; }
        items.push({ kind: 'labor', service_type_id: st ? st.id : null, description: desc || (st ? G.tl(st.name_ar, st.name_en) : ''), technician_id: val('l_tech').value || null, qty, unit_price: price });
        val('l_service').value = ''; val('l_desc').placeholder = '';
      } else {
        if (!desc) { G.toast(t('err_required') + ': ' + t('description'), 'err'); return; }
        items.push({ kind: 'other', description: desc, qty, unit_price: price });
      }
      val('l_desc').value = ''; val('l_price').value = ''; val('l_qty').value = 1;
      renderLines();
    };
    const fb = view.querySelector('[data-full]');
    if (fb) fb.onclick = () => { val('pay_amount').value = total().total; };
    // ---- draft: everything typed is kept on this device until the invoice is saved
    let dTimer;
    function saveDraft() { clearTimeout(dTimer); dTimer = setTimeout(() => draft.save({ form: G.formState(form), items, cust: pickedCust }), 250); }
    const pickCust = (c) => {
      custBox.querySelector('input[type=hidden]').value = c.id; custBox.querySelector('input[type=search]').value = c.name || '';
      custBox.dispatchEvent(new CustomEvent('pick', { detail: c }));
    };
    const showVeh = (hasVeh) => { form.querySelector('[data-newveh]').hidden = hasVeh; };
    const saved = draft.load();
    if (saved) {
      G.restoreForm(form, saved.data.form);
      items.push(...(saved.data.items || []));
      if (saved.data.cust) pickCust(saved.data.cust);
      if (saved.data.form && saved.data.form.vehicle_id) showVeh(true);
      G.draftBanner(view.querySelector('[data-draftbar]'), saved.at, () => { draft.clear(); G.route(); });
    } else if (edit) {
      pickCust({ id: edit.customer_id, name: edit.customer.name, phone: edit.customer.phone });
      if (edit.vehicle) {
        vehBox.querySelector('input[type=hidden]').value = edit.vehicle.id;
        vehBox.querySelector('input[type=search]').value = G.vehLabel(edit.vehicle);
        showVeh(true);
      }
      val('discount').value = edit.discount || 0; val('tax_rate').value = edit.tax_rate; val('date').value = edit.date; val('notes').value = edit.notes || '';
      items.push(...edit.items.map((i) => ({ kind: i.kind, part_id: i.part_id || null, description: i.description || '', technician_id: i.technician_id || null, qty: Number(i.qty), unit_price: Number(i.unit_price) })));
    }
    syncKind();
    form.addEventListener('input', saveDraft); form.addEventListener('change', saveDraft);
    form.addEventListener('pick', saveDraft);
    // adding / removing lines is kept too (typing in a line bubbles up as an input event)
    view.querySelector('[data-addline]').addEventListener('click', saveDraft);
    view.querySelector('[data-lines]').addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) setTimeout(saveDraft, 0); });
    renderLines();
    const save = async (print) => {
      if (!items.length) { G.toast(t('err_invoice_empty'), 'err'); return; }
      const d = G.readForm(form);
      const body = {
        customer_id: d.customer_id || null, customer: { name: d.c_name, phone: d.c_phone },
        vehicle_id: d.vehicle_id || null, vehicle: { plate: d.v_plate, model: d.v_model, mileage: d.v_mileage },
        date: d.date, notes: d.notes, discount: d.discount, tax_rate: d.tax_rate,
        items: items.map((i) => ({ ...i, description: i.description || '' })),
      };
      if (Number(d.pay_amount) > 0) body.payment = { amount: d.pay_amount, account_id: d.account_id, method: d.method };
      view.querySelectorAll('.form-actions .btn').forEach((b) => { b.disabled = true; });
      try {
        const inv = edit ? await G.put(`/api/invoices/${edit.id}/full`, body) : await G.post('/api/invoices', body);
        clearTimeout(dTimer); draft.clear();
        G.toast(t('saved'));
        location.hash = `#/invoices/${inv.id}${print ? '?print=1' : ''}`;
      } catch (err) { G.fail(err); view.querySelectorAll('.form-actions .btn').forEach((b) => { b.disabled = false; }); }
    };
    form.onsubmit = (e) => { e.preventDefault(); save(false); };
    view.querySelector('[data-saveprint]').onclick = () => save(true);
  };
  G.addRoute('/invoices/new', (view) => quickInvoiceForm(view, null), R.BILL);
  G.addRoute('/invoices/:id/edit', async (view, p) => {
    const inv = await G.get(`/api/invoices/${p.id}/full`);
    if (inv.status === 'cancelled') throw new Error(t('err_invoice_cancelled'));
    await quickInvoiceForm(view, inv);
  }, R.MONEY);

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

  G.addRoute('/invoices/:id', async (view, p, q) => {
    let inv = await G.get(`/api/invoices/${p.id}/full`);
    if (q.print === '1') setTimeout(() => G.invoicePrint(inv), 300);
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
          ${inv.status !== 'cancelled' && G.can(R.MONEY) ? `<a class="btn" href="#/invoices/${inv.id}/edit">✎ ${t('edit')}</a>` : ''}
          ${inv.status !== 'cancelled' && G.can(R.MGMT) ? `<button class="btn" data-disc>％ ${t('edit_discount')}</button>` : ''}
          ${inv.status !== 'cancelled' && inv.paid > 0 && G.can(R.MONEY) ? `<button class="btn" data-refund>↩ ${t('refund')}</button>` : ''}
          ${inv.status !== 'cancelled' && inv.paid <= 0 && G.can(R.MGMT) ? `<button class="btn" data-cancel>✖ ${t('cancel_invoice')}</button>` : ''}
          ${G.can(R.MGMT) ? `<button class="btn btn-danger" data-delinv>🗑 ${t('delete_invoice')}</button>` : ''}
        </div></div>
        <div class="card info-grid">
          ${G.info(t('customer'), `<a href="#/customers/${inv.customer_id}">${esc(inv.customer.name)}</a>`, true)}${G.info(t('phone'), inv.customer.phone)}
          ${G.info(t('vehicle'), inv.vehicle ? `<a href="#/vehicles/${inv.vehicle.id}">${esc(G.vehLabel(inv.vehicle))}</a>` : '-', true)}
          ${G.info(t('wo_no'), inv.work_order ? `<a href="#/work-orders/${inv.work_order.id}">${esc(inv.work_order.no)}</a>` : '-', true)}${G.info(t('date'), inv.date)}
        </div>
        <section class="card"><h3>${t('items')}</h3>${G.table([{ key: 'kind', render: (i) => t('k_' + i.kind) }, { key: 'description' }, { key: 'technician_name', label: t('technician'), hideMobile: true },
    { key: 'qty', cls: 'num', render: (i) => G.num(i.qty) }, { key: 'unit_price', cls: 'num', render: (i) => G.num(i.unit_price) }, { key: 'amount', cls: 'num', render: (i) => G.money(i.amount) }], inv.items)}</section>
        <div class="grid-2">
          <section class="card"><h3>${t('payments')}</h3>${G.table([{ key: 'date' }, { key: 'account_name', label: t('account') }, { key: 'method', render: (x) => t('m_' + x.method) }, { key: 'direction', render: (x) => (x.direction === 'out' ? G.badge('refund') : '') }, { key: 'amount', cls: 'num', render: (x) => G.money(x.amount) }, { key: 'user_name', label: t('user'), hideMobile: true }, { key: 'a', label: '', cls: 'actions-col', render: () => txActions() }], inv.payments)}</section>
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
      G.bindTxActions(view, inv.payments, async () => { inv = await G.get(`/api/invoices/${inv.id}/full`); render(); });
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
      const di = view.querySelector('[data-delinv]');
      if (di) di.onclick = () => G.deleteInvoice(inv, () => { location.hash = '#/invoices'; });
      const cb = view.querySelector('[data-cancel]');
      if (cb) cb.onclick = async () => { if (!(await G.confirm(t('cancel_invoice') + '?'))) return; try { inv = await G.post(`/api/invoices/${inv.id}/cancel`); render(); } catch (e) { G.fail(e); } };
    };
    render();
  }, R.BILL);

  // ---------------- fixing cash movements: edit (account, method, date, amount, description) / delete ----------------
  const txActions = (cls = '') => (G.can(R.MONEY) ? `<span class="${cls}"><button type="button" class="icon-btn" data-txe title="${t('edit')}">✎</button><button type="button" class="icon-btn danger" data-txd title="${t('delete')}">🗑</button></span>` : '');
  G.txActions = txActions;
  G.txEditDialog = async (tr, done) => {
    const accounts = await G.loadAccounts(true);
    const salary = tr.category === 'salary';
    G.formDialog({
      title: `✎ ${t('edit_movement')} - ${catLabel(tr.category)}`,
      extra: `<p class="muted">${esc(tr.description || '')}${tr.party_name ? ' · ' + esc(tr.party_name) : ''}</p>${salary ? `<p class="alert">${t('salary_amount_locked_help')}</p>` : ''}`,
      fields: [
        { name: 'account_id', label: t('account'), type: 'select', options: accounts.map((a) => [a.id, a.name]), noEmpty: true },
        { name: 'method', type: 'select', options: G.opt(METHODS, 'm_'), noEmpty: true },
        { name: 'amount', type: 'number', required: true, attrs: salary ? 'readonly' : '' }, { name: 'date', type: 'date' },
        { name: 'description', span: 2 },
      ],
      values: { ...tr, method: tr.method || 'cash' },
      onSubmit: async (d, close) => { await G.put(`/api/transactions/${tr.id}`, d); close(); G.loadAccounts(true).catch(() => {}); G.toast(t('saved')); done && done(); },
    });
  };
  G.txDelete = async (tr, done) => {
    const what = tr.ref_type === 'invoice' ? t('txdel_invoice') : tr.ref_type === 'purchase' ? t('txdel_purchase') : tr.ref_type === 'transfer' ? t('txdel_transfer')
      : tr.ref_type === 'advance' ? t('txdel_advance') : tr.category === 'salary' ? t('txdel_salary') : t('txdel_plain');
    if (!(await G.confirm(`${t('delete')}: ${catLabel(tr.category)} - ${G.money(tr.amount)} (${tr.account_name || ''})?\n${what}`))) return;
    try { await G.del(`/api/transactions/${tr.id}`); G.loadAccounts(true).catch(() => {}); G.toast(t('deleted')); done && done(); } catch (e) { G.fail(e); }
  };
  G.bindTxActions = (root, rows, done) => {
    root.querySelectorAll('[data-txe]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); G.txEditDialog(rows[b.closest('tr').dataset.i], done); });
    root.querySelectorAll('[data-txd]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); G.txDelete(rows[b.closest('tr').dataset.i], done); });
  };

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
      view.querySelectorAll('[data-edit-acc]').forEach((b) => b.onclick = () => accDialog(accs.find((a) => String(a.id) === b.dataset.editAcc)));
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
    const allCats = ['invoice_payment', 'refund', 'supplier_payment', 'supplier_refund', 'transfer', 'advance', ...EXPENSE_CATS, ...INCOME_CATS];
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
            { key: 'a', label: '', cls: 'actions-col', render: () => txActions() },
          ],
          csvColumns: [{ key: 'date' }, { key: 'account_name', label: t('account') }, { key: 'category', csv: (r) => catLabel(r.category) }, { key: 'description' }, { key: 'party_name', label: t('party') }, { key: 'direction' }, { key: 'amount' }],
          foot: (rows) => { const i = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amount, 0); const o = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amount, 0); return `<tr><td colspan="6" class="hide-m"></td><td class="num" data-label="${t('d_in')}"><b class="pos">${G.money(i)}</b></td><td class="num" data-label="${t('d_out')}"><b class="neg">${G.money(o)}</b></td><td colspan="2" data-label="${t('net')}"><b>${G.money(i - o)}</b></td></tr>`; },
          onSaved: () => loadAccounts(),
          bind: (el, rows, reload) => G.bindTxActions(el, rows, () => { reload(); loadAccounts(); }),
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
  // advance (سلفة): money leaves the cash account now and is deducted in the next payroll
  G.advanceDialog = async (employeeId, done) => {
    await G.loadEmployees();
    const accounts = await G.loadAccounts(true);
    G.formDialog({
      title: '💵 ' + t('new_advance'),
      extra: `<p class="muted">${t('advance_help')}</p>`,
      fields: [
        { name: 'employee_id', label: t('employee'), type: 'select', options: G.empOptions(), required: true, span: 2 },
        { name: 'amount', type: 'number', required: true }, { name: 'date', type: 'date', default: G.today() },
        { name: 'account_id', label: t('account'), type: 'select', options: accounts.map((a) => [a.id, `${a.name} (${G.num(a.balance)})`]), noEmpty: true },
        { name: 'method', type: 'select', options: G.opt(METHODS, 'm_'), default: 'cash', noEmpty: true }, { name: 'reason', span: 2 },
      ],
      values: { employee_id: employeeId || '' },
      onSubmit: async (d, close) => { await G.post('/api/advances', d); close(); G.toast(t('saved')); done && done(); },
    });
  };

  G.addRoute('/bonuses', async (view) => {
    await G.loadEmployees(true);
    view.innerHTML = `<div class="page-head"><h2>🎁 ${t('bonuses')}</h2></div><div data-tabs></div>`;
    G.tabs(view.querySelector('[data-tabs]'), [['list', t('bonus') + ' / ' + t('deduction')], ['comm', t('commissions_calc')], ['payroll', t('payroll')]], async (k, body) => {
      if (k === 'list') {
        await G.listPage(body, {
          title: t('bonus') + ' / ' + t('deduction') + ' / ' + t('advances'), res: 'bonuses', csvName: 'bonuses',
          extraButtons: `<button class="btn btn-ok" data-adv>💵 ${t('new_advance')}</button>`,
          after: (v, reload) => { v.querySelector('[data-adv]').onclick = () => G.advanceDialog(null, reload); },
          fields: [{ name: 'employee_id', label: t('employee'), type: 'select', options: G.empOptions(), required: true }, { name: 'type', type: 'select', options: G.opt(['bonus', 'deduction', 'commission']), default: 'bonus', noEmpty: true },
            { name: 'amount', type: 'number', required: true }, { name: 'date', type: 'date', default: G.today() }, { name: 'period', label: t('month'), type: 'month', default: G.today().slice(0, 7) }, { name: 'reason', span: 2 }],
          filters: [{ name: 'employee_id', label: t('employee'), type: 'select', options: G.empOptions() }, { name: 'type', type: 'select', options: G.opt(['bonus', 'deduction', 'commission', 'advance']) },
            { name: 'paid', label: t('is_paid'), type: 'select', options: [['1', t('yes')], ['0', t('no')]] }, { name: 'from', type: 'date' }, { name: 'to', type: 'date' }],
          columns: [{ key: 'date' }, { key: 'employee_name', label: t('employee') }, { key: 'type', render: (r) => G.badge(r.type) }, { key: 'amount', cls: 'num', render: (r) => `<b class="${['deduction', 'advance'].includes(r.type) ? 'neg' : 'pos'}">${G.money(r.amount)}</b>` },
            { key: 'period', label: t('month') }, { key: 'reason' }, { key: 'paid', label: t('is_paid'), render: (r) => (r.paid ? '✔' : r.type === 'advance' ? `<small class="muted">${t('advance_open')}</small>` : '') },
            { key: 'a', label: '', render: (r) => (r.paid ? '' : `${r.type === 'advance' ? '' : '<button class="icon-btn" data-edit>✎</button>'}<button class="icon-btn danger" data-delete>🗑</button>`) }],
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
        body.innerHTML = `<div class="toolbar">
            ${G.field({ name: 'cycle', label: '', type: 'segment', options: [['monthly', t('monthly_payroll')], ['weekly', t('weekly_payroll')]] }, 'monthly')}
            <div data-pmonth>${G.field({ name: 'period', label: t('month'), type: 'month' }, G.today().slice(0, 7))}</div>
            <div data-pweek hidden>${G.field({ name: 'week_day', label: t('week'), type: 'date' }, G.today())}</div>
            <a class="btn" href="#/attendance">🕘 ${t('attendance')}</a></div>
          <div class="count-line" data-plabel></div>
          ${G.settings.attendance_payroll === '1' ? '' : `<p class="alert">${t('attendance_payroll_off')}</p>`}<div class="card" data-out></div>`;
        const periodNow = () => {
          const weekly = body.querySelector('[name=cycle]:checked').value === 'weekly';
          body.querySelector('[data-pmonth]').hidden = weekly; body.querySelector('[data-pweek]').hidden = !weekly;
          return weekly ? GEAR_PAY.weekOf(body.querySelector('[name=week_day]').value || G.today(), G.settings) : body.querySelector('[name=period]').value;
        };
        const load = async () => {
          const period = periodNow();
          body.querySelector('[data-plabel]').textContent = `${t('period')}: ${GEAR_PAY.periodLabel(period)}`;
          const rows = await G.get('/api/payroll?period=' + period);
          const owed = (r) => Math.max(0, r.salary_due - r.salary_paid) > 0.009 || r.bonuses || r.deductions || r.advances;
          body.querySelector('[data-out]').innerHTML = G.table([
            { key: 'name', label: t('employee'), render: (r) => `<b>${esc(r.name)}</b><br><small class="muted">${t('j_' + r.job)} · ${t('pay_' + (r.pay_type || 'monthly'))}</small>` },
            { key: 'salary', cls: 'num', render: (r) => G.money(r.salary) },
            { key: 'att', label: t('attendance'), render: (r) => `<small>${t('present_days')}: <b>${r.present_days}</b> · ${t('absent_days')}: <b class="${r.absent_days + r.unpaid_days ? 'neg' : ''}">${r.absent_days + r.unpaid_days}</b><br>${t('late_minutes')}: ${r.late_minutes + r.early_minutes} · ${t('overtime')}: ${Math.round(r.overtime_minutes / 6) / 10}h</small>` },
            { key: 'salary_due', cls: 'num', render: (r) => `${G.money(r.salary_due)}${r.by_attendance && (r.absence_deduction || r.late_deduction || r.overtime_pay) ? `<br><small class="muted">-${G.num(r.absence_deduction + r.late_deduction)} +${G.num(r.overtime_pay)}</small>` : ''}` },
            { key: 'salary_paid', cls: 'num', render: (r) => G.money(r.salary_paid) }, { key: 'bonuses', label: t('bonus'), cls: 'num', render: (r) => `<span class="pos">${G.money(r.bonuses)}</span>` },
            { key: 'deductions', cls: 'num', render: (r) => `<span class="neg">${G.money(r.deductions)}</span>` },
            { key: 'advances', cls: 'num', render: (r) => (r.advances ? `<span class="neg">${G.money(r.advances)}</span>` : '-') },
            { key: 'net', cls: 'num', render: (r) => `<b class="${r.net < 0 ? 'neg' : ''}">${G.money(r.net)}</b>` },
            { key: 'a', label: '', cls: 'actions-wide', render: (r) => `${owed(r) ? `<button class="btn btn-sm btn-primary" data-pay>💵 ${r.net > 0 ? t('pay') : t('settle')}</button>` : '<span class="badge b-done">✔</span>'}
              <button class="btn btn-sm" data-adv>${t('advance')}</button>` },
          ], rows, { foot: `<tr><td colspan="8" data-label=""></td><td class="num" data-label="${t('net')}"><b>${G.money(rows.reduce((s, r) => s + Math.max(0, r.net), 0))}</b></td><td></td></tr>` });
          body.querySelectorAll('[data-adv]').forEach((b) => b.onclick = () => G.advanceDialog(rows[b.closest('tr').dataset.i].employee_id, load));
          body.querySelectorAll('[data-pay]').forEach((b) => b.onclick = async () => {
            const r = rows[b.closest('tr').dataset.i];
            const accounts = await G.loadAccounts(true);
            const sal = Math.max(0, Math.round((r.salary_due - r.salary_paid) * 100) / 100);
            G.formDialog({
              title: `${r.net > 0 ? t('pay') : t('settle')} - ${r.name}`,
              extra: `<div class="totals mt">
                <div class="trow"><span>${t('salary_due')} (${esc(GEAR_PAY.periodLabel(period))})</span><b>${G.money(sal)}</b></div>
                <div class="trow"><span>${t('bonus')}</span><b class="pos">+ ${G.money(r.bonuses)}</b></div>
                <div class="trow"><span>${t('deductions')}</span><b class="neg">- ${G.money(r.deductions)}</b></div>
                <div class="trow"><span>${t('advances')}</span><b class="neg">- ${G.money(r.advances)}</b></div>
                <div class="trow big"><span>${t('cash_to_pay')}</span><b>${G.money(Math.max(0, r.net))}</b></div>
                ${r.net < 0 ? `<p class="alert">${t('advance_carry')}: ${G.money(-r.net)}</p>` : ''}</div>`,
              fields: [{ name: 'account_id', label: t('account'), type: 'select', options: accounts.map((a) => [a.id, `${a.name} (${G.num(a.balance)})`]), noEmpty: true }],
              onSubmit: async (d, close) => { await G.post('/api/payroll/pay', { employee_id: r.employee_id, account_id: d.account_id, period }); close(); G.toast(t('saved')); load(); },
            });
          });
        };
        body.querySelectorAll('[name=period],[name=week_day],[name=cycle]').forEach((i) => i.onchange = () => load().catch(G.fail));
        await load();
      }
    });
  }, R.MONEY);
})();
