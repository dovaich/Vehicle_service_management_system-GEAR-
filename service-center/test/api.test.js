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
