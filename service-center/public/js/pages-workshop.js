/* Workshop: work orders */
(function () {
  const { t, esc, R } = G;
  const STATUSES = ['open', 'in_progress', 'waiting_parts', 'waiting_approval', 'quality_check', 'completed', 'delivered', 'cancelled'];
  const QC = ['test_drive', 'no_leaks', 'no_warnings', 'cbs_reset', 'tyre_pressure', 'fluids', 'clean', 'old_parts'];
  const info = (...a) => G.info(...a);

  G.addRoute('/work-orders', async (view, p, q) => {
    const counts = await G.get('/api/dashboard').then((d) => Object.fromEntries((d.wo_by_status || []).map((x) => [x.status, x.n]))).catch(() => ({}));
    await G.listPage(view, {
      title: t('work_orders'), res: 'work-orders', canWrite: G.can(R.SHOP), csvName: 'work_orders',
      defaultQuery: { status: q.status || '' },
      top: `<div class="status-chips">${STATUSES.slice(0, 6).map((s) => `<button class="chip-btn ${q.status === s ? 'active' : ''}" data-s="${s}">${t('wo_' + s)} <b>${counts[s] || 0}</b></button>`).join('')}</div>`,
      filters: [{ name: 'status', type: 'select', options: G.opt(STATUSES, 'wo_') }, { name: 'priority', type: 'select', options: G.opt(['normal', 'high', 'urgent']) }, { name: 'from', type: 'date' }, { name: 'to', type: 'date' }],
      onNew: () => G.formDialog({
        title: t('work_order'),
        fields: [{ name: 'vehicle_id', label: t('vehicle'), type: 'lookup', res: 'vehicles', required: true, span: 2 }, { name: 'mileage', type: 'number' },
          { name: 'priority', type: 'select', options: G.opt(['normal', 'high', 'urgent']), default: 'normal', noEmpty: true },
          { name: 'advisor_id', label: t('advisor'), type: 'select', options: G.empOptions() }, { name: 'bay' }, { name: 'description', type: 'textarea', span: 2 }],
        onSubmit: async (d, close) => { const w = await G.post('/api/work-orders', d); close(); location.hash = `#/work-orders/${w.id}`; },
      }),
      after: (v) => v.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { location.hash = `#/work-orders?status=${b.dataset.s}`; }),
      rowLink: (r) => `#/work-orders/${r.id}`,
      rowCls: (r) => (r.priority === 'urgent' ? 'row-bad' : ''),
      columns: [
        { key: 'no', label: t('wo_no'), render: (r) => `<b>${esc(r.no)}</b>${r.priority !== 'normal' ? ' ' + G.badge(r.priority) : ''}` },
        { key: 'date', render: (r) => G.fdt(r.date) },
        { key: 'plate', label: t('vehicle'), render: (r) => esc(`${r.plate || ''} ${r.series || ''} ${r.model || ''}`) },
        { key: 'customer_name', label: t('customer') }, { key: 'technicians', hideMobile: true }, { key: 'bay', hideMobile: true },
        { key: 'total', cls: 'num', render: (r) => G.money(r.labor_total + r.parts_total) },
        { key: 'status', render: (r) => G.badge(r.status, 'wo_') + (r.invoice_no ? ` <small>${esc(r.invoice_no)}</small>` : '') },
      ],
    });
  });

  const nextActions = (w) => {
    const a = [];
    const s = w.status;
    if (['open', 'waiting_parts', 'waiting_approval'].includes(s)) a.push(['in_progress', 'act_start', 'btn-primary']);
    if (['open', 'in_progress'].includes(s)) a.push(['waiting_parts', 'act_waiting_parts', ''], ['waiting_approval', 'act_waiting_approval', '']);
    if (['in_progress', 'waiting_parts', 'waiting_approval'].includes(s)) a.push(['quality_check', 'act_qc', '']);
    if (['in_progress', 'quality_check'].includes(s)) a.push(['completed', 'act_complete', 'btn-ok']);
    if (s === 'completed') a.push(['delivered', 'act_deliver', 'btn-primary'], ['in_progress', 'act_reopen', '']);
    if (!['delivered', 'cancelled', 'completed'].includes(s) && !w.invoice_id) a.push(['cancelled', 'act_cancel', 'btn-danger']);
    return a;
  };

  G.jobCardPrint = (w) => {
    const both = (k) => `${window.I18N[k] ? window.I18N[k][0] + ' / ' + window.I18N[k][1] : k}`;
    G.print(`<h2 class="doc-title">${both('work_order')} - ${esc(w.no)}</h2>
      <table class="ptbl"><tr><th>${both('date')}</th><td>${G.fdt(w.date)}</td><th>${both('priority')}</th><td>${t(w.priority)}</td></tr>
      <tr><th>${both('customer')}</th><td>${esc(w.customer.name)} - ${esc(w.customer.phone || '')}</td><th>${both('plate')}</th><td>${esc(w.vehicle.plate)}</td></tr>
      <tr><th>${both('vehicle')}</th><td>${esc(`${w.vehicle.series || ''} ${w.vehicle.model || ''} ${w.vehicle.year || ''}`)}</td><th>VIN</th><td>${esc(w.vehicle.vin || '')}</td></tr>
      <tr><th>${both('mileage')}</th><td>${G.int(w.mileage)}</td><th>${both('bay')}</th><td>${esc(w.bay || '')}</td></tr></table>
      <h3>${both('description')}</h3><div class="pbox">${esc(w.description || '').replace(/\n/g, '<br>')}</div>
      <h3>${both('labor')}</h3><table class="ptbl lines"><tr><th>#</th><th>${both('description')}</th><th>${both('technician')}</th><th>${both('hours')}</th><th>✔</th></tr>
      ${w.labor.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description || G.tl(l.service_name_ar, l.service_name_en))}</td><td>${esc(l.technician_name || '')}</td><td>${G.num(l.hours)}</td><td>${l.done ? '☑' : '☐'}</td></tr>`).join('')}</table>
      <h3>${both('parts_used')}</h3><table class="ptbl lines"><tr><th>#</th><th>${both('part_no')}</th><th>${both('description')}</th><th>${both('qty')}</th></tr>
      ${w.parts.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.part_no || '')}</td><td>${esc(x.description || G.tl(x.name_ar, x.name_en))}</td><td>${G.num(x.qty)}</td></tr>`).join('')}</table>
      <h3>${both('qc')}</h3><div class="pbox">${QC.map((k) => `☐ ${t('qc_' + k)}`).join(' &nbsp; ')}</div>
      <div class="signs"><div>${both('technician')}<br><br>..................</div><div>${both('qc')}<br><br>..................</div><div>${both('advisor')}<br><br>..................</div></div>`);
  };

  G.addRoute('/work-orders/:id', async (view, p) => {
    await Promise.all([G.loadServiceTypes(), G.loadEmployees()]);
    let w = await G.get(`/api/work-orders/${p.id}/full`);
    const render = () => {
      const locked = !!w.invoice_id || ['delivered', 'cancelled'].includes(w.status);
      const canEdit = G.can(R.SHOP) && !locked;
      const canParts = G.can(R.SHOP.concat(['storekeeper'])) && !locked;
      const laborTotal = w.labor.reduce((s, l) => s + l.amount, 0);
      const partsTotal = w.parts.reduce((s, l) => s + l.amount, 0);
      const qc = G.parseJson(w.qc_checklist, {});
      view.innerHTML = `
        <div class="page-head"><h2>🔧 ${esc(w.no)} ${G.badge(w.status, 'wo_')} ${w.priority !== 'normal' ? G.badge(w.priority) : ''}</h2><div class="head-actions">
          <button class="btn" data-print>🖨 ${t('print_job_card')}</button>
          ${G.can(R.SHOP) ? `<button class="btn" data-edit>✎ ${t('edit')}</button>` : ''}
          ${w.invoice_id && G.can(R.BILL) ? `<a class="btn btn-primary" href="#/invoices/${w.invoice_id}">🧾 ${t('view_invoice')} ${esc(w.invoice_no)}</a>` : ''}
          ${!w.invoice_id && w.status !== 'cancelled' && G.can(R.BILL) && (w.labor.length || w.parts.length) ? `<button class="btn btn-primary" data-invoice>🧾 ${t('create_invoice')}</button>` : ''}
        </div></div>
        ${G.can(R.SHOP) ? `<div class="status-actions">${nextActions(w).map(([s, k, c]) => `<button class="btn ${c}" data-status="${s}">${t(k)}</button>`).join('')}</div>` : ''}
        ${locked ? `<div class="alert">${t('wo_locked')}</div>` : ''}
        <div class="card info-grid">
          ${info(t('customer'), `<a href="#/customers/${w.customer_id}">${esc(w.customer.name)}</a> ${G.contactBtns(w.customer.phone, statusText(w))}`, true)}
          ${info(t('vehicle'), `<a href="#/vehicles/${w.vehicle_id}">${esc(G.vehLabel(w.vehicle))}</a>`, true)}
          ${info('VIN', w.vehicle.vin)}${info(t('mileage'), G.int(w.mileage))}${info(t('advisor'), w.advisor_name)}${info(t('bay'), w.bay)}
          ${info(t('date'), G.fdt(w.date))}${info(t('started_at'), G.fdt(w.started_at))}${info(t('completed_at'), G.fdt(w.completed_at))}${info(t('delivered_at'), G.fdt(w.delivered_at))}
          ${w.reception ? info(t('reception'), `<a href="#/receptions/${w.reception.id}">${esc(w.reception.no)}</a>`, true) : ''}
        </div>
        <div class="grid-2">
          <section class="card"><h3>${t('description')}</h3><p class="pre">${esc(w.description || '-')}</p>${w.notes ? `<h4>${t('notes')}</h4><p class="pre">${esc(w.notes)}</p>` : ''}</section>
          ${w.diagnosis ? `<section class="card"><h3>🩺 ${t('diagnosis')} ${G.badge(w.diagnosis.approval)}</h3>
            <p><b>${t('fault_codes')}:</b> ${esc(w.diagnosis.fault_codes || '-')}</p><p class="pre">${esc(w.diagnosis.findings || '')}</p>
            <h4>${t('recommendations')}</h4><p class="pre">${esc(w.diagnosis.recommendations || '')}</p><p><b>${t('estimated_cost')}:</b> ${G.money(w.diagnosis.estimated_cost)}</p></section>` : '<div></div>'}
        </div>
        <section class="card"><div class="card-head"><h3>🛠 ${t('labor')}</h3>${canEdit ? `<button class="btn btn-sm btn-primary" data-addlabor>＋ ${t('add_labor')}</button>` : ''}</div>
          ${G.table([
    { key: 'done', label: '✔', render: (l) => `<input type="checkbox" data-done ${l.done ? 'checked' : ''} ${G.can(R.SHOP) && w.status !== 'cancelled' ? '' : 'disabled'}>` },
    { key: 'description', render: (l) => `${l.service_code ? `<small class="code">${esc(l.service_code)}</small> ` : ''}${esc(l.description || G.tl(l.service_name_ar, l.service_name_en))}` },
    { key: 'technician_name', label: t('technician') }, { key: 'hours', cls: 'num', render: (l) => G.num(l.hours) }, { key: 'rate', cls: 'num', render: (l) => G.num(l.rate) },
    { key: 'amount', cls: 'num', render: (l) => G.money(l.amount) },
    { key: 'a', label: '', render: () => (canEdit ? `<button class="icon-btn" data-el>✎</button><button class="icon-btn danger" data-dl>🗑</button>` : '') }], w.labor, { cls: 'labor' })}
        </section>
        <section class="card"><div class="card-head"><h3>📦 ${t('parts_used')}</h3>${canParts ? `<button class="btn btn-sm btn-primary" data-addpart>＋ ${t('add_part')}</button>` : ''}</div>
          ${G.table([
    { key: 'part_no', render: (x) => esc(x.part_no || '-') }, { key: 'description', render: (x) => esc(x.description || G.tl(x.name_ar, x.name_en)) },
    { key: 'qty', cls: 'num', render: (x) => G.num(x.qty) }, { key: 'unit_price', cls: 'num', render: (x) => G.num(x.unit_price) },
    { key: 'amount', cls: 'num', render: (x) => G.money(x.amount) }, { key: 'technician_name', label: t('technician'), hideMobile: true },
    { key: 'a', label: '', render: () => (canParts ? `<button class="icon-btn" data-ep>✎</button><button class="icon-btn danger" data-dp>🗑</button>` : '') }], w.parts, { cls: 'parts' })}
        </section>
        <div class="grid-2">
          <section class="card"><h3>✅ ${t('qc')}</h3><div class="tags qc">${QC.map((k) => `<label class="chip"><input type="checkbox" data-qc="${k}" ${qc[k] ? 'checked' : ''} ${G.can(R.SHOP) && !locked ? '' : 'disabled'}><span>${t('qc_' + k)}</span></label>`).join('')}</div>
            ${G.field({ name: 'qc_by', label: t('qc') + ' - ' + t('employee'), type: 'select', options: G.empOptions(), attrs: G.can(R.SHOP) && !locked ? 'data-qcby' : 'disabled' }, w.qc_by)}</section>
          <section class="card totals"><h3>${t('summary')}</h3>
            <div class="trow"><span>${t('labor_total')}</span><b>${G.money(laborTotal)}</b></div>
            <div class="trow"><span>${t('parts_total')}</span><b>${G.money(partsTotal)}</b></div>
            <div class="trow big"><span>${t('total')} (${G.tl('قبل الضريبة', 'before VAT')})</span><b>${G.money(laborTotal + partsTotal)}</b></div></section>
        </div>
        <section class="card"><h3>📷 ${t('photos')}</h3>${G.photosBlock('work_order', w.id, G.can(R.SHOP))}
          ${w.attachments.filter((a) => a.ref_type === 'reception').length ? `<h4>${t('reception')}</h4><div class="photo-grid">${w.attachments.filter((a) => a.ref_type === 'reception').map((a) => `<div class="photo"><a href="${G.fileUrl(a)}" target="_blank" data-file><img src="${G.fileUrl(a)}" alt="" loading="lazy"></a></div>`).join('')}</div>` : ''}</section>`;
      bind();
    };
    const statusText = (wo) => G.tl(
      `عميلنا العزيز ${wo.customer.name}، حالة سيارتكم ${wo.vehicle.plate} (أمر شغل ${wo.no}): ${window.I18N['wo_' + wo.status][0]}. ${G.settings.center_name_ar}`,
      `Dear ${wo.customer.name}, your vehicle ${wo.vehicle.plate} (WO ${wo.no}) status: ${window.I18N['wo_' + wo.status][1]}. ${G.settings.center_name_en}`);
    const refresh = (data) => { w = data; render(); };
    const act = async (fn) => { try { refresh(await fn()); } catch (e) { G.fail(e); } };
    const laborDialog = (l = {}) => G.formDialog({
      title: t('add_labor'),
      fields: [
        ...(l.id ? [] : [{ name: 'service_type_id', label: t('service_type'), type: 'select', options: (G.cache.service_types || []).map((s) => [s.id, `${s.code ? s.code + ' - ' : ''}${G.tl(s.name_ar, s.name_en)} (${G.num(s.labor_price)})`]), span: 2 }]),
        { name: 'description', span: 2, placeholder: G.tl('أو اكتب وصف المصنعية', 'or type a labor description') },
        { name: 'technician_id', label: t('technician'), type: 'select', options: G.empOptions() },
        { name: 'hours', type: 'number' }, { name: 'rate', type: 'number', placeholder: G.settings.labor_rate }, { name: 'amount', type: 'number', placeholder: G.tl('تلقائي = الساعات × السعر', 'auto = hours × rate') },
      ],
      values: l.id ? l : { technician_id: G.user.employee_id },
      onMount: (m, form) => {
        const st = form.querySelector('[name=service_type_id]');
        if (st) st.onchange = () => {
          const s = G.cache.service_types.find((x) => String(x.id) === st.value);
          if (s) { form.querySelector('[name=hours]').value = s.labor_hours; form.querySelector('[name=rate]').value = s.labor_hours ? Math.round((s.labor_price / s.labor_hours) * 100) / 100 : s.labor_price; form.querySelector('[name=amount]').value = s.labor_price; }
        };
      },
      onSubmit: async (d, close) => {
        const r = l.id ? await G.put(`/api/wo-labor/${l.id}`, d) : await G.post(`/api/work-orders/${w.id}/labor`, d);
        close(); refresh(r);
      },
    });
    const partDialog = (x = {}) => G.formDialog({
      title: t('add_part'),
      fields: x.id ? [{ name: 'qty', type: 'number', required: true }, { name: 'unit_price', type: 'number' }, { name: 'technician_id', label: t('technician'), type: 'select', options: G.empOptions() }]
        : [
          { name: 'mode', label: '', type: 'segment', options: [['stock', '📦 ' + t('parts')], ['external', '🛒 ' + t('external_part')]], default: 'stock', span: 2 },
          { name: 'part_id', label: t('part'), type: 'lookup', res: 'parts', span: 2 },
          { name: 'description', span: 2 }, { name: 'qty', type: 'number', default: 1, required: true }, { name: 'unit_price', type: 'number' },
          ...(G.can(R.MONEY) ? [{ name: 'unit_cost', type: 'number', label: t('unit_cost') + ' (' + t('external_part') + ')' }] : []),
          { name: 'technician_id', label: t('technician'), type: 'select', options: G.empOptions() },
        ],
      values: x,
      onMount: (m, form) => {
        const lk = form.querySelector('.lookup');
        if (lk) {
          lk.addEventListener('pick', (e) => { const up = form.querySelector('[name=unit_price]'); if (!up.value) up.value = e.detail.price; });
          const sync = () => {
            const ext = form.querySelector('[name=mode]:checked').value === 'external';
            lk.closest('.field').hidden = ext;
            const uc = form.querySelector('[name=unit_cost]');
            if (uc) uc.closest('.field').hidden = !ext;
          };
          form.querySelectorAll('[name=mode]').forEach((r) => r.onchange = sync);
          sync();
        }
      },
      onSubmit: async (d, close) => {
        let r;
        if (x.id) r = await G.put(`/api/wo-parts/${x.id}`, d);
        else {
          if (d.mode === 'external') d.part_id = '';
          else if (!d.part_id) throw new Error(t('err_required') + ': ' + t('part'));
          delete d.mode;
          r = await G.post(`/api/work-orders/${w.id}/parts`, d);
        }
        close(); refresh(r);
      },
    });
    const bind = () => {
      view.querySelector('[data-print]').onclick = () => G.jobCardPrint(w);
      view.querySelectorAll('[data-status]').forEach((b) => b.onclick = async () => {
        const s = b.dataset.status;
        if (s === 'cancelled' && !(await G.confirm(t('act_cancel') + '?'))) return;
        if (s === 'completed' && w.labor.some((l) => !l.done) && !(await G.confirm(G.tl('يوجد بنود مصنعية لم يتم تعليمها كمنفذة، متابعة؟', 'Some labor lines are not marked done. Continue?')))) return;
        act(() => G.post(`/api/work-orders/${w.id}/status`, { status: s }));
      });
      const eb = view.querySelector('[data-edit]');
      if (eb) eb.onclick = () => G.formDialog({
        title: t('edit'),
        fields: [{ name: 'mileage', type: 'number' }, { name: 'priority', type: 'select', options: G.opt(['normal', 'high', 'urgent']), noEmpty: true },
          { name: 'advisor_id', label: t('advisor'), type: 'select', options: G.empOptions() }, { name: 'bay' },
          { name: 'description', type: 'textarea', rows: 4, span: 2 }, { name: 'notes', type: 'textarea', span: 2 }],
        values: w,
        onSubmit: async (d, close) => { await G.put(`/api/work-orders/${w.id}`, d); close(); refresh(await G.get(`/api/work-orders/${w.id}/full`)); },
      });
      const al = view.querySelector('[data-addlabor]');
      if (al) al.onclick = () => laborDialog();
      const ap = view.querySelector('[data-addpart]');
      if (ap) ap.onclick = () => partDialog();
      view.querySelectorAll('table.labor [data-el]').forEach((b) => b.onclick = () => laborDialog(w.labor[b.closest('tr').dataset.i]));
      view.querySelectorAll('table.labor [data-dl]').forEach((b) => b.onclick = async () => { if (await G.confirm(t('confirm_delete'))) act(() => G.del(`/api/wo-labor/${w.labor[b.closest('tr').dataset.i].id}`)); });
      view.querySelectorAll('table.labor [data-done]').forEach((c) => c.onchange = () => act(() => G.put(`/api/wo-labor/${w.labor[c.closest('tr').dataset.i].id}`, { done: c.checked ? 1 : 0 })));
      view.querySelectorAll('table.parts [data-ep]').forEach((b) => b.onclick = () => partDialog(w.parts[b.closest('tr').dataset.i]));
      view.querySelectorAll('table.parts [data-dp]').forEach((b) => b.onclick = async () => { if (await G.confirm(t('confirm_delete'))) act(() => G.del(`/api/wo-parts/${w.parts[b.closest('tr').dataset.i].id}`)); });
      const saveQc = async () => {
        const qc = {};
        view.querySelectorAll('[data-qc]').forEach((c) => { if (c.checked) qc[c.dataset.qc] = 1; });
        const qcBy = view.querySelector('[data-qcby]');
        try { await G.put(`/api/work-orders/${w.id}`, { qc_checklist: JSON.stringify(qc), qc_by: qcBy ? qcBy.value || null : w.qc_by }); w.qc_checklist = JSON.stringify(qc); } catch (e) { G.fail(e); }
      };
      view.querySelectorAll('[data-qc]').forEach((c) => c.onchange = saveQc);
      const qb = view.querySelector('[data-qcby]');
      if (qb) qb.onchange = saveQc;
      const ib = view.querySelector('[data-invoice]');
      if (ib) ib.onclick = () => G.invoiceFromWoDialog(w);
      G.bindPhotos(view);
    };
    render();
  });

  G.invoiceFromWoDialog = async (w) => {
    const accounts = G.can(R.MONEY.concat(['advisor'])) ? await G.loadAccounts().catch(() => []) : [];
    const sub = w.labor.reduce((s, l) => s + l.amount, 0) + w.parts.reduce((s, l) => s + l.amount, 0);
    G.formDialog({
      title: `${t('create_invoice')} - ${w.no}`,
      extra: `<div class="totals mt"><div class="trow"><span>${t('subtotal')}</span><b>${G.money(sub)}</b></div><div class="trow big"><span>${t('total')}</span><b data-total></b></div></div>`,
      fields: [
        { name: 'date', type: 'date', default: G.today() }, { name: 'discount', type: 'number', default: 0 }, { name: 'tax_rate', type: 'number', default: G.settings.vat_rate },
        { name: 'notes' },
        ...(accounts.length ? [{ html: `<h4 class="span-2 sec-title">${t('pay_now')}</h4>` }, { name: 'pay_amount', label: t('amount'), type: 'number' },
          { name: 'account_id', label: t('account'), type: 'select', options: accounts.map((a) => [a.id, a.name]), default: accounts[0] && accounts[0].id, noEmpty: true },
          { name: 'method', type: 'select', options: G.opt(['cash', 'card', 'transfer', 'wallet', 'cheque'], 'm_'), default: 'cash', noEmpty: true }] : []),
      ],
      onMount: (m, form) => {
        const calc = () => {
          const disc = Number(form.querySelector('[name=discount]').value) || 0;
          const rate = Number(form.querySelector('[name=tax_rate]').value) || 0;
          const total = Math.round((sub - disc) * (1 + rate / 100) * 100) / 100;
          m.querySelector('[data-total]').textContent = G.money(total);
          const pa = form.querySelector('[name=pay_amount]');
          if (pa) pa.placeholder = total;
        };
        form.querySelectorAll('[name=discount],[name=tax_rate]').forEach((i) => i.oninput = calc);
        calc();
      },
      onSubmit: async (d, close) => {
        const body = { date: d.date, discount: d.discount, tax_rate: d.tax_rate, notes: d.notes };
        if (Number(d.pay_amount) > 0) body.payment = { amount: d.pay_amount, account_id: d.account_id, method: d.method };
        const inv = await G.post(`/api/work-orders/${w.id}/invoice`, body);
        close(); G.toast(t('saved'));
        location.hash = `#/invoices/${inv.id}`;
      },
    });
  };
})();
