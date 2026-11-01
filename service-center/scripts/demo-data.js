'use strict';
// Loads sample data through the API of a running server.
// Usage: node scripts/demo-data.js [http://localhost:3000] [username] [password]
const base = process.argv[2] || 'http://localhost:3000';
const username = process.argv[3] || 'admin';
const password = process.argv[4] || 'admin123';
let cookie = '';

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${url}: ${JSON.stringify(data)}`);
  return data;
}

(async () => {
  await call('POST', '/api/auth/login', { username, password });
  const emp = {};
  for (const [name, job, salary, lc, pc] of [['أحمد سمير', 'technician', 9000, 10, 2], ['محمود حسن', 'electrician', 9500, 12, 2], ['كريم عادل', 'technician', 7500, 8, 1],
    ['سارة محمد', 'advisor', 8000, 0, 0], ['ياسر علي', 'storekeeper', 6500, 0, 0], ['منى إبراهيم', 'accountant', 8500, 0, 0]]) {
    emp[name] = await call('POST', '/api/employees', { name, job, salary, labor_commission: lc, parts_commission: pc, phone: '010' + Math.floor(10000000 + Math.random() * 89999999) });
  }
  const supA = await call('POST', '/api/suppliers', { name: 'الشركة الألمانية لقطع الغيار', contact: 'م. هشام', phone: '01011112222' });
  const supB = await call('POST', '/api/suppliers', { name: 'Euro Parts Trading', contact: 'Mr. Adel', phone: '01233334444' });
  const parts = {};
  const P = [
    ['83212365946', 'زيت BMW LL-01 5W30 (لتر)', 'BMW Engine oil LL-01 5W30 (L)', 'Engine oil', 'liter', 30, 260, 420, 20],
    ['11428575211', 'فلتر زيت', 'Oil filter', 'Filters', 'pcs', 15, 320, 550, 5],
    ['64119382886', 'فلتر تكييف كربون', 'Microfilter activated carbon', 'Filters', 'set', 8, 650, 1100, 3],
    ['13718577170', 'فلتر هواء', 'Air filter', 'Filters', 'pcs', 6, 700, 1200, 3],
    ['34106888459', 'تيل فرامل أمامي', 'Front brake pads', 'Brakes', 'set', 4, 2600, 4200, 2],
    ['34106874766', 'طنبورة أمامي', 'Front brake disc', 'Brakes', 'pcs', 4, 3400, 5200, 2],
    ['34356890790', 'حساس تيل أمامي', 'Front brake wear sensor', 'Sensors', 'pcs', 6, 280, 500, 3],
    ['12120039664', 'بوجيه', 'Spark plug', 'Ignition', 'pcs', 12, 450, 800, 8],
    ['83132405977', 'زيت فرامل (لتر)', 'Brake fluid (L)', 'Fluids', 'liter', 10, 300, 550, 4],
    ['11537549476', 'ثرموستات', 'Thermostat', 'Cooling', 'pcs', 1, 2800, 4300, 2],
  ];
  for (const [no, ar, en, cat, unit, qty, cost, price, min] of P) {
    parts[no] = await call('POST', '/api/parts', { part_no: no, oem_no: no, name_ar: ar, name_en: en, category: cat, unit, qty, cost, price, min_qty: min, brand: 'BMW', supplier_id: supA.id, location: 'A-' + Math.ceil(Math.random() * 9) });
  }
  await call('POST', '/api/purchases', { supplier_id: supB.id, supplier_invoice_no: 'EP-5521', items: [{ part_id: parts['11428575211'].id, qty: 10, unit_cost: 310 }, { part_id: parts['83212365946'].id, qty: 40, unit_cost: 255 }] });

  const cars = [
    ['محمد عبد الله', '01001234567', 'ر ق م 1234', 'WBA8E9G50GNT10001', '3 Series', '320i', 'F30', 2016, 98000, 'أبيض'],
    ['شركة النيل للتجارة', '01112223334', 'س ط ع 5521', 'WBAJA7106KB30002', '5 Series', '530i', 'G30', 2019, 64000, 'أسود'],
    ['Ahmed Fouad', '01225556667', 'ن ب ل 777', '5UXCR6C0XL9B30003', 'X5', 'X5 xDrive40i', 'G05', 2021, 41000, 'Grey'],
    ['هبة مصطفى', '01098887776', 'ص و ر 3030', 'WBA5R1C50LFH30004', '3 Series', '330i', 'G20', 2020, 52000, 'أزرق'],
    ['Omar Khaled', '01557778889', 'م ح ع 909', 'WBAJB1104KB30005', 'X3', 'X3 xDrive30i', 'G01', 2018, 120000, 'White'],
  ];
  const vehicles = [];
  for (const [name, phone, plate, vin, series, model, ch, year, km, color] of cars) {
    const c = await call('POST', '/api/customers', { name, phone, type: name.includes('شركة') ? 'company' : 'individual' });
    vehicles.push(await call('POST', '/api/vehicles', { customer_id: c.id, plate, vin, series, model, chassis_code: ch, year, mileage: km, color, fuel: 'petrol', transmission: 'automatic' }));
  }
  const st = (await call('GET', '/api/service-types?limit=100')).rows;
  const S = (code) => st.find((s) => s.code === code);
  const accounts = (await call('GET', '/api/accounts')).rows;
  const tech1 = emp['أحمد سمير']; const tech2 = emp['محمود حسن']; const adv = emp['سارة محمد'];

  // 1) full job: delivered & paid
  let r = await call('POST', '/api/receptions', { vehicle_id: vehicles[0].id, mileage: 100200, fuel_level: '1/2', complaints: 'صيانة دورية + صوت في الفرامل الأمامية', warning_lights: 'service,brake', checklist: JSON.stringify({ items: 'spare_tyre,jack,mats', zones: 'rear_bumper', keys_count: 2 }), advisor_id: adv.id });
  await call('POST', '/api/diagnoses', { reception_id: r.id, technician_id: tech1.id, tool: 'ISTA+', fault_codes: '480A13', findings: 'تآكل تيل وطنابير الفرامل الأمامية', recommendations: 'تغيير تيل وطنابير أمامي + صيانة زيت', estimated_cost: 18000, approval: 'approved' });
  let w = await call('POST', `/api/receptions/${r.id}/work-order`, {});
  await call('POST', `/api/work-orders/${w.id}/labor`, { service_type_id: S('OIL').id, technician_id: tech1.id });
  await call('POST', `/api/work-orders/${w.id}/labor`, { service_type_id: S('BRK-F').id, technician_id: tech1.id });
  await call('POST', `/api/work-orders/${w.id}/parts`, { part_id: parts['83212365946'].id, qty: 5 });
  await call('POST', `/api/work-orders/${w.id}/parts`, { part_id: parts['11428575211'].id, qty: 1 });
  await call('POST', `/api/work-orders/${w.id}/parts`, { part_id: parts['34106888459'].id, qty: 1 });
  await call('POST', `/api/work-orders/${w.id}/parts`, { part_id: parts['34106874766'].id, qty: 2 });
  await call('POST', `/api/work-orders/${w.id}/status`, { status: 'in_progress' });
  await call('POST', `/api/work-orders/${w.id}/status`, { status: 'completed' });
  let inv = await call('POST', `/api/work-orders/${w.id}/invoice`, { discount: 200 });
  await call('POST', `/api/invoices/${inv.id}/payments`, { amount: inv.total, account_id: accounts[0].id, method: 'cash' });
  await call('POST', `/api/work-orders/${w.id}/status`, { status: 'delivered' });

  // 2) in progress job, electrical
  r = await call('POST', '/api/receptions', { vehicle_id: vehicles[2].id, mileage: 41500, fuel_level: '3/4', complaints: 'لمبة المحرك منورة وتقطيع في السرعات المنخفضة', warning_lights: 'engine', advisor_id: adv.id });
  await call('POST', '/api/diagnoses', { reception_id: r.id, technician_id: tech2.id, tool: 'ISTA+', fault_codes: '130308, 2A87', findings: 'عطل في بوجيهات السلندر 3', recommendations: 'تغيير طقم بوجيهات + كويل السلندر 3', estimated_cost: 9500 });
  w = await call('POST', `/api/receptions/${r.id}/work-order`, { priority: 'high' });
  await call('POST', `/api/work-orders/${w.id}/labor`, { service_type_id: S('ISTA').id, technician_id: tech2.id });
  await call('POST', `/api/work-orders/${w.id}/labor`, { service_type_id: S('SPARK').id, technician_id: tech2.id });
  await call('POST', `/api/work-orders/${w.id}/parts`, { part_id: parts['12120039664'].id, qty: 6 });
  await call('POST', `/api/work-orders/${w.id}/status`, { status: 'in_progress' });

  // 3) waiting parts
  r = await call('POST', '/api/receptions', { vehicle_id: vehicles[4].id, mileage: 121000, fuel_level: '1/4', complaints: 'ارتفاع حرارة المحرك', warning_lights: 'coolant', advisor_id: adv.id });
  w = await call('POST', `/api/receptions/${r.id}/work-order`, {});
  await call('POST', `/api/work-orders/${w.id}/labor`, { service_type_id: S('COOL').id, technician_id: emp['كريم عادل'].id });
  await call('POST', `/api/work-orders/${w.id}/parts`, { description: 'Water pump (external order)', qty: 1, unit_price: 14500, unit_cost: 11000 });
  await call('POST', `/api/work-orders/${w.id}/status`, { status: 'waiting_parts' });

  // 4) completed, partially paid
  r = await call('POST', '/api/receptions', { vehicle_id: vehicles[1].id, mileage: 65000, fuel_level: 'F', complaints: 'صيانة 60 ألف', advisor_id: adv.id });
  w = await call('POST', `/api/receptions/${r.id}/work-order`, {});
  await call('POST', `/api/work-orders/${w.id}/labor`, { service_type_id: S('OIL').id, technician_id: emp['كريم عادل'].id });
  await call('POST', `/api/work-orders/${w.id}/labor`, { service_type_id: S('MICRO').id, technician_id: emp['كريم عادل'].id });
  await call('POST', `/api/work-orders/${w.id}/parts`, { part_id: parts['83212365946'].id, qty: 6 });
  await call('POST', `/api/work-orders/${w.id}/parts`, { part_id: parts['11428575211'].id, qty: 1 });
  await call('POST', `/api/work-orders/${w.id}/parts`, { part_id: parts['64119382886'].id, qty: 1 });
  await call('POST', `/api/work-orders/${w.id}/status`, { status: 'completed' });
  inv = await call('POST', `/api/work-orders/${w.id}/invoice`, {});
  await call('POST', `/api/invoices/${inv.id}/payments`, { amount: 3000, account_id: accounts[2].id, method: 'card' });

  // appointments, reminders, expenses
  const today = new Date().toISOString().slice(0, 10);
  await call('POST', '/api/appointments', { customer_id: vehicles[3].customer_id, vehicle_id: vehicles[3].id, date: today, time: '11:00', service: 'Oil service + brake check', advisor_id: adv.id });
  await call('POST', '/api/reminders', { vehicle_id: vehicles[3].id, service_type_id: S('BRK-FL').id, title: 'Brake fluid', due_date: today, due_mileage: 54000 });
  await call('POST', '/api/transactions', { account_id: accounts[0].id, direction: 'out', amount: 15000, category: 'rent', description: 'إيجار الشهر' });
  await call('POST', '/api/transactions', { account_id: accounts[0].id, direction: 'out', amount: 1800, category: 'utilities', description: 'كهرباء' });
  await call('POST', '/api/bonuses', { employee_id: tech1.id, type: 'bonus', amount: 500, reason: 'تقييم عميل ممتاز' });
  console.log('Demo data loaded into', base);
})().catch((e) => { console.error(e.message); process.exit(1); });
