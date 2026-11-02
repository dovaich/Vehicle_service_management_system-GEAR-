/* HR: attendance (check-in / check-out) */
(function () {
  const { t, esc, R } = G;
  const ATT_READ = ['admin', 'manager', 'accountant'];
  const STATUSES = ['present', 'absent', 'leave', 'sick', 'holiday', 'unpaid'];
  G.WEEKDAYS = () => (G.lang === 'ar' ? ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  const hm = (m) => (m ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : '-');
  const stBadge = (s) => (s ? G.badge(s === 'present' ? 'present' : s, 'at_') : `<span class="muted">-</span>`);

  // "my attendance" card: check in / check out with one tap (used on the dashboard and the attendance page)
  G.punchCard = async (box) => {
    if (!G.user || !G.user.employee_id) { box.innerHTML = ''; return; }
    const load = async () => {
      const d = await G.get('/api/attendance/me');
      if (!d.linked) { box.innerHTML = ''; return; }
      const r = d.record;
      const inDone = r && r.check_in; const outDone = r && r.check_out;
      box.innerHTML = `<section class="card punch">
        <div class="punch-info"><h3>🕘 ${t('my_attendance')} - ${esc(d.date)}</h3>
          <div>${t('check_in')}: <b>${esc((r && r.check_in) || '--:--')}</b> &nbsp; ${t('check_out')}: <b>${esc((r && r.check_out) || '--:--')}</b></div></div>
        <div class="punch-btns">
          ${!inDone ? `<button class="btn btn-ok btn-lg" data-punch="in">▶ ${t('punch_in')}</button>` : ''}
          ${inDone && !outDone ? `<button class="btn btn-danger btn-lg" data-punch="out">⏹ ${t('punch_out')}</button>` : ''}
          ${outDone ? `<span class="badge b-done">✔ ${t('day_done')}</span>` : ''}
        </div></section>`;
      box.querySelectorAll('[data-punch]').forEach((b) => b.onclick = async () => {
        b.disabled = true;
        try { await G.post('/api/attendance/punch', { action: b.dataset.punch }); G.toast(t('saved')); await load(); } catch (e) { G.fail(e); b.disabled = false; }
      });
    };
    await load().catch(() => { box.innerHTML = ''; });
  };

  const editDialog = (emp, date, rec, done) => G.formDialog({
    title: `${emp.name} - ${date}`,
    fields: [
      { name: 'status', type: 'select', options: STATUSES.map((s) => [s, t('at_' + s)]), noEmpty: true, default: 'present', span: 2 },
      { name: 'check_in', type: 'time' }, { name: 'check_out', type: 'time' }, { name: 'notes', span: 2 },
    ],
    values: rec || { status: 'present' },
    onMount: (m, form) => {
      const st = form.querySelector('[name=status]');
      const sync = () => form.querySelectorAll('[name=check_in],[name=check_out]').forEach((i) => { i.closest('.field').hidden = st.value !== 'present'; });
      st.onchange = sync; sync();
      if (rec && rec.id && G.can(R.MGMT)) {
        const foot = m.querySelector('.modal-foot');
        const del = document.createElement('button');
        del.className = 'btn btn-ghost'; del.type = 'button'; del.textContent = '🗑 ' + t('delete');
        del.onclick = async () => { if (!(await G.confirm(t('confirm_delete')))) return; await G.del('/api/attendance/' + rec.id); m.closest('.modal-wrap').close(); done(); };
        foot.prepend(del);
      }
    },
    onSubmit: async (d, close) => { await G.put('/api/attendance', { ...d, employee_id: emp.id, date }); close(); G.toast(t('saved')); done(); },
  });

  const board = async (body) => {
    body.innerHTML = `<div class="toolbar">${G.field({ name: 'date', type: 'date' }, G.today())}<button class="btn" data-pr>🖨 ${t('print')}</button></div><div class="card" data-out></div>`;
    const load = async () => {
      const date = body.querySelector('[name=date]').value;
      const d = await G.get('/api/attendance?date=' + date);
      const isToday = date === G.today();
      const canEdit = G.can(R.MGMT);
      const present = d.rows.filter((r) => r.record && r.record.status === 'present').length;
      body.querySelector('[data-out]').innerHTML = `<div class="count-line">${G.WEEKDAYS()[new Date(date + 'T12:00:00').getDay()]} ${d.work_day ? '' : '· ' + t('day_off')} · ${t('at_present')}: <b>${present}</b> / ${d.rows.length}</div>`
        + G.table([
          { key: 'name', label: t('employee'), render: (r) => `<b>${esc(r.name)}</b><br><small class="muted">${t('j_' + r.job)}</small>` },
          { key: 'status', render: (r) => stBadge(r.record && r.record.status) },
          { key: 'check_in', label: t('check_in'), render: (r) => esc((r.record && r.record.check_in) || '-') },
          { key: 'check_out', label: t('check_out'), render: (r) => esc((r.record && r.record.check_out) || '-') },
          { key: 'late', label: t('late_minutes'), cls: 'num', render: (r) => (r.late ? `<b class="neg">${r.late}</b>` : '-') },
          { key: 'overtime', label: t('overtime'), cls: 'num', render: (r) => (r.overtime ? `<b class="pos">${hm(r.overtime)}</b>` : '-') },
          ...(canEdit ? [{ key: 'a', label: '', cls: 'actions-wide', render: (r) => `${isToday && !(r.record && r.record.check_in) ? `<button class="btn btn-sm btn-ok" data-p="in">▶ ${t('punch_in')}</button>` : ''}
            ${isToday && r.record && r.record.check_in && !r.record.check_out ? `<button class="btn btn-sm btn-danger" data-p="out">⏹ ${t('punch_out')}</button>` : ''}
            <button class="btn btn-sm" data-e>✎ ${t('edit')}</button>` }] : []),
        ], d.rows);
      body.querySelectorAll('[data-p]').forEach((b) => b.onclick = async () => {
        const r = d.rows[b.closest('tr').dataset.i];
        try { await G.post('/api/attendance/punch', { action: b.dataset.p, employee_id: r.employee_id }); load(); } catch (e) { G.fail(e); }
      });
      body.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => {
        const r = d.rows[b.closest('tr').dataset.i];
        editDialog({ id: r.employee_id, name: r.name }, date, r.record, load);
      });
      body.querySelector('[data-pr]').onclick = () => G.print(`<h2 class="doc-title">${t('attendance')} - ${date}</h2>${body.querySelector('[data-out]').innerHTML}`);
    };
    body.querySelector('[name=date]').onchange = () => load().catch(G.fail);
    await load();
  };

  const sheet = async (body, mgr) => {
    await G.loadEmployees();
    body.innerHTML = `<div class="toolbar">${G.field({ name: 'period', label: t('month'), type: 'month' }, G.today().slice(0, 7))}
      ${mgr ? G.field({ name: 'employee_id', label: t('employee'), type: 'select', options: G.empOptions(), noEmpty: true }, G.user.employee_id || ((G.empOptions()[0] || [])[0])) : ''}
      <button class="btn" data-pr>🖨 ${t('print')}</button></div><div data-out></div>`;
    const load = async () => {
      const period = body.querySelector('[name=period]').value;
      const emp = mgr ? body.querySelector('[name=employee_id]').value : '';
      const d = await G.get(`/api/attendance/month?${G.qs({ period, employee_id: emp })}`);
      d.days = d.days.filter((x) => x.date <= G.today()).reverse(); // no future days, newest first
      const k = (label, v, cls = '') => `<div class="kpi ${cls}"><div><small>${label}</small><b>${v}</b></div></div>`;
      const money = d.salary_due !== undefined;
      const html = `<h3>${esc(d.employee.name)} - ${esc(period)} ${money ? `<small class="muted">(${t('pay_' + (d.pay_type || 'monthly'))})</small>` : ''}</h3>
        <div class="kpis">
          ${k(t('working_days'), G.int(d.working_days))}${k(t('present_days'), G.int(d.present_days), 'ok')}${k(t('absent_days'), G.int(d.absent_days + d.unpaid_days), d.absent_days ? 'bad' : '')}
          ${k(t('leave_days'), G.int(d.leave_days))}${k(t('late_minutes'), hm(d.late_minutes + d.early_minutes), d.late_minutes ? 'warn' : '')}${k(t('overtime'), hm(d.overtime_minutes), 'ok')}${k(t('worked_hours'), hm(d.worked_minutes))}
          ${money ? k(t('salary'), G.money(d.salary)) + k(t('absence_deduction'), G.money(d.absence_deduction), 'bad') + k(t('late_deduction'), G.money(d.late_deduction), 'warn') + k(t('overtime_pay'), G.money(d.overtime_pay), 'ok') + k(t('salary_due'), G.money(d.salary_due), 'ok') : ''}
        </div>
        ${money && !d.by_attendance ? `<p class="alert">${t('attendance_payroll_off')}</p>` : ''}
        <div class="card">${G.table([
    { key: 'date', render: (x) => `${esc(x.date.slice(8))} <small class="muted">${G.WEEKDAYS()[x.weekday]}</small>` },
    { key: 'status', render: (x) => (x.status === 'not_hired' ? '<span class="muted">-</span>' : stBadge(x.status) + (x.work_day ? '' : ` <small class="muted">${t('day_off')}</small>`)) },
    { key: 'check_in', label: t('check_in'), render: (x) => esc(x.check_in || '-') }, { key: 'check_out', label: t('check_out'), render: (x) => esc(x.check_out || '-') },
    { key: 'late', label: t('late_minutes'), cls: 'num', render: (x) => (x.late || x.early ? `<span class="neg">${x.late + x.early}</span>` : '') },
    { key: 'overtime', label: t('overtime'), cls: 'num', render: (x) => (x.overtime ? `<span class="pos">${hm(x.overtime)}</span>` : '') },
    { key: 'worked', label: t('worked_hours'), cls: 'num', hideMobile: true, render: (x) => (x.worked ? hm(x.worked) : '') },
    ...(G.can(R.MGMT) ? [{ key: 'a', label: '', render: () => '<button class="icon-btn" data-e>✎</button>' }] : []),
  ], d.days, { rowCls: (x) => (x.status === 'absent' ? 'row-bad' : x.work_day ? '' : 'row-off') })}</div>`;
      body.querySelector('[data-out]').innerHTML = html;
      body.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => {
        const x = d.days[b.closest('tr').dataset.i];
        editDialog({ id: d.employee.id, name: d.employee.name }, x.date, x.id ? { id: x.id, status: x.status, check_in: x.check_in, check_out: x.check_out, notes: x.notes } : null, load);
      });
      body.querySelector('[data-pr]').onclick = () => G.print(html);
    };
    body.querySelectorAll('[name=period],[name=employee_id]').forEach((i) => i.onchange = () => load().catch(G.fail));
    await load();
  };

  G.addRoute('/attendance', async (view) => {
    const mgr = G.can(ATT_READ);
    view.innerHTML = `<div class="page-head"><h2>🕘 ${t('attendance')}</h2></div><div data-punch></div><div data-tabs></div>`;
    G.punchCard(view.querySelector('[data-punch]'));
    const tabsEl = view.querySelector('[data-tabs]');
    if (!mgr) {
      if (!G.user.employee_id) { tabsEl.innerHTML = `<div class="empty">${t('err_not_linked_employee')}</div>`; return; }
      await sheet(tabsEl, false);
      return;
    }
    G.tabs(tabsEl, [['board', t('today_board')], ['sheet', t('monthly_sheet')]], (k, body) => (k === 'board' ? board(body) : sheet(body, true)).catch(G.fail));
  });
})();
