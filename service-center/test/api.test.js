'use strict';
// End-to-end API tests for the main business flows. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-test-'));
process.env.GEAR_DATA_DIR = dir;
const { server } = require('../server/server');

let base;
let cookie = '';
async function call(method, url, body, opts = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.cookie !== undefined ? (opts.cookie ? { Cookie: opts.cookie } : {}) : cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc && opts.keepCookie !== false) cookie = sc.split(';')[0];
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (opts.expect && res.status !== opts.expect) assert.fail(`${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
  if (!opts.expect && res.status >= 400) assert.fail(`${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('full service-center flow', async () => {
  // auth
  await call('GET', '/api/dashboard', undefined, { expect: 401 });
  await call('POST', '/api/auth/login', { username: 'admin', password: 'wrong' }, { expect: 401 });
  const login = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  assert.equal(login.user.role, 'admin');
  assert.equal(login.mustChange, true);

  // staff
  const tech = await call('POST', '/api/employees', { name: 'Ahmed Tech', job: 'technician', salary: 8000, labor_commission: 10, parts_commission: 2 });
  const adv = await call('POST', '/api/employees', { name: 'Sara Advisor', job: 'advisor', salary: 7000 });

  // customer + vehicle
  const cust = await call('POST', '/api/customers', { name: 'Mohamed Ali', phone: '01001234567' });
  const veh = await call('POST', '/api/vehicles', { customer_id: cust.id, plate: 'ABC 123', vin: 'WBA8E9G50GNT12345', series: '3 Series', model: '320i', chassis_code: 'F30', year: 2017, mileage: 85000 });
  assert.equal(veh.customer_name, 'Mohamed Ali');
  const found = await call('GET', '/api/customers?q=ABC');
  assert.equal(found.total, 1, 'customer searchable by plate');

  // supplier + parts + purchase
  const sup = await call('POST', '/api/suppliers', { name: 'Parts Co' });
  const oil = await call('POST', '/api/parts', { part_no: 'OIL-5W30', name_en: 'Engine oil 5W30 (L)', name_ar: 'زيت 5W30', unit: 'liter', qty: 0, min_qty: 10, cost: 0, price: 400 });
  const filter = await call('POST', '/api/parts', { part_no: '11428575211', name_en: 'Oil filter', qty: 5, cost: 300, price: 550 });
  assert.equal(filter.qty, 5);
  const po = await call('POST', '/api/purchases', { supplier_id: sup.id, items: [{ part_id: oil.id, qty: 20, unit_cost: 250, price: 420 }, { part_id: filter.id, qty: 5, unit_cost: 320 }] });
  assert.equal(po.total, 6600);
  const oilAfter = await call('GET', `/api/parts/${oil.id}`);
  assert.equal(oilAfter.qty, 20);
  assert.equal(oilAfter.cost, 250);
  assert.equal(oilAfter.price, 420);
  const filterAfter = await call('GET', `/api/parts/${filter.id}`);
  assert.equal(filterAfter.qty, 10);
  assert.equal(filterAfter.cost, 310, 'weighted average cost');
  let supRow = await call('GET', `/api/suppliers/${sup.id}`);
  assert.equal(supRow.balance, 6600);

  // reception -> diagnosis -> work order
  const rec = await call('POST', '/api/receptions', { vehicle_id: veh.id, mileage: 90000, complaints: 'Service due + noise', fuel_level: '1/2', advisor_id: adv.id, checklist: '{"items":"jack"}' });
  assert.match(rec.no, /^RC-/);
  assert.equal(rec.customer_id, cust.id);
  assert.equal((await call('GET', `/api/vehicles/${veh.id}`)).mileage, 90000);
  await call('POST', '/api/diagnoses', { reception_id: rec.id, technician_id: tech.id, fault_codes: '2A87', findings: 'Oil leak', recommendations: 'Replace gasket', estimated_cost: 3000 });
  assert.equal((await call('GET', `/api/receptions/${rec.id}`)).status, 'diagnosed');
  const woRef = await call('POST', `/api/receptions/${rec.id}/work-order`, {});
  const again = await call('POST', `/api/receptions/${rec.id}/work-order`, {});
  assert.equal(again.id, woRef.id, 'one WO per reception');

  const types = (await call('GET', '/api/service-types?q=OIL')).rows;
  const oilService = types.find((s) => s.code === 'OIL');
  let wo = await call('POST', `/api/work-orders/${woRef.id}/labor`, { service_type_id: oilService.id, technician_id: tech.id });
  assert.equal(wo.labor[0].amount, oilService.labor_price);
  wo = await call('POST', `/api/work-orders/${woRef.id}/labor`, { description: 'Valve cover gasket', technician_id: tech.id, hours: 2, rate: 700 });
  wo = await call('POST', `/api/work-orders/${woRef.id}/parts`, { part_id: oil.id, qty: 6, technician_id: tech.id });
  wo = await call('POST', `/api/work-orders/${woRef.id}/parts`, { part_id: filter.id, qty: 1 });
  assert.equal((await call('GET', `/api/parts/${oil.id}`)).qty, 14);
  // qty change and stock check
  wo = await call('PUT', `/api/wo-parts/${wo.parts[0].id}`, { qty: 7 });
  assert.equal((await call('GET', `/api/parts/${oil.id}`)).qty, 13);
  await call('POST', `/api/work-orders/${woRef.id}/parts`, { part_id: filter.id, qty: 999 }, { expect: 400 });
  wo = await call('POST', `/api/work-orders/${woRef.id}/status`, { status: 'in_progress' });
  assert.ok(wo.started_at);
  wo = await call('POST', `/api/work-orders/${woRef.id}/status`, { status: 'completed' });
  const rems = await call('GET', `/api/reminders?vehicle_id=${veh.id}`);
  assert.equal(rems.total, 1, 'oil service reminder created');
  assert.equal(rems.rows[0].due_mileage, 100000);

  // invoice with discount + VAT 14%, partial payment
  const accounts = (await call('GET', '/api/accounts')).rows;
  const cash = accounts[0];
  const subtotal = oilService.labor_price + 1400 + 7 * 420 + 550;
  let inv = await call('POST', `/api/work-orders/${woRef.id}/invoice`, { discount: 100, payment: { amount: 1000, account_id: cash.id } });
  assert.equal(inv.subtotal, subtotal);
  assert.equal(inv.total, Math.round((subtotal - 100) * 1.14 * 100) / 100);
  assert.equal(inv.paid, 1000);
  assert.equal(inv.status, 'partial');
  assert.equal(inv.parts_cost, 7 * 250 + 310);
  await call('POST', `/api/work-orders/${woRef.id}/parts`, { part_id: filter.id, qty: 1 }, { expect: 400 }); // locked
  await call('POST', `/api/invoices/${inv.id}/payments`, { amount: inv.total, account_id: cash.id }, { expect: 400 }); // exceeds due
  inv = await call('POST', `/api/invoices/${inv.id}/payments`, { amount: Math.round((inv.total - 1000) * 100) / 100, account_id: cash.id, method: 'card' });
  assert.equal(inv.status, 'paid');
  await call('POST', `/api/invoices/${inv.id}/cancel`, {}, { expect: 400 }); // has payments
  await call('POST', `/api/work-orders/${woRef.id}/status`, { status: 'delivered' });
  assert.equal((await call('GET', `/api/receptions/${rec.id}`)).status, 'delivered');

  // counter sale + cancel returns stock
  const sale = await call('POST', '/api/invoices', { customer_id: cust.id, items: [{ part_id: filter.id, qty: 2, unit_price: 550 }, { description: 'Wash', qty: 1, unit_price: 100 }], tax_rate: 0 });
  assert.equal(sale.total, 1200);
  assert.equal((await call('GET', `/api/parts/${filter.id}`)).qty, 7);
  await call('POST', `/api/invoices/${sale.id}/cancel`, {});
  assert.equal((await call('GET', `/api/parts/${filter.id}`)).qty, 9);

  // supplier payment
  await call('POST', `/api/purchases/${po.id}/payments`, { amount: 2000, account_id: cash.id });
  supRow = await call('GET', `/api/suppliers/${sup.id}`);
  assert.equal(supRow.balance, 4600);
  const stmt = await call('GET', `/api/suppliers/${sup.id}/statement`);
  assert.equal(stmt.rows[stmt.rows.length - 1].balance, 4600);

  // cash: expense + transfer
  await call('POST', '/api/transactions', { account_id: cash.id, direction: 'out', amount: 500, category: 'utilities', description: 'Electricity' });
  await call('POST', '/api/transfer', { from: cash.id, to: accounts[1].id, amount: 300 });
  const accs = (await call('GET', '/api/accounts')).rows;
  assert.equal(accs[0].balance, Math.round((inv.total - 2000 - 500 - 300) * 100) / 100);
  assert.equal(accs[1].balance, 300);
  const linked = (await call('GET', `/api/transactions?category=invoice_payment`)).rows[0];
  await call('DELETE', `/api/transactions/${linked.id}`, undefined, { expect: 400 });

  // commissions + payroll
  const today = new Date().toISOString().slice(0, 10);
  const from = today.slice(0, 8) + '01';
  const comm = await call('GET', `/api/bonuses/commissions?from=${from}&to=${today}`);
  const t1 = comm.find((c) => c.employee_id === tech.id);
  assert.equal(t1.labor_sales, oilService.labor_price + 1400);
  assert.equal(t1.labor_commission, Math.round((oilService.labor_price + 1400) * 0.1 * 100) / 100);
  assert.equal(t1.parts_commission, Math.round(7 * 420 * 0.02 * 100) / 100);
  const appr = await call('POST', '/api/bonuses/commissions/approve', { from, to: today });
  assert.equal(appr.created, 1);
  const appr2 = await call('POST', '/api/bonuses/commissions/approve', { from, to: today });
  assert.equal(appr2.created, 0, 'no duplicate commissions');
  await call('POST', '/api/bonuses', { employee_id: tech.id, type: 'deduction', amount: 100, reason: 'late' });
  const period = today.slice(0, 7);
  let pr = await call('GET', `/api/payroll?period=${period}`);
  const p1 = pr.find((x) => x.employee_id === tech.id);
  assert.equal(p1.net, Math.round((8000 + t1.commission - 100) * 100) / 100);
  await call('POST', '/api/payroll/pay', { employee_id: tech.id, account_id: accounts[1].id, period });
  pr = await call('GET', `/api/payroll?period=${period}`);
  assert.equal(pr.find((x) => x.employee_id === tech.id).net, 0);

  // reports + dashboard
  const rep = await call('GET', `/api/reports/summary?from=${from}&to=${today}`);
  assert.equal(rep.invoices.n, 1);
  assert.equal(rep.invoices.total, inv.total);
  assert.ok(rep.net_profit !== undefined);
  const dash = await call('GET', '/api/dashboard');
  assert.equal(dash.in_workshop, 0);
  assert.ok(dash.revenue_today > 0);
  const search = await call('GET', '/api/search?q=WBA8E9');
  assert.equal(search.vehicles.length, 1);

  // roles: technician cannot see cash, sees no part costs
  await call('POST', '/api/users', { username: 'tech1', name: 'Tech', role: 'technician', password: 'secret1', employee_id: tech.id });
  const adminCookie = cookie;
  await call('POST', '/api/auth/login', { username: 'tech1', password: 'secret1' });
  await call('GET', '/api/accounts', undefined, { expect: 403 });
  const partsForTech = await call('GET', '/api/parts');
  assert.equal(partsForTech.rows[0].cost, undefined);
  const woTech = await call('GET', `/api/work-orders/${woRef.id}/full`);
  assert.equal(woTech.parts[0].unit_cost, undefined);
  cookie = adminCookie;

  // extra roles: accountant gets storekeeper powers only when granted
  const acc = await call('POST', '/api/users', { username: 'acc1', name: 'Acc', role: 'accountant', password: 'secret1' });
  await call('POST', '/api/auth/login', { username: 'acc1', password: 'secret1' });
  await call('POST', '/api/stock/adjust', { part_id: oil.id, type: 'in', qty: 1 }, { expect: 403 });
  cookie = adminCookie;
  await call('PUT', `/api/users/${acc.id}`, { extra_roles: 'storekeeper' });
  const me2 = await call('POST', '/api/auth/login', { username: 'acc1', password: 'secret1' });
  assert.deepEqual(me2.user.roles.sort(), ['accountant', 'storekeeper']);
  await call('POST', '/api/stock/adjust', { part_id: oil.id, type: 'in', qty: 1 });
  await call('GET', '/api/accounts'); // still an accountant
  cookie = adminCookie;
  const urows = (await call('GET', '/api/users')).rows;
  assert.equal(urows.find((u) => u.username === 'acc1').extra_roles, 'storekeeper');

  // multiple service advisors on a reception -> copied to the work order
  const adv2 = await call('POST', '/api/employees', { name: 'Omar Advisor', job: 'advisor', salary: 6000 });
  const rec2 = await call('POST', '/api/receptions', { vehicle_id: veh.id, mileage: 91000, complaints: 'check', advisor_ids: `${adv.id},${adv2.id}` });
  assert.equal(rec2.advisor_ids, `${adv.id},${adv2.id}`);
  assert.equal(rec2.advisor_id, adv.id);
  assert.match(rec2.advisor_name, /Sara/); assert.match(rec2.advisor_name, /Omar/);
  const wo2 = await call('POST', `/api/receptions/${rec2.id}/work-order`, {});
  assert.equal((await call('GET', `/api/work-orders/${wo2.id}`)).advisor_ids, `${adv.id},${adv2.id}`);

  // attendance-based payroll (September 2026: weekend = Friday)
  await call('PUT', '/api/settings', { attendance_payroll: '1', work_start: '09:00', work_end: '17:00', work_days_month: '26', weekend_days: '5', late_grace: '15', overtime_rate: '1.5', deduct_late: '1' });
  const mE = await call('POST', '/api/employees', { name: 'Monthly Guy', job: 'technician', pay_type: 'monthly', salary: 2600, hire_date: '2026-09-28' });
  const dE = await call('POST', '/api/employees', { name: 'Daily Guy', job: 'washer', pay_type: 'daily', salary: 300, hire_date: '2026-09-28' });
  for (const e of [mE, dE]) {
    await call('PUT', '/api/attendance', { employee_id: e.id, date: '2026-09-28', status: 'present', check_in: '09:30', check_out: '17:00' }); // 30 min late
    await call('PUT', '/api/attendance', { employee_id: e.id, date: '2026-09-29', status: 'present', check_in: '09:00', check_out: '19:00' }); // 2h overtime
    // 2026-09-30: no record -> absent
  }
  const mm = await call('GET', `/api/attendance/month?period=2026-09&employee_id=${mE.id}`);
  assert.equal(mm.present_days, 2); assert.equal(mm.absent_days, 1); assert.equal(mm.late_minutes, 30); assert.equal(mm.overtime_minutes, 120);
  assert.equal(mm.absence_deduction, 100); assert.equal(mm.late_deduction, 6.25); assert.equal(mm.overtime_pay, 37.5); assert.equal(mm.salary_due, 2531.25);
  const dm = await call('GET', `/api/attendance/month?period=2026-09&employee_id=${dE.id}`);
  assert.equal(dm.salary_due, 693.75);
  const prSep = await call('GET', '/api/payroll?period=2026-09');
  assert.equal(prSep.find((x) => x.employee_id === mE.id).net, 2531.25);
  await call('PUT', '/api/settings', { attendance_payroll: '0' });
  assert.equal((await call('GET', `/api/attendance/month?period=2026-09&employee_id=${mE.id}`)).salary_due, 2600, 'off = full salary');

  // attendance is recorded by the manager / accountant only - staff cannot check themselves in
  await call('POST', '/api/users', { username: 'emp1', name: 'Emp', role: 'technician', password: 'secret1', employee_id: mE.id });
  await call('POST', '/api/auth/login', { username: 'emp1', password: 'secret1' });
  await call('POST', '/api/attendance/punch', { action: 'in' }, { expect: 403 });
  await call('POST', '/api/attendance/punch', { action: 'in', employee_id: mE.id }, { expect: 403 });
  await call('PUT', '/api/attendance', { employee_id: mE.id, date: '2026-09-30', status: 'present' }, { expect: 403 });
  await call('GET', '/api/attendance', undefined, { expect: 403 });
  const own = await call('GET', `/api/attendance/month?period=2026-09&employee_id=${dE.id}`);
  assert.equal(own.employee.id, mE.id, 'staff only see their own sheet');
  assert.equal(own.salary_due, undefined, 'no salary numbers for staff');
  // the accountant records it
  await call('POST', '/api/auth/login', { username: 'acc1', password: 'secret1' });
  const pin = await call('POST', '/api/attendance/punch', { action: 'in', employee_id: mE.id });
  assert.equal(pin.employee_id, mE.id);
  const pout = await call('POST', '/api/attendance/punch', { action: 'out', employee_id: mE.id });
  assert.ok(pout.check_in && pout.check_out);
  await call('PUT', '/api/attendance', { employee_id: dE.id, date: '2026-09-30', status: 'leave' });
  cookie = adminCookie;
  assert.equal((await call('GET', '/api/attendance')).rows.find((r) => r.employee_id === mE.id).record.check_in, pout.check_in);
  await call('DELETE', `/api/attendance/${(await call('GET', `/api/attendance/month?period=2026-09&employee_id=${dE.id}`)).days.find((x) => x.date === '2026-09-30').id}`);

  // ---- weekly pay + advances (week of Sat 2026-09-26, Friday off)
  const cashOf = async () => (await call('GET', '/api/accounts')).rows.find((x) => x.id === cash.id).balance;
  await call('PUT', '/api/settings', { attendance_payroll: '1', week_start: '6' });
  const wE = await call('POST', '/api/employees', { name: 'Weekly Guy', job: 'washer', pay_type: 'weekly', salary: 1200, hire_date: '2026-09-01' });
  for (const d of ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30']) await call('PUT', '/api/attendance', { employee_id: wE.id, date: d, status: 'present', check_in: '09:00', check_out: '17:00' });
  // 2026-10-01 (Thu) absent
  const wk = await call('GET', '/api/payroll?period=W2026-09-26');
  assert.ok(!wk.find((x) => x.employee_id === mE.id), 'monthly staff not in weekly payroll');
  assert.ok(!(await call('GET', '/api/payroll?period=2026-09')).find((x) => x.employee_id === wE.id), 'weekly staff not in monthly payroll');
  let wr = wk.find((x) => x.employee_id === wE.id);
  assert.equal(wr.working_days, 6); assert.equal(wr.absent_days, 1); assert.equal(wr.salary_due, 1000);
  await call('GET', '/api/payroll?period=2026-9', undefined, { expect: 400 });
  // advance 300 from cash -> shows in the cash journal, deducted from the weekly pay
  let c0 = await cashOf();
  const advW = await call('POST', '/api/advances', { employee_id: wE.id, amount: 300, account_id: cash.id, reason: 'urgent' });
  assert.equal(advW.type, 'advance');
  assert.equal(await cashOf(), Math.round((c0 - 300) * 100) / 100, 'advance leaves the cash account');
  const advTx = (await call('GET', '/api/transactions?category=advance')).rows[0];
  assert.equal(advTx.amount, 300); assert.equal(advTx.party_name, 'Weekly Guy');
  const today2 = new Date().toISOString().slice(0, 10);
  assert.ok((await call('GET', `/api/cash/daily?date=${advTx.date}`)).by_category.some((x) => x.category === 'advance'), 'advance in daily closing');
  await call('POST', '/api/bonuses', { employee_id: wE.id, type: 'advance', amount: 50 }, { expect: 400 }); // must go through the advance form
  await call('DELETE', `/api/transactions/${advTx.id}`, undefined, { expect: 400 }); // linked to the advance
  wr = (await call('GET', '/api/payroll?period=W2026-09-26')).find((x) => x.employee_id === wE.id);
  assert.equal(wr.advances, 300); assert.equal(wr.net, 700);
  c0 = await cashOf();
  await call('POST', '/api/payroll/pay', { employee_id: wE.id, account_id: cash.id, period: 'W2026-09-26' });
  assert.equal(await cashOf(), Math.round((c0 - 700) * 100) / 100, 'net pay = salary - advance');
  wr = (await call('GET', '/api/payroll?period=W2026-09-26')).find((x) => x.employee_id === wE.id);
  assert.equal(wr.net, 0); assert.equal(wr.salary_paid, 1000); assert.equal(wr.advances, 0);
  assert.equal((await call('GET', `/api/bonuses?employee_id=${wE.id}&type=advance`)).rows[0].paid, 1, 'advance settled');
  // advance bigger than the pay -> carried over
  await call('PUT', '/api/settings', { attendance_payroll: '0' });
  await call('POST', '/api/advances', { employee_id: wE.id, amount: 1500, account_id: cash.id });
  c0 = await cashOf();
  wr = (await call('GET', '/api/payroll?period=W2026-10-03')).find((x) => x.employee_id === wE.id);
  assert.equal(wr.salary_due, 1200); assert.equal(wr.net, -300);
  const settle = await call('POST', '/api/payroll/pay', { employee_id: wE.id, account_id: cash.id, period: 'W2026-10-03' });
  assert.equal(settle.paid, 0); assert.equal(settle.carried, 300);
  assert.equal(await cashOf(), c0, 'nothing paid out');
  wr = (await call('GET', '/api/payroll?period=W2026-10-03')).find((x) => x.employee_id === wE.id);
  assert.equal(wr.salary_paid, 1200); assert.equal(wr.advances, 300, 'remaining advance carried');
  // deductions bigger than bonuses are now really deducted (old bug)
  const dd = await call('POST', '/api/employees', { name: 'Deduct Guy', job: 'technician', salary: 5000 });
  await call('POST', '/api/bonuses', { employee_id: dd.id, type: 'deduction', amount: 400, reason: 'damage' });
  await call('POST', '/api/bonuses', { employee_id: dd.id, type: 'bonus', amount: 100 });
  c0 = await cashOf();
  await call('POST', '/api/payroll/pay', { employee_id: dd.id, account_id: cash.id, period: '2026-11' });
  assert.equal(await cashOf(), Math.round((c0 - 4700) * 100) / 100, '5000 + 100 - 400');
  // deleting an unsettled advance gives the money back
  const advD = await call('POST', '/api/advances', { employee_id: dd.id, amount: 250, account_id: cash.id });
  c0 = await cashOf();
  await call('DELETE', `/api/bonuses/${advD.id}`);
  assert.equal(await cashOf(), Math.round((c0 + 250) * 100) / 100);
  void today2;

  // ---- delete invoices (customer) and purchases (supplier): everything is reversed
  const bal = async (id) => (await call('GET', '/api/accounts')).rows.find((x) => x.id === id).balance;
  const qtyOf = async (id) => (await call('GET', `/api/parts/${id}`)).qty;
  const delPart = await call('POST', '/api/parts', { part_no: 'DEL-1', name_en: 'Delete test part', qty: 10, cost: 50, price: 100 });
  // work-order invoice, fully paid -> delete
  const dWo = await call('POST', '/api/work-orders', { vehicle_id: veh.id, description: 'delete test' });
  await call('POST', `/api/work-orders/${dWo.id}/parts`, { part_id: delPart.id, qty: 2 });
  assert.equal(await qtyOf(delPart.id), 8);
  const cashBefore = await bal(cash.id);
  const custBefore = (await call('GET', `/api/customers/${cust.id}`)).balance;
  const dInv = await call('POST', `/api/work-orders/${dWo.id}/invoice`, { tax_rate: 0, payment: { amount: 200, account_id: cash.id } });
  assert.equal(dInv.status, 'paid');
  assert.equal(await bal(cash.id), Math.round((cashBefore + 200) * 100) / 100);
  await call('DELETE', `/api/invoices/${dInv.id}`);
  await call('GET', `/api/invoices/${dInv.id}`, undefined, { expect: 404 });
  assert.equal(await bal(cash.id), cashBefore, 'payment removed from cash');
  assert.equal((await call('GET', `/api/customers/${cust.id}`)).balance, custBefore, 'customer balance restored');
  assert.equal((await call('GET', `/api/work-orders/${dWo.id}`)).invoice_id, null, 'work order freed');
  assert.equal(await qtyOf(delPart.id), 8, 'WO parts stay on the work order');
  await call('POST', `/api/work-orders/${dWo.id}/parts`, { part_id: delPart.id, qty: 1 }); // editable again
  // counter sale (unpaid) -> delete returns stock
  const dSale = await call('POST', '/api/invoices', { customer_id: cust.id, tax_rate: 0, items: [{ part_id: delPart.id, qty: 3, unit_price: 100 }] });
  assert.equal(await qtyOf(delPart.id), 4);
  await call('DELETE', `/api/invoices/${dSale.id}`);
  assert.equal(await qtyOf(delPart.id), 7, 'counter-sale parts back in stock');
  // cancelled invoice -> delete does not return stock twice
  const cSale = await call('POST', '/api/invoices', { customer_id: cust.id, tax_rate: 0, items: [{ part_id: delPart.id, qty: 1, unit_price: 100 }] });
  await call('POST', `/api/invoices/${cSale.id}/cancel`, {});
  await call('DELETE', `/api/invoices/${cSale.id}`);
  assert.equal(await qtyOf(delPart.id), 7, 'no double return');
  // supplier invoice with a payment -> delete
  const supBefore = (await call('GET', `/api/suppliers/${sup.id}`)).balance;
  const cashB2 = await bal(cash.id);
  const dPo = await call('POST', '/api/purchases', { supplier_id: sup.id, items: [{ part_id: delPart.id, qty: 5, unit_cost: 60 }], payment: { amount: 100, account_id: cash.id } });
  assert.equal(await qtyOf(delPart.id), 12);
  await call('DELETE', `/api/purchases/${dPo.id}`);
  assert.equal(await qtyOf(delPart.id), 7, 'purchased qty removed');
  assert.equal((await call('GET', `/api/suppliers/${sup.id}`)).balance, supBefore, 'supplier balance restored');
  assert.equal(await bal(cash.id), cashB2, 'supplier payment back in cash');
  // cannot delete a purchase whose parts were already used
  const usedPo = await call('POST', '/api/purchases', { supplier_id: sup.id, items: [{ part_id: delPart.id, qty: 1, unit_cost: 60 }] });
  await call('POST', '/api/stock/adjust', { part_id: delPart.id, type: 'out', qty: 8 });
  await call('DELETE', `/api/purchases/${usedPo.id}`, undefined, { expect: 400 });
  assert.ok(await call('GET', `/api/purchases/${usedPo.id}/full`), 'purchase kept when stock is missing');
  // only managers can delete
  await call('POST', '/api/auth/login', { username: 'acc1', password: 'secret1' });
  await call('DELETE', `/api/purchases/${usedPo.id}`, undefined, { expect: 403 });
  cookie = adminCookie;

  // ---- edit a supplier invoice + return items from it
  const ep = await call('POST', '/api/parts', { part_no: 'EDIT-1', name_en: 'Edit test part', qty: 0, cost: 0, price: 100 });
  const epo = await call('POST', '/api/purchases', { supplier_id: sup.id, items: [{ part_id: ep.id, qty: 10, unit_cost: 50 }] });
  const supB0 = (await call('GET', `/api/suppliers/${sup.id}`)).balance;
  let epPart = await call('GET', `/api/parts/${ep.id}`);
  assert.equal(epPart.qty, 10); assert.equal(epPart.cost, 50);
  // wrong price and quantity -> fix to 12 pcs at 60
  const edited = await call('PUT', `/api/purchases/${epo.id}`, { items: [{ part_id: ep.id, qty: 12, unit_cost: 60, price: 130 }] });
  assert.equal(edited.total, 720);
  epPart = await call('GET', `/api/parts/${ep.id}`);
  assert.equal(epPart.qty, 12); assert.equal(epPart.cost, 60, 'average cost corrected'); assert.equal(epPart.price, 130);
  assert.equal((await call('GET', `/api/suppliers/${sup.id}`)).balance, Math.round((supB0 + 220) * 100) / 100, 'supplier owed the new total');
  // return 5 of them
  const ret = await call('POST', '/api/purchases', { supplier_id: sup.id, is_return: 1, notes: `Return ${epo.no}`, items: [{ part_id: ep.id, qty: 5, unit_cost: 60 }] });
  assert.match(ret.no, /^PR-/);
  assert.equal((await call('GET', `/api/parts/${ep.id}`)).qty, 7);
  assert.equal((await call('GET', `/api/suppliers/${sup.id}`)).balance, Math.round((supB0 + 220 - 300) * 100) / 100);
  // edit the return: only 3 went back
  await call('PUT', `/api/purchases/${ret.id}`, { items: [{ part_id: ep.id, qty: 3, unit_cost: 60 }] });
  assert.equal((await call('GET', `/api/parts/${ep.id}`)).qty, 9);
  assert.equal((await call('GET', `/api/suppliers/${sup.id}`)).balance, Math.round((supB0 + 220 - 180) * 100) / 100);
  // cannot edit below what was already used
  await call('POST', '/api/stock/adjust', { part_id: ep.id, type: 'out', qty: 9 });
  await call('PUT', `/api/purchases/${epo.id}`, { items: [{ part_id: ep.id, qty: 2, unit_cost: 60 }] }, { expect: 400 });
  assert.equal((await call('GET', `/api/purchases/${epo.id}/full`)).total, 720, 'unchanged after refusal');

  // ---- per-employee choice: by attendance or full salary, own schedule
  await call('PUT', '/api/settings', { attendance_payroll: '0', work_start: '09:00', work_end: '17:00', weekend_days: '5', late_grace: '15', overtime_rate: '1.5', deduct_late: '1' });
  const byAtt = await call('POST', '/api/employees', { name: 'Shift Guy', job: 'technician', pay_type: 'weekly', salary: 1200, attendance_based: '1', work_start: '10:00', work_end: '18:00' });
  const full = await call('POST', '/api/employees', { name: 'Full Guy', job: 'technician', pay_type: 'weekly', salary: 1200, attendance_based: '0' });
  for (const e of [byAtt, full]) {
    for (const d of ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) await call('PUT', '/api/attendance', { employee_id: e.id, date: d, status: 'present', check_in: '10:00', check_out: '18:00' });
  }
  await call('PUT', '/api/attendance', { employee_id: byAtt.id, date: '2026-10-03', status: 'present', check_in: '10:30', check_out: '20:00' }); // 30 late, 2h overtime on his own schedule
  const wk2 = await call('GET', '/api/payroll?period=W2026-10-03');
  const rA = wk2.find((x) => x.employee_id === byAtt.id); const rF = wk2.find((x) => x.employee_id === full.id);
  assert.equal(rA.late_minutes, 30); assert.equal(rA.overtime_minutes, 120);
  assert.equal(rA.salary_due, 1262.5, '1200 - 12.5 late + 75 overtime');
  assert.equal(rF.salary_due, 1200, 'full salary regardless of times');
  const board = await call('GET', '/api/attendance?date=2026-10-03');
  assert.equal(board.rows.find((x) => x.employee_id === byAtt.id).schedule, '10:00-18:00');
  assert.equal(board.rows.find((x) => x.employee_id === byAtt.id).late, 30);

  // ---- quick invoice: no work order, labor + parts, customer / car typed in (or nothing at all)
  const qPart = await call('POST', '/api/parts', { part_no: 'Q-1', name_en: 'Quick part', qty: 5, cost: 40, price: 100 });
  const oilSt = (await call('GET', '/api/service-types?q=OIL')).rows.find((x) => x.code === 'OIL');
  const custCount = async () => (await call('GET', '/api/customers?limit=1')).total;
  const n0 = await custCount();
  const qi = await call('POST', '/api/invoices', {
    customer: { name: 'زبون جديد', phone: '01299998888' }, vehicle: { plate: 'ق ر ب 55', model: '520i', mileage: 60000 }, tax_rate: 0,
    items: [{ kind: 'labor', service_type_id: oilSt.id, technician_id: tech.id, qty: 1, unit_price: 600 },
      { kind: 'labor', description: 'Brake check', qty: 1, unit_price: 200 }, { part_id: qPart.id, qty: 2, unit_price: 100 }, { kind: 'other', description: 'Wash', qty: 1, unit_price: 50 }],
    payment: { amount: 1050, account_id: cash.id },
  });
  assert.equal(qi.total, 1050); assert.equal(qi.status, 'paid'); assert.equal(qi.labor_total, 800);
  assert.equal(qi.customer.name, 'زبون جديد'); assert.equal(qi.vehicle.plate, 'ق ر ب 55'); assert.equal(qi.vehicle.mileage, 60000);
  assert.equal(await custCount(), n0 + 1, 'customer registered automatically');
  assert.equal((await call('GET', `/api/parts/${qPart.id}`)).qty, 3);
  const qRem = (await call('GET', `/api/reminders?vehicle_id=${qi.vehicle_id}`)).rows;
  assert.equal(qRem.length, 1, 'oil-service reminder from the quick invoice'); assert.equal(qRem[0].due_mileage, 70000);
  assert.ok(qi.items.find((i) => i.kind === 'labor' && i.technician_id === tech.id), 'technician kept for commission');
  // same phone + same plate -> same customer and car
  const qi2 = await call('POST', '/api/invoices', { customer: { name: 'اسم مختلف', phone: '01299998888' }, vehicle: { plate: 'ق ر ب  55' }, items: [{ kind: 'other', description: 'x', unit_price: 10 }] });
  assert.equal(qi2.customer_id, qi.customer_id); assert.equal(qi2.vehicle_id, qi.vehicle_id);
  // nothing typed -> the cash customer (always the same one)
  const c1 = await call('POST', '/api/invoices', { items: [{ description: 'Coffee', unit_price: 20 }] });
  const c2 = await call('POST', '/api/invoices', { items: [{ description: 'Water', unit_price: 5 }] });
  assert.equal(c1.customer_id, c2.customer_id); assert.match(c1.customer.name, /Cash customer/);
  assert.equal(await custCount(), n0 + 2, 'only one cash customer');
  await call('POST', '/api/invoices', { items: [] }, { expect: 400 });
  // not enough stock -> nothing is created (no stray customer)
  await call('POST', '/api/invoices', { customer: { name: 'Ghost', phone: '0100000' }, items: [{ part_id: qPart.id, qty: 99, unit_price: 100 }] }, { expect: 400 });
  assert.equal(await custCount(), n0 + 2);

  // attachments
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const att = await call('POST', '/api/attachments', { ref_type: 'reception', ref_id: rec.id, mime: 'image/png', data: png });
  const img = await fetch(`${base}/uploads/${att.filename}`, { headers: { Cookie: cookie } });
  assert.equal(img.status, 200);
  const noAuth = await fetch(`${base}/uploads/${att.filename}`);
  assert.equal(noAuth.status, 401);
  await call('POST', '/api/attachments', { ref_type: 'reception', ref_id: rec.id, mime: 'text/html', data: 'PGh0bWw+' }, { expect: 400 });

  // static + path traversal
  const idx = await fetch(`${base}/`);
  assert.equal(idx.status, 200);
  const trav = await fetch(`${base}/..%2f..%2fserver/db.js`);
  assert.notEqual(trav.status, 200);
});
