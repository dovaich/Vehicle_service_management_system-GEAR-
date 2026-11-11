/* GEAR - Firebase backend (Spark / no-cost plan).
 * Implements the same /api routes as server/server.js, but in the browser on top of
 * Firebase Auth + Cloud Firestore. Activated when window.FIREBASE_CONFIG is set
 * (see /firebase-config.js). Access control is enforced by firestore.rules.
 */
import * as F from './vendor/firebase.mjs';

const CFG = window.FIREBASE_CONFIG;
if (CFG && CFG.apiKey) init();

function init() {
  const G = window.G;
  const app = F.initializeApp(CFG);
  const auth = F.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }), ignoreUndefinedProperties: true });
  } catch (_) {
    db = F.initializeFirestore(app, { localCache: F.memoryLocalCache(), ignoreUndefinedProperties: true });
  }
  if (CFG.emulator) {
    F.connectAuthEmulator(auth, `http://${CFG.emulator.auth || '127.0.0.1:9099'}`, { disableWarnings: true });
    const [h, p] = (CFG.emulator.firestore || '127.0.0.1:8080').split(':');
    F.connectFirestoreEmulator(db, h, Number(p));
  }
  const EMAIL_DOMAIN = CFG.userDomain || 'gear-users.app';

  // ------------------------------------------------------------------ utils
  class ApiError extends Error { constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra; } }
  const bad = (code, extra) => new ApiError(400, code, extra);
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const num = (n, d = 0) => (n === '' || n === null || n === undefined || isNaN(Number(n)) ? d : Number(n));
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const nowStr = () => { const d = new Date(); return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const addMonths = (s, n) => { const d = new Date(s.slice(0, 10) + 'T00:00:00'); d.setMonth(d.getMonth() + Number(n)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const clean = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v === '' ? null : v; return r; };

  const ref = (c, id) => F.doc(db, c, String(id));
  const newRef = (c) => F.doc(F.collection(db, c));
  const row = (s) => (s.exists() ? { ...s.data(), id: s.id } : null);
  const getRow = async (c, id) => (id ? row(await F.getDoc(ref(c, id))) : null);
  const mustRow = async (c, id) => { const r = await getRow(c, id); if (!r) throw new ApiError(404, 'not_found'); return r; };
  const rowsOf = (snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const q = (c, ...cons) => F.query(F.collection(db, c), ...cons);
  const W = F.where; const O = F.orderBy; const L = F.limit;
  const all = async (c, ...cons) => rowsOf(await F.getDocs(q(c, ...cons)));
  const inc = F.increment;

  // search keywords: lowercase tokens + their prefixes, for array-contains search
  const norm = (s) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  function keywords(...vals) {
    const set = new Set();
    for (const v of vals) {
      // words split on punctuation ("oil", "5w30") and whole codes ("oil-5w30") are both searchable
      const n = norm(v);
      for (const tok of [...n.split(/[\s,.\-_/|()]+/), ...n.split(/\s+/)].filter(Boolean)) {
        const w = tok.slice(0, 24);
        for (let i = 1; i <= w.length; i++) set.add(w.slice(0, i));
      }
    }
    return [...set].slice(0, 400);
  }

  // ------------------------------------------------------------------ auth
  const ROLES = ['admin', 'manager', 'advisor', 'technician', 'accountant', 'storekeeper'];
  const ANY = ROLES; const FRONT = ['admin', 'manager', 'advisor']; const SHOP = ['admin', 'manager', 'advisor', 'technician'];
  const MONEY = ['admin', 'manager', 'accountant']; const STORE = ['admin', 'manager', 'storekeeper']; const MGMT = ['admin', 'manager'];
  const SUPP = ['admin', 'manager', 'accountant', 'storekeeper']; const BILL = ['admin', 'manager', 'advisor', 'accountant'];
  let me = null;
  const loadMe = async (u) => {
    if (!u) { me = null; return; }
    const p = await getRow('users', u.uid).catch(() => null);
    me = p && p.active ? { ...p, id: u.uid } : null;
    if (me) me.roles = [...new Set([me.role, ...(Array.isArray(me.extra_roles) ? me.extra_roles : [])])];
  };
  const authReady = new Promise((resolve) => { const un = F.onAuthStateChanged(auth, async (u) => { un(); await loadMe(u); resolve(); }); });
  const hasAny = (roles) => !!me && me.roles.some((r) => roles.includes(r));
  const onlyIn = (roles) => !!me && me.roles.every((r) => roles.includes(r));
  const parseRoles = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter((x) => ROLES.includes(x));
  const publicMe = () => ({ id: me.id, username: me.username, name: me.name, role: me.role, roles: me.roles, employee_id: me.employee_id });
  const need = (roles) => { if (!me) throw new ApiError(401, 'unauthorized'); if (!hasAny(roles)) throw new ApiError(403, 'forbidden'); };
  const toEmail = (u) => `${String(u).trim().toLowerCase()}@${EMAIL_DOMAIN}`;

  // ------------------------------------------------------------------ caches (small collections)
  const cache = {};
  const emps = async (force) => { if (!cache.emps || force) cache.emps = await all('employees'); return cache.emps; };
  const empName = async (id) => (id ? ((await emps()).find((e) => e.id === String(id)) || {}).name || null : null);
  const settings = async (force) => { if (!cache.settings || force) cache.settings = (await getRow('settings', 'main')) || {}; return cache.settings; };
  const getSetting = async (k, d) => { const s = await settings(); return s[k] === undefined || s[k] === null || s[k] === '' ? d : s[k]; };

  async function nextNo(name, prefix) {
    const r = ref('counters', name);
    const n = await F.runTransaction(db, async (t) => {
      const s = await t.get(r);
      const v = (s.exists() ? s.data().n : 0) + 1;
      t.set(r, { n: v });
      return v;
    });
    return `${prefix}-${String(n).padStart(5, '0')}`;
  }
  async function audit(action, entity, id, details) {
    try {
      await F.setDoc(newRef('audit_log'), { user_id: me ? me.id : null, user_name: me ? me.name : null, action, entity, entity_id: id ? String(id) : null, details: details ? JSON.stringify(details).slice(0, 500) : null, created_at: nowStr() });
    } catch (_) { /* best effort */ }
  }

  // several service advisors per car: advisor_ids = "id1,id2"; advisor_id keeps the first
  async function setAdvisors(d) {
    if (d.advisor_ids === undefined && d.advisor_id === undefined) return;
    const ids = d.advisor_ids !== undefined ? [...new Set(String(d.advisor_ids || '').split(',').map((x) => x.trim()).filter(Boolean))] : (d.advisor_id ? [String(d.advisor_id)] : []);
    const e = await emps();
    d.advisor_ids = ids.join(',') || null;
    d.advisor_id = ids[0] || null;
    d.advisor_name = ids.map((id) => (e.find((x) => x.id === id) || {}).name).filter(Boolean).join('، ') || null;
  }

  // ------------------------------------------------------------------ denormalization helpers
  const vehicleInfo = (v) => ({ plate: v.plate || null, vin: v.vin || null, model: v.model || null, series: v.series || null, color: v.color || null, year: v.year || null });
  const custInfo = (c) => ({ customer_name: c.name || null, customer_phone: c.phone || null });

  // ------------------------------------------------------------------ resources
  const RES = {
    customers: {
      cols: ['name', 'phone', 'phone2', 'email', 'address', 'type', 'tax_no', 'notes'], required: ['name'],
      kw: (r) => [r.name, r.phone, r.phone2, r.email, r.tax_no, r.plates], order: ['created_at', 'desc'], filters: ['type'],
      read: ANY, write: FRONT,
      onCreate: (d) => { d.balance = 0; d.vehicles_count = 0; d.plates = ''; },
      async afterUpdate(id, d) {
        if (d.name === undefined && d.phone === undefined) return;
        const vs = await all('vehicles', W('customer_id', '==', id));
        const b = F.writeBatch(db);
        for (const v of vs) b.update(ref('vehicles', v.id), { customer_name: d.name, customer_phone: d.phone, kw: keywords(v.plate, v.vin, v.model, v.series, v.chassis_code, d.name, d.phone) });
        await b.commit();
      },
      async beforeDelete(id) { if ((await all('invoices', W('customer_id', '==', id), L(1))).length) throw bad('customer_has_invoices'); },
    },
    vehicles: {
      cols: ['customer_id', 'plate', 'vin', 'make', 'series', 'model', 'chassis_code', 'year', 'color', 'engine', 'fuel', 'transmission', 'mileage', 'warranty_until', 'notes'],
      required: ['customer_id'], kw: (r) => [r.plate, r.vin, r.model, r.series, r.chassis_code, r.customer_name, r.customer_phone],
      order: ['created_at', 'desc'], filters: ['customer_id', 'series'], read: ANY, write: FRONT,
      async beforeSave(d, old) {
        const cid = d.customer_id || (old && old.customer_id);
        if (d.customer_id && (!old || d.customer_id !== old.customer_id)) Object.assign(d, custInfo(await mustRow('customers', d.customer_id)));
        if (old && !d.customer_name) { d.customer_name = old.customer_name; d.customer_phone = old.customer_phone; }
        if (d.year) d.year = num(d.year); if (d.mileage !== undefined) d.mileage = num(d.mileage);
        d.customer_id = cid;
      },
      async afterCreate(id, d) { await F.updateDoc(ref('customers', d.customer_id), { vehicles_count: inc(1) }); await refreshPlates(d.customer_id); },
      async afterUpdate(id, d) { await refreshPlates(d.customer_id); },
      async beforeDelete(id) { if ((await all('invoices', W('vehicle_id', '==', id), L(1))).length) throw bad('vehicle_has_invoices'); },
      async afterDelete(id, old) { await F.updateDoc(ref('customers', old.customer_id), { vehicles_count: inc(-1) }).catch(() => {}); await refreshPlates(old.customer_id); },
    },
    employees: {
      cols: ['name', 'phone', 'job', 'national_id', 'hire_date', 'pay_type', 'pay_cycle', 'attendance_based', 'work_start', 'work_end', 'weekend_days', 'salary', 'labor_commission', 'parts_commission', 'active', 'notes'], required: ['name'],
      kw: (r) => [r.name, r.phone], order: ['name', 'asc'], small: true, filters: ['job', 'active'], read: ANY, write: MGMT,
      numeric: ['salary', 'labor_commission', 'parts_commission', 'active'], hideFor: { roles: ['advisor', 'technician', 'storekeeper'], cols: ['salary', 'national_id'] },
      after: () => { cache.emps = null; },
      async beforeDelete(id) { if ((await all('bonuses', W('employee_id', '==', id), L(1))).length) throw bad('employee_in_use'); },
    },
    service_types: {
      cols: ['code', 'name_ar', 'name_en', 'category', 'labor_hours', 'labor_price', 'interval_km', 'interval_months', 'active'], required: ['name_en'],
      kw: (r) => [r.code, r.name_ar, r.name_en, r.category], order: ['category', 'asc'], small: true, filters: ['category', 'active'],
      numeric: ['labor_hours', 'labor_price', 'interval_km', 'interval_months', 'active'], read: ANY, write: MGMT, after: () => { cache.st = null; },
    },
    appointments: {
      cols: ['customer_id', 'vehicle_id', 'date', 'time', 'service', 'advisor_id', 'status', 'notes'], required: ['customer_id', 'date'],
      kw: (r) => [r.customer_name, r.customer_phone, r.plate, r.service], order: ['date', 'desc'], dateCol: 'date', filters: ['status', 'customer_id', 'vehicle_id'],
      read: ANY, write: FRONT, defaults: { status: 'scheduled' },
      async beforeSave(d, old) {
        if (d.customer_id && (!old || d.customer_id !== old.customer_id)) Object.assign(d, custInfo(await mustRow('customers', d.customer_id)));
        if (d.vehicle_id !== undefined) { const v = d.vehicle_id ? await getRow('vehicles', d.vehicle_id) : null; Object.assign(d, { plate: v ? v.plate : null, model: v ? v.model : null, series: v ? v.series : null }); }
        if (d.advisor_id !== undefined) d.advisor_name = await empName(d.advisor_id);
      },
    },
    receptions: {
      cols: ['vehicle_id', 'customer_id', 'date', 'mileage', 'fuel_level', 'complaints', 'checklist', 'damages', 'belongings', 'warning_lights', 'advisor_id', 'advisor_ids', 'expected_delivery', 'driver_name', 'driver_phone', 'status', 'notes'],
      required: ['vehicle_id'], kw: (r) => [r.no, r.customer_name, r.customer_phone, r.plate, r.vin], order: ['date', 'desc'], dateCol: 'date',
      filters: ['status', 'vehicle_id', 'customer_id'], read: ANY, write: FRONT, defaults: { status: 'open' }, numeric: ['mileage'],
      async beforeSave(d, old) {
        if (d.vehicle_id && (!old || d.vehicle_id !== old.vehicle_id)) {
          const v = await mustRow('vehicles', d.vehicle_id);
          Object.assign(d, vehicleInfo(v), { customer_id: v.customer_id, customer_name: v.customer_name, customer_phone: v.customer_phone });
        }
        await setAdvisors(d);
        if (!old) { d.date = d.date || nowStr(); d.no = await nextNo('receptions', 'RC'); }
      },
      async afterCreate(id, d) { if (num(d.mileage) > 0) await bumpMileage(d.vehicle_id, num(d.mileage)); },
    },
    diagnoses: {
      cols: ['reception_id', 'vehicle_id', 'technician_id', 'date', 'tool', 'fault_codes', 'findings', 'recommendations', 'estimated_cost', 'estimated_hours', 'approval', 'notes'],
      required: ['vehicle_id'], kw: (r) => [r.plate, r.vin, r.customer_name, r.fault_codes, r.reception_no], order: ['date', 'desc'], dateCol: 'date',
      filters: ['approval', 'vehicle_id', 'reception_id', 'technician_id'], read: ANY, write: SHOP, defaults: { approval: 'pending' }, numeric: ['estimated_cost', 'estimated_hours'],
      async beforeSave(d, old) {
        if (d.reception_id && (!old || d.reception_id !== old.reception_id)) {
          const r = await getRow('receptions', d.reception_id);
          if (r) { d.reception_no = r.no; if (!d.vehicle_id) d.vehicle_id = r.vehicle_id; }
        }
        if (d.vehicle_id && (!old || d.vehicle_id !== old.vehicle_id)) { const v = await mustRow('vehicles', d.vehicle_id); Object.assign(d, vehicleInfo(v), { customer_name: v.customer_name, customer_phone: v.customer_phone }); }
        if (d.technician_id !== undefined) d.technician_name = await empName(d.technician_id);
        if (!old) d.date = d.date || nowStr();
      },
      async afterCreate(id, d) {
        if (d.reception_id) {
          const r = await getRow('receptions', d.reception_id);
          if (r) await F.updateDoc(ref('receptions', r.id), { diagnosis_id: id, ...(r.status === 'open' ? { status: 'diagnosed' } : {}) });
        }
      },
    },
    work_orders: {
      cols: ['reception_id', 'diagnosis_id', 'vehicle_id', 'customer_id', 'date', 'mileage', 'priority', 'bay', 'advisor_id', 'advisor_ids', 'description', 'qc_checklist', 'qc_by', 'notes'],
      required: ['vehicle_id'], kw: (r) => [r.no, r.customer_name, r.customer_phone, r.plate, r.vin], order: ['date', 'desc'], dateCol: 'date',
      filters: ['status', 'vehicle_id', 'customer_id', 'priority'], read: ANY, write: SHOP, numeric: ['mileage'],
      defaults: { status: 'open', priority: 'normal', active: true, labor: [], parts: [], labor_total: 0, parts_total: 0, technicians: '' },
      async beforeSave(d, old) {
        if (d.vehicle_id && (!old || d.vehicle_id !== old.vehicle_id)) {
          const v = await mustRow('vehicles', d.vehicle_id);
          Object.assign(d, vehicleInfo(v), { customer_id: v.customer_id, customer_name: v.customer_name, customer_phone: v.customer_phone });
        }
        await setAdvisors(d);
        if (!old) { d.date = d.date || nowStr(); d.no = await nextNo('work_orders', 'WO'); }
      },
      async afterCreate(id, d) {
        if (d.reception_id) {
          const r = await getRow('receptions', d.reception_id);
          if (r) await F.updateDoc(ref('receptions', r.id), { work_order_id: id, ...(['open', 'diagnosed'].includes(r.status) ? { status: 'in_work' } : {}) });
        }
      },
      async beforeDelete(id, old) {
        if (old.invoice_id) throw bad('work_order_invoiced');
        for (const p of old.parts || []) if (p.part_id) await stockMove(p.part_id, 'return', p.qty, p.unit_cost, 'work_order', id, 'WO deleted');
      },
    },
    suppliers: {
      cols: ['name', 'contact', 'phone', 'email', 'address', 'tax_no', 'opening_balance', 'notes'], required: ['name'],
      kw: (r) => [r.name, r.contact, r.phone, r.email], order: ['name', 'asc'], small: true, read: SUPP, write: SUPP, numeric: ['opening_balance'],
      onCreate: (d) => { d.balance = num(d.opening_balance); },
      onUpdate: (d, old) => { if (d.opening_balance !== undefined) d.balance = inc(r2(num(d.opening_balance) - num(old.opening_balance))); },
      async beforeDelete(id) { if ((await all('purchases', W('supplier_id', '==', id), L(1))).length) throw bad('supplier_has_purchases'); },
    },
    parts: {
      cols: ['part_no', 'oem_no', 'name_ar', 'name_en', 'category', 'brand', 'unit', 'min_qty', 'cost', 'price', 'location', 'supplier_id', 'active', 'notes'],
      required: ['name_en'], kw: (r) => [r.part_no, r.oem_no, r.name_ar, r.name_en, r.category, r.brand, r.location], order: ['name_en', 'asc'],
      filters: ['category', 'supplier_id', 'active'], special: { low: ['low', '==', true] }, read: ANY, write: STORE, numeric: ['min_qty', 'cost', 'price', 'active'],
      hideFor: { roles: ['advisor', 'technician'], cols: ['cost', 'stock_value'] }, defaults: { active: 1, unit: 'pcs' },
      async beforeSave(d, old) {
        if (d.supplier_id !== undefined) { const s = d.supplier_id ? await getRow('suppliers', d.supplier_id) : null; d.supplier_name = s ? s.name : null; }
        if (!old) { d._opening = num(d.qty_open); d.qty = 0; }
        const qty = old ? old.qty : 0; const min = d.min_qty !== undefined ? num(d.min_qty) : old ? old.min_qty : 0;
        d.low = qty <= min;
      },
      async afterCreate(id, d) { if (d._opening > 0) await stockMove(id, 'in', d._opening, num(d.cost), 'opening', null, 'Opening stock'); },
    },
    stock_moves: { cols: [], kw: (r) => [r.part_no, r.name_en, r.name_ar, r.notes, r.ref_type], order: ['date', 'desc'], dateCol: 'date', filters: ['part_id', 'type'], read: SUPP, write: [], noCreate: true, noUpdate: true, noDelete: true },
    purchases: {
      cols: ['supplier_invoice_no', 'notes', 'date'], kw: (r) => [r.no, r.supplier_invoice_no, r.supplier_name], order: ['created_at', 'desc'], dateCol: 'date',
      filters: ['supplier_id', 'status', 'is_return'], read: SUPP, write: SUPP, noCreate: true, noDelete: true,
    },
    invoices: {
      cols: ['notes'], kw: (r) => [r.no, r.customer_name, r.customer_phone, r.plate, r.work_order_no], order: ['created_at', 'desc'], dateCol: 'date',
      filters: ['status', 'customer_id', 'vehicle_id'], special: { unpaid: ['open', '==', true] }, read: BILL, write: BILL, noCreate: true, noDelete: true,
    },
    accounts: {
      cols: ['name', 'type', 'opening_balance', 'active'], required: ['name'], kw: (r) => [r.name], order: ['created_at', 'asc'], small: true, filters: ['active'],
      read: MONEY, write: MGMT, numeric: ['opening_balance', 'active'], defaults: { active: 1, type: 'cash' },
      onCreate: (d) => { d.balance = num(d.opening_balance); },
      onUpdate: (d, old) => { if (d.opening_balance !== undefined) d.balance = inc(r2(num(d.opening_balance) - num(old.opening_balance))); },
      async beforeDelete(id) { if ((await all('transactions', W('account_id', '==', id), L(1))).length) throw bad('account_has_transactions'); },
    },
    transactions: {
      cols: ['date', 'account_id', 'direction', 'amount', 'category', 'description', 'method', 'party_type', 'party_id'], required: ['account_id', 'direction', 'amount', 'category'],
      kw: (r) => [r.description, r.category, r.account_name, r.party_name], order: ['date', 'desc'], dateCol: 'date',
      filters: ['account_id', 'direction', 'category', 'party_type', 'party_id'], read: MONEY, write: MONEY, noUpdate: true, deleteRoles: ['admin', 'manager', 'accountant'],
      async beforeDelete(id, t) {
        if (t.ref_type && t.ref_type !== 'transfer') throw bad('linked_transaction');
        if (t.ref_type === 'transfer') {
          for (const o of await all('transactions', W('ref_type', '==', 'transfer'), W('ref_id', '==', t.ref_id))) if (o.id !== id) await removeTx(o);
        }
        await F.updateDoc(ref('accounts', t.account_id), { balance: inc(t.direction === 'in' ? -t.amount : t.amount) });
        if (t.party_type === 'supplier' && t.party_id) await F.updateDoc(ref('suppliers', t.party_id), { balance: inc(t.direction === 'out' ? t.amount : -t.amount) });
      },
    },
    bonuses: {
      cols: ['employee_id', 'date', 'period', 'type', 'amount', 'reason'], required: ['employee_id', 'amount'], kw: (r) => [r.employee_name, r.reason, r.period],
      order: ['date', 'desc'], dateCol: 'date', filters: ['employee_id', 'type', 'paid', 'period'], read: MONEY, write: MONEY, numeric: ['amount'],
      defaults: { type: 'bonus', paid: 0 }, deleteRoles: ['admin', 'manager', 'accountant'],
      async beforeSave(d) {
        if (d.type === 'advance') throw bad('use_advance_form'); // advances move cash: /api/advances
        if (d.employee_id) { const e = (await emps()).find((x) => x.id === String(d.employee_id)); d.employee_name = e ? e.name : null; d.job = e ? e.job : null; }
        if (d.date === null) d.date = today();
      },
      async beforeDelete(id, b) {
        if (b.paid) throw bad('already_paid');
        // deleting an unsettled advance gives the money back to the cash account
        if (b.type === 'advance' && b.transaction_id) { const t = await getRow('transactions', b.transaction_id); if (t) await removeTx(t); }
      },
    },
    reminders: {
      cols: ['vehicle_id', 'customer_id', 'service_type_id', 'title', 'due_date', 'due_mileage', 'status', 'notes'], required: ['vehicle_id'],
      kw: (r) => [r.plate, r.customer_name, r.customer_phone, r.title, r.service_name_ar, r.service_name_en], order: ['due_date', 'asc'], dateCol: 'due_date',
      filters: ['status', 'vehicle_id', 'customer_id'], read: ANY, write: FRONT, numeric: ['due_mileage'], defaults: { status: 'pending' },
      async beforeSave(d, old) {
        if (d.vehicle_id && (!old || d.vehicle_id !== old.vehicle_id)) {
          const v = await mustRow('vehicles', d.vehicle_id);
          Object.assign(d, { customer_id: v.customer_id, customer_name: v.customer_name, customer_phone: v.customer_phone, plate: v.plate, model: v.model, series: v.series, current_mileage: v.mileage || 0 });
        }
        if (d.service_type_id !== undefined) {
          const s = d.service_type_id ? await getRow('service_types', d.service_type_id) : null;
          d.service_name_ar = s ? s.name_ar : null; d.service_name_en = s ? s.name_en : null;
        }
        if (d.status === 'contacted') d.contacted_at = nowStr();
        const st = d.status || (old && old.status) || 'pending';
        d.open = ['pending', 'contacted', 'booked'].includes(st);
        const dm = d.due_mileage !== undefined ? d.due_mileage : old && old.due_mileage;
        const cm = d.current_mileage !== undefined ? d.current_mileage : old && old.current_mileage;
        d.km_due = !!(dm && cm && cm >= dm - 1000) && d.open;
      },
    },
  };
  const hide = (def, rows) => { if (def.hideFor && onlyIn(def.hideFor.roles)) for (const r of rows) for (const c of def.hideFor.cols) delete r[c]; return rows; };
  const decorate = (name, r) => {
    if (name === 'parts') r.stock_value = r2(num(r.qty) * num(r.cost));
    if (name === 'invoices') r.due = r2(num(r.total) - num(r.paid));
    return r;
  };

  async function refreshPlates(customerId) {
    if (!customerId) return;
    const c = await getRow('customers', customerId); if (!c) return;
    const vs = await all('vehicles', W('customer_id', '==', customerId));
    const plates = vs.map((v) => `${v.plate || ''} ${v.vin || ''}`).join(' ');
    await F.updateDoc(ref('customers', customerId), { plates, kw: keywords(c.name, c.phone, c.phone2, c.email, c.tax_no, plates) });
  }
  async function bumpMileage(vehicleId, km) {
    const v = await getRow('vehicles', vehicleId);
    if (!v || num(v.mileage) >= km) return;
    await F.updateDoc(ref('vehicles', vehicleId), { mileage: km });
    const rems = await all('reminders', W('vehicle_id', '==', vehicleId), W('open', '==', true));
    for (const r of rems) await F.updateDoc(ref('reminders', r.id), { current_mileage: km, km_due: !!(r.due_mileage && km >= r.due_mileage - 1000) });
  }

  // list with Firestore-friendly queries (no composite indexes needed except those in firestore.indexes.json)
  const cursors = new Map();
  async function listResource(name, def, qs) {
    const filters = (def.filters || []).filter((k) => qs[k] !== undefined && qs[k] !== '');
    const fval = (k) => { const v = qs[k]; return ['active', 'paid', 'is_return'].includes(k) ? Number(v) : v; };
    const lim = Math.min(num(qs.limit, 100), 2000);
    const offset = num(qs.offset, 0);
    const term = norm(String(qs.q || '').trim());
    const specials = Object.entries(def.special || {}).filter(([k]) => qs[k] === '1').map(([, s]) => s);
    let rows; let total; let paged = false;
    const ord = (a, b) => { const [f, dir] = def.order; const x = a[f] ?? ''; const y = b[f] ?? ''; return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); };
    if (def.small) {
      rows = await all(colName(name));
    } else if (term) {
      rows = await all(colName(name), W('kw', 'array-contains', term.split(/\s+/)[0]), L(500));
    } else if (def.dateCol && (qs.from || qs.to)) {
      const cons = [];
      if (qs.from) cons.push(W(def.dateCol, '>=', qs.from));
      if (qs.to) cons.push(W(def.dateCol, '<=', qs.to + ''));
      rows = await all(colName(name), ...cons, O(def.dateCol, 'desc'), L(1000));
    } else if (filters.length || specials.length) {
      rows = await all(colName(name), ...filters.map((k) => W(k, '==', fval(k))), ...specials.map((s) => W(...s)), L(1000));
    } else {
      paged = true;
      const key = name + ':' + offset;
      const cons = [O(...def.order)];
      if (offset && cursors.get(key)) cons.push(F.startAfter(cursors.get(key)));
      const snap = await F.getDocs(q(colName(name), ...cons, L(lim)));
      if (snap.docs.length) cursors.set(name + ':' + (offset + snap.docs.length), snap.docs[snap.docs.length - 1]);
      rows = rowsOf(snap);
      total = (await F.getCountFromServer(q(colName(name)))).data().count;
    }
    if (!paged) {
      const terms = term ? term.split(/\s+/) : [];
      rows = rows.filter((r) => filters.every((k) => String(r[k] ?? '') === String(fval(k)))
        && specials.every(([f, , v]) => r[f] === v)
        && (!def.dateCol || ((!qs.from || String(r[def.dateCol] || '').slice(0, 10) >= qs.from) && (!qs.to || String(r[def.dateCol] || '').slice(0, 10) <= qs.to)))
        && terms.every((tm) => (r.kw || []).includes(tm)));
      rows.sort(ord);
      total = rows.length;
      rows = rows.slice(offset, offset + lim);
    }
    rows.forEach((r) => { delete r.kw; decorate(name, r); });
    return { rows: hide(def, rows), total };
  }
  const colName = (name) => name;

  async function getResource(name, id) {
    const def = RES[name];
    const r = await mustRow(name, id);
    delete r.kw;
    return hide(def, [decorate(name, r)])[0];
  }
  function pick(body, cols) { const o = {}; for (const c of cols) if (body[c] !== undefined) o[c] = body[c] === '' ? null : body[c]; return o; }
  function numify(def, d) { for (const c of def.numeric || []) if (d[c] !== undefined && d[c] !== null) d[c] = num(d[c]); }

  async function createResource(name, body) {
    const def = RES[name];
    if (def.noCreate) throw new ApiError(405, 'not_allowed');
    const d = { ...(def.defaults || {}), ...pick(body, def.cols) };
    if (name === 'parts') d.qty_open = body.qty;
    numify(def, d);
    if (def.beforeSave) await def.beforeSave(d, null);
    for (const k of def.required || []) if (d[k] === undefined || d[k] === null || d[k] === '') throw bad('required', { field: k });
    if (def.onCreate) def.onCreate(d);
    d.created_at = nowStr();
    const r = newRef(name);
    const extra = { _opening: d._opening, qty_open: d.qty_open };
    delete d._opening; delete d.qty_open;
    d.kw = keywords(...def.kw(d));
    await F.setDoc(r, clean(d));
    if (def.afterCreate) await def.afterCreate(r.id, { ...d, ...extra });
    if (def.after) def.after();
    await audit('create', name, r.id);
    return getResource(name, r.id);
  }
  async function updateResource(name, id, body) {
    const def = RES[name];
    if (def.noUpdate) throw new ApiError(405, 'not_allowed');
    const old = await mustRow(name, id);
    const d = pick(body, def.cols);
    numify(def, d);
    for (const k of def.required || []) if (d[k] === null || d[k] === '') throw bad('required', { field: k });
    if (def.beforeSave) await def.beforeSave(d, old);
    if (def.onUpdate) def.onUpdate(d, old);
    const merged = { ...old, ...d };
    d.kw = keywords(...def.kw(merged));
    await F.updateDoc(ref(name, id), clean(d));
    if (def.afterUpdate) await def.afterUpdate(id, merged, old);
    if (def.after) def.after();
    await audit('update', name, id);
    return getResource(name, id);
  }
  async function deleteResource(name, id) {
    const def = RES[name];
    if (def.noDelete) throw new ApiError(405, 'not_allowed');
    const old = await mustRow(name, id);
    if (def.beforeDelete) await def.beforeDelete(id, old);
    if (name === 'parts') {
      if ((await all('stock_moves', W('part_id', '==', id), L(50))).some((m) => ['work_order', 'purchase', 'invoice'].includes(m.ref_type))) throw bad('part_in_use');
    }
    await F.deleteDoc(ref(name, id));
    if (def.afterDelete) await def.afterDelete(id, old);
    if (def.after) def.after();
    await audit('delete', name, id);
    return { ok: true };
  }
  async function removeTx(t) {
    await F.deleteDoc(ref('transactions', t.id));
    await F.updateDoc(ref('accounts', t.account_id), { balance: inc(t.direction === 'in' ? -t.amount : t.amount) });
  }

  // ------------------------------------------------------------------ stock
  async function stockMove(partId, type, qty, unitCost, refType, refId, notes) {
    qty = Number(qty) || 0;
    if (!qty) return;
    const pr = ref('parts', partId);
    await F.runTransaction(db, async (t) => {
      const s = await t.get(pr);
      if (!s.exists()) throw bad('part_not_found');
      const p = s.data();
      let delta = qty;
      if (type === 'out') delta = -Math.abs(qty); else if (type === 'in' || type === 'return') delta = Math.abs(qty);
      const newQty = r2(num(p.qty) + delta);
      if (newQty < 0 && String(await getSetting('allow_negative_stock', '0')) !== '1') throw bad('insufficient_stock', { part: p.name_en, available: p.qty });
      let cost = num(p.cost);
      if (type === 'in' && refType !== 'return' && unitCost > 0) cost = num(p.qty) > 0 ? r2((num(p.qty) * cost + delta * unitCost) / (num(p.qty) + delta)) : r2(unitCost);
      t.update(pr, { qty: newQty, cost, low: newQty <= num(p.min_qty) });
      t.set(newRef('stock_moves'), clean({
        part_id: String(partId), part_no: p.part_no || null, name_en: p.name_en || null, name_ar: p.name_ar || null, date: nowStr(), type, qty: delta,
        unit_cost: r2(unitCost || cost), ref_type: refType || null, ref_id: refId ? String(refId) : null, notes: notes || null, user_id: me.id, user_name: me.name,
        kw: keywords(p.part_no, p.name_en, p.name_ar, notes, refType),
      }));
    });
  }

  // ------------------------------------------------------------------ transactions (cash)
  async function addTx(t) {
    const acc = await mustRow('accounts', t.account_id);
    let partyName = null;
    if (t.party_type && t.party_id) partyName = ((await getRow(t.party_type === 'employee' ? 'employees' : t.party_type === 'supplier' ? 'suppliers' : 'customers', t.party_id)) || {}).name || null;
    const d = clean({
      date: t.date || today(), account_id: String(t.account_id), account_name: acc.name, direction: t.direction, amount: r2(t.amount), signed: t.direction === 'in' ? r2(t.amount) : -r2(t.amount),
      category: t.category, description: t.description || null, ref_type: t.ref_type || null, ref_id: t.ref_id ? String(t.ref_id) : null, party_type: t.party_type || null,
      party_id: t.party_id ? String(t.party_id) : null, party_name: partyName, method: t.method || null, period: t.period || null, salary_part: t.salary_part ?? null, user_id: me.id, user_name: me.name, created_at: nowStr(),
      is_expense: t.direction === 'out' && !['transfer', 'supplier_payment', 'refund'].includes(t.category),
    });
    d.kw = keywords(d.description, d.category, d.account_name, d.party_name);
    const r = newRef('transactions');
    const b = F.writeBatch(db);
    b.set(r, d);
    b.update(ref('accounts', d.account_id), { balance: inc(d.signed) });
    if (d.party_type === 'supplier' && d.party_id) b.update(ref('suppliers', d.party_id), { balance: inc(d.direction === 'out' ? -d.amount : d.amount) });
    await b.commit();
    return { ...d, id: r.id };
  }

  // ------------------------------------------------------------------ work orders
  const WO_STATUSES = ['open', 'in_progress', 'waiting_parts', 'waiting_approval', 'quality_check', 'completed', 'delivered', 'cancelled'];
  const woIdOf = (lineId) => String(lineId).split('_')[0];
  async function woFull(id) {
    const wo = await getResource('work_orders', id);
    const sts = await serviceTypes();
    const e = await emps();
    wo.labor = (wo.labor || []).map((l) => { const s = sts.find((x) => x.id === l.service_type_id) || {}; return { ...l, technician_name: (e.find((x) => x.id === l.technician_id) || {}).name || null, service_name_ar: s.name_ar, service_name_en: s.name_en, service_code: s.code }; });
    wo.parts = (wo.parts || []).map((p) => ({ ...p, technician_name: (e.find((x) => x.id === p.technician_id) || {}).name || null }));
    if (onlyIn(['advisor', 'technician'])) wo.parts.forEach((p) => delete p.unit_cost);
    wo.vehicle = await getRow('vehicles', wo.vehicle_id) || {};
    wo.customer = await getRow('customers', wo.customer_id) || {};
    delete wo.vehicle.kw; delete wo.customer.kw;
    wo.reception = wo.reception_id ? await getRow('receptions', wo.reception_id) : null;
    wo.diagnosis = wo.diagnosis_id ? await getRow('diagnoses', wo.diagnosis_id) : wo.reception && wo.reception.diagnosis_id ? await getRow('diagnoses', wo.reception.diagnosis_id) : null;
    wo.attachments = [];
    return wo;
  }
  const serviceTypes = async () => { if (!cache.st) cache.st = await all('service_types'); return cache.st; };
  async function saveLines(id, labor, parts) {
    const e = await emps();
    const techs = [...new Set(labor.map((l) => (e.find((x) => x.id === l.technician_id) || {}).name).filter(Boolean))].join(',');
    await F.updateDoc(ref('work_orders', id), { labor, parts, labor_total: r2(labor.reduce((s, l) => s + l.amount, 0)), parts_total: r2(parts.reduce((s, l) => s + l.amount, 0)), technicians: techs });
  }
  async function editableWo(id) {
    const w = await mustRow('work_orders', id);
    if (w.invoice_id) throw bad('work_order_invoiced');
    if (['delivered', 'cancelled'].includes(w.status)) throw bad('work_order_closed');
    return w;
  }
  async function setWoStatus(id, status) {
    if (!WO_STATUSES.includes(status)) throw bad('invalid_status');
    const w = await mustRow('work_orders', id);
    const upd = { status, active: !['delivered', 'cancelled'].includes(status) };
    if (status === 'in_progress' && !w.started_at) upd.started_at = nowStr();
    if (status === 'completed') upd.completed_at = nowStr();
    if (status === 'delivered') { upd.delivered_at = nowStr(); if (!w.completed_at) upd.completed_at = nowStr(); }
    if (status === 'cancelled') {
      if (w.invoice_id) throw bad('work_order_invoiced');
      for (const p of w.parts || []) if (p.part_id) await stockMove(p.part_id, 'return', p.qty, p.unit_cost, 'work_order', id, 'WO cancelled');
      upd.parts = []; upd.parts_total = 0;
    }
    await F.updateDoc(ref('work_orders', id), upd);
    if ((status === 'completed' || status === 'delivered') && !['completed', 'delivered'].includes(w.status)) {
      await generateReminders(w);
      if (num(w.mileage) > 0) await bumpMileage(w.vehicle_id, num(w.mileage));
    }
    if (w.reception_id) {
      const map = { completed: 'done', delivered: 'delivered', cancelled: 'cancelled', in_progress: 'in_work' };
      if (map[status]) await F.updateDoc(ref('receptions', w.reception_id), { status: map[status] }).catch(() => {});
    }
    await audit('status:' + status, 'work_orders', id);
  }
  async function generateReminders(w) {
    const v = await getRow('vehicles', w.vehicle_id); if (!v) return;
    const mileage = num(w.mileage) || num(v.mileage);
    const date = today();
    const sts = await serviceTypes();
    const ids = [...new Set((w.labor || []).map((l) => l.service_type_id).filter(Boolean))];
    const avg = num(await getSetting('avg_km_per_month', '1500'), 1500);
    for (const sid of ids) {
      const s = sts.find((x) => x.id === sid);
      if (!s || !(num(s.interval_km) > 0 || num(s.interval_months) > 0)) continue;
      for (const o of await all('reminders', W('vehicle_id', '==', v.id), W('service_type_id', '==', s.id), W('open', '==', true))) {
        await F.updateDoc(ref('reminders', o.id), { status: 'done', open: false, km_due: false });
      }
      const dueMileage = num(s.interval_km) > 0 && mileage ? mileage + num(s.interval_km) : null;
      let dueDate = num(s.interval_months) > 0 ? addMonths(date, s.interval_months) : null;
      if (num(s.interval_km) > 0 && avg > 0) { const byKm = addMonths(date, Math.max(1, Math.round(s.interval_km / avg))); if (!dueDate || byKm < dueDate) dueDate = byKm; }
      const d = clean({
        vehicle_id: v.id, customer_id: v.customer_id, customer_name: v.customer_name, customer_phone: v.customer_phone, plate: v.plate, model: v.model, series: v.series,
        current_mileage: mileage || 0, service_type_id: s.id, service_name_ar: s.name_ar, service_name_en: s.name_en, title: `${s.name_ar} / ${s.name_en}`,
        due_date: dueDate, due_mileage: dueMileage, last_service_date: date, last_mileage: mileage || null, work_order_id: w.id, status: 'pending', open: true, km_due: false, created_at: nowStr(),
      });
      d.kw = keywords(d.plate, d.customer_name, d.customer_phone, d.title);
      await F.setDoc(newRef('reminders'), d);
    }
  }

  // ------------------------------------------------------------------ invoices
  function totals(items, discount, taxRate) {
    const labor = r2(items.filter((i) => i.kind === 'labor').reduce((s, i) => s + i.amount, 0));
    const parts = r2(items.filter((i) => i.kind !== 'labor').reduce((s, i) => s + i.amount, 0));
    const partsCost = r2(items.filter((i) => i.kind === 'part').reduce((s, i) => s + i.qty * (i.unit_cost || 0), 0));
    const subtotal = r2(labor + parts);
    const disc = Math.min(r2(discount), subtotal);
    const tax = r2((subtotal - disc) * (num(taxRate) / 100));
    return { labor_total: labor, parts_total: parts, parts_cost: partsCost, subtotal, discount: disc, tax_rate: num(taxRate), tax, total: r2(subtotal - disc + tax) };
  }
  const invStatus = (total, paid, cancelled) => (cancelled ? 'cancelled' : total === 0 ? 'paid' : paid <= 0 ? 'unpaid' : paid + 0.009 >= total ? 'paid' : 'partial');
  async function invoiceFull(id) {
    const inv = await getResource('invoices', id);
    const e = await emps();
    inv.items = (inv.items || []).map((i) => ({ ...i, technician_name: (e.find((x) => x.id === i.technician_id) || {}).name || null }));
    inv.payments = (await all('transactions', W('ref_type', '==', 'invoice'), W('ref_id', '==', String(id)))).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    inv.customer = await getRow('customers', inv.customer_id) || {};
    inv.vehicle = inv.vehicle_id ? await getRow('vehicles', inv.vehicle_id) : null;
    inv.work_order = inv.work_order_id ? await getRow('work_orders', inv.work_order_id) : null;
    if (inv.work_order) inv.work_order = { id: inv.work_order.id, no: inv.work_order.no, mileage: inv.work_order.mileage, date: inv.work_order.date };
    if (!hasAny(MONEY)) { delete inv.parts_cost; inv.items.forEach((i) => delete i.unit_cost); }
    return inv;
  }
  async function createInvoice({ customer_id, vehicle_id, work_order_id, work_order_no, date, discount, tax_rate, notes, items }) {
    const c = await mustRow('customers', customer_id);
    const v = vehicle_id ? await getRow('vehicles', vehicle_id) : null;
    const tr = tax_rate !== undefined && tax_rate !== '' && tax_rate !== null ? num(tax_rate) : num(await getSetting('vat_rate', '0'));
    const tt = totals(items, discount, tr);
    const no = await nextNo('invoices', 'INV');
    const d = clean({
      no, work_order_id: work_order_id || null, work_order_no: work_order_no || null, customer_id: c.id, customer_name: c.name, customer_phone: c.phone, vehicle_id: v ? v.id : null,
      plate: v ? v.plate : null, model: v ? v.model : null, series: v ? v.series : null, date: date || today(), notes: notes || null, items, ...tt, paid: 0,
      status: invStatus(tt.total, 0), open: tt.total > 0, total_eff: tt.total, created_at: nowStr(),
    });
    d.kw = keywords(d.no, d.customer_name, d.customer_phone, d.plate, d.work_order_no);
    const r = newRef('invoices');
    const b = F.writeBatch(db);
    b.set(r, d);
    b.update(ref('customers', c.id), { balance: inc(tt.total) });
    if (work_order_id) b.update(ref('work_orders', work_order_id), { invoice_id: r.id, invoice_no: no, invoice_status: d.status });
    await b.commit();
    return r.id;
  }
  async function invoiceFromWo(woId, body) {
    const w = await mustRow('work_orders', woId);
    if (w.invoice_id) throw bad('work_order_invoiced');
    if (w.status === 'cancelled') throw bad('work_order_closed');
    if (!(w.labor || []).length && !(w.parts || []).length) throw bad('work_order_empty');
    const sts = await serviceTypes();
    const items = [
      ...(w.labor || []).map((l) => { const s = sts.find((x) => x.id === l.service_type_id) || {}; return { kind: 'labor', description: l.description || [s.name_ar, s.name_en].filter(Boolean).join(' / '), qty: l.hours, unit_price: l.rate, unit_cost: 0, amount: l.amount, part_id: null, technician_id: l.technician_id || null }; }),
      ...(w.parts || []).map((p) => ({ kind: p.part_id ? 'part' : 'other', description: p.description || [p.part_no, p.name_en, p.name_ar].filter(Boolean).join(' - '), qty: p.qty, unit_price: p.unit_price, unit_cost: p.unit_cost || 0, amount: p.amount, part_id: p.part_id || null, technician_id: p.technician_id || null })),
    ];
    const id = await createInvoice({ customer_id: w.customer_id, vehicle_id: w.vehicle_id, work_order_id: w.id, work_order_no: w.no, date: body.date, discount: body.discount, tax_rate: body.tax_rate, notes: body.notes, items });
    if (body.payment && num(body.payment.amount) > 0) await addInvoicePayment(id, body.payment);
    await audit('create', 'invoices', id, { from_wo: woId });
    return invoiceFull(id);
  }
  // Quick invoice customer: picked, existing with the same phone, new from the typed name / phone, or the cash customer
  const CASH_CUSTOMER = 'عميل نقدي / Cash customer';
  async function resolveCustomer(body) {
    if (body.customer_id) return (await mustRow('customers', body.customer_id)).id;
    const c = body.customer || {};
    const name = String(c.name || '').trim(); const phone = String(c.phone || '').trim();
    if (phone) {
      const ex = (await all('customers', W('phone', '==', phone), L(1)))[0] || (await all('customers', W('phone2', '==', phone), L(1)))[0];
      if (ex) return ex.id;
    }
    if (name || phone) {
      return (await createResource('customers', { name: name || phone, phone: phone || null, email: c.email || null, address: c.address || null, tax_no: c.tax_no || null, type: c.tax_no ? 'company' : 'individual', notes: 'Created from a quick invoice' })).id;
    }
    const cash = (await all('customers', W('is_cash', '==', true), L(1)))[0];
    if (cash) return cash.id;
    const nc = await createResource('customers', { name: CASH_CUSTOMER, type: 'individual', notes: 'Walk-in / cash sales' });
    await F.updateDoc(ref('customers', nc.id), { is_cash: true });
    return nc.id;
  }
  // Quick invoice vehicle (optional): picked, the customer's car with the same plate, or a new one
  async function resolveVehicle(body, customerId) {
    const v = body.vehicle || {};
    const km = num(v.mileage ?? body.mileage);
    let id = body.vehicle_id || null;
    const plate = String(v.plate || '').trim();
    const flat = (x) => String(x || '').replace(/\s+/g, '');
    if (!id && plate) { const ex = (await all('vehicles', W('customer_id', '==', customerId))).find((x) => flat(x.plate) === flat(plate)); if (ex) id = ex.id; }
    if (!id && (plate || v.vin || v.model)) {
      id = (await createResource('vehicles', { customer_id: customerId, plate: plate || null, vin: v.vin || null, make: v.make || 'BMW', series: v.series || null, model: v.model || null, year: v.year || null, mileage: km || 0 })).id;
    }
    if (id && km > 0) await bumpMileage(id, km);
    return id;
  }
  async function manualInvoice(body) {
    const src = (Array.isArray(body.items) ? body.items : []).filter((i) => i.description || i.part_id || i.service_type_id);
    if (!src.length) throw bad('invoice_empty');
    const sts = await serviceTypes();
    const services = [];
    const items = [];
    for (const it of src) {
      const qty = num(it.qty, 1);
      if (it.service_type_id && !it.part_id) {
        const st = sts.find((x) => x.id === String(it.service_type_id));
        if (st) services.push(st.id);
        items.push({ kind: 'labor', description: it.description || (st ? `${st.name_ar} / ${st.name_en}` : ''), qty, unit_price: r2(it.unit_price), unit_cost: 0, amount: r2(qty * num(it.unit_price)), part_id: null, technician_id: it.technician_id ? String(it.technician_id) : null });
        continue;
      }
      if (it.part_id) {
        const p = await mustRow('parts', it.part_id);
        items.push({ kind: 'part', description: it.description || [p.part_no, p.name_en, p.name_ar].filter(Boolean).join(' - '), qty, unit_price: r2(it.unit_price), unit_cost: p.cost || 0, amount: r2(qty * num(it.unit_price)), part_id: p.id, technician_id: it.technician_id || null });
      } else items.push({ kind: it.kind || 'other', description: it.description, qty, unit_price: r2(it.unit_price), unit_cost: 0, amount: r2(qty * num(it.unit_price)), part_id: null, technician_id: it.technician_id || null });
    }
    // stock first (it can refuse), then the customer / vehicle, so a refusal never leaves a stray customer
    for (const it of items) if (it.part_id) {
      const p = await mustRow('parts', it.part_id);
      if (num(p.qty) < it.qty && String(await getSetting('allow_negative_stock', '0')) !== '1') throw bad('insufficient_stock', { part: p.name_en, available: p.qty });
    }
    const customerId = await resolveCustomer(body);
    const vehicleId = await resolveVehicle(body, customerId);
    for (const it of items) if (it.part_id) await stockMove(it.part_id, 'out', it.qty, it.unit_cost, 'invoice', null, 'Counter sale');
    const id = await createInvoice({ customer_id: customerId, vehicle_id: vehicleId, date: body.date, discount: body.discount, tax_rate: body.tax_rate, notes: body.notes, items });
    if (vehicleId && services.length) await generateReminders({ id: null, vehicle_id: vehicleId, mileage: num((body.vehicle || {}).mileage ?? body.mileage), labor: [...new Set(services)].map((sid) => ({ service_type_id: sid })) });
    if (body.payment && num(body.payment.amount) > 0) await addInvoicePayment(id, body.payment);
    await audit('create', 'invoices', id, { manual: true });
    return invoiceFull(id);
  }
  async function addInvoicePayment(id, p) {
    const inv = await mustRow('invoices', id);
    if (inv.status === 'cancelled') throw bad('invoice_cancelled');
    const amount = r2(p.amount);
    if (!(amount > 0)) throw bad('invalid_amount');
    const refund = p.refund === true || p.refund === 1;
    const due = r2(inv.total - inv.paid);
    if (!refund && amount > due + 0.009) throw bad('amount_exceeds_due', { due });
    if (refund && amount > inv.paid + 0.009) throw bad('invalid_amount');
    if (!p.account_id) throw bad('required', { field: 'account_id' });
    await addTx({ date: p.date, account_id: p.account_id, direction: refund ? 'out' : 'in', amount, category: refund ? 'refund' : 'invoice_payment', description: `${refund ? 'Refund' : 'Payment'} ${inv.no}`, ref_type: 'invoice', ref_id: id, party_type: 'customer', party_id: inv.customer_id, method: p.method || 'cash' });
    const paid = r2(inv.paid + (refund ? -amount : amount));
    const status = invStatus(inv.total, paid);
    await F.updateDoc(ref('invoices', id), { paid, status, open: ['unpaid', 'partial'].includes(status) });
    await F.updateDoc(ref('customers', inv.customer_id), { balance: inc(refund ? amount : -amount) });
    if (inv.work_order_id) await F.updateDoc(ref('work_orders', inv.work_order_id), { invoice_status: status }).catch(() => {});
  }
  async function cancelInvoice(id) {
    const inv = await mustRow('invoices', id);
    if (inv.status === 'cancelled') return;
    if (r2(inv.paid) > 0) throw bad('invoice_has_payments');
    if (inv.work_order_id) await F.updateDoc(ref('work_orders', inv.work_order_id), { invoice_id: null, invoice_no: null, invoice_status: null });
    else for (const it of inv.items || []) if (it.part_id) await stockMove(it.part_id, 'return', it.qty, it.unit_cost, 'invoice', id, 'Invoice cancelled');
    await F.updateDoc(ref('invoices', id), { status: 'cancelled', open: false, total_eff: 0, notes: `${inv.notes || ''} [cancelled ${nowStr()}]` });
    await F.updateDoc(ref('customers', inv.customer_id), { balance: inc(-r2(inv.total - inv.paid)) });
    await audit('cancel', 'invoices', id);
  }

  // delete an invoice completely: payments leave the cash accounts, counter-sale parts go back to stock,
  // a work-order invoice frees its work order
  // edit a customer invoice after it was saved: lines, customer, car, discount, tax, date, notes.
  // stock follows the difference in parts; payments stay (the new total cannot go below what was paid)
  async function editInvoice(id, body) {
    const inv = await mustRow('invoices', id);
    if (inv.status === 'cancelled') throw bad('invoice_cancelled');
    const src = (Array.isArray(body.items) ? body.items : []).filter((i) => i.description || i.part_id || i.service_type_id);
    if (!src.length) throw bad('invoice_empty');
    const sts = await serviceTypes();
    const old = inv.items || [];
    const items = [];
    for (const it of src) {
      const qty = num(it.qty, 1);
      if (it.part_id) {
        const p = await mustRow('parts', it.part_id);
        const was = old.find((o) => String(o.part_id) === String(p.id));
        items.push({ kind: 'part', description: it.description || [p.part_no, p.name_en, p.name_ar].filter(Boolean).join(' - '), qty, unit_price: r2(it.unit_price), unit_cost: was ? num(was.unit_cost) : num(p.cost), amount: r2(qty * num(it.unit_price)), part_id: p.id, technician_id: it.technician_id ? String(it.technician_id) : null });
      } else {
        const st = it.service_type_id ? sts.find((x) => x.id === String(it.service_type_id)) : null;
        const kind = it.kind === 'labor' || st ? 'labor' : it.kind || 'other';
        items.push({ kind, description: it.description || (st ? `${st.name_ar} / ${st.name_en}` : ''), qty, unit_price: r2(it.unit_price), unit_cost: 0, amount: r2(qty * num(it.unit_price)), part_id: null, technician_id: it.technician_id ? String(it.technician_id) : null });
      }
    }
    const tr = body.tax_rate !== undefined && body.tax_rate !== '' && body.tax_rate !== null ? num(body.tax_rate) : inv.tax_rate;
    const tt = totals(items, body.discount ?? inv.discount, tr);
    if (num(inv.paid) > tt.total + 0.009) throw bad('total_below_paid', { due: r2(inv.paid) });
    // stock check before changing anything
    const qtyBy = (rows, pid) => rows.filter((r) => String(r.part_id) === String(pid)).reduce((sm, r) => sm + num(r.qty, 1), 0);
    const pids = [...new Set([...old, ...items].filter((r) => r.part_id).map((r) => String(r.part_id)))];
    const allowNeg = String(await getSetting('allow_negative_stock', '0')) === '1';
    for (const pid of pids) {
      const d = r2(qtyBy(items, pid) - qtyBy(old, pid));
      const part = await getRow('parts', pid);
      if (d > 0 && part && num(part.qty) < d && !allowNeg) throw bad('insufficient_stock', { part: part.name_en, available: part.qty });
    }
    const customerId = body.customer_id || (body.customer && (body.customer.name || body.customer.phone)) ? await resolveCustomer(body) : inv.customer_id;
    const vehicleId = body.vehicle_id || (body.vehicle && (body.vehicle.plate || body.vehicle.model)) ? await resolveVehicle(body, customerId) : (customerId === inv.customer_id ? inv.vehicle_id : null);
    for (const pid of pids) {
      const d = r2(qtyBy(items, pid) - qtyBy(old, pid));
      if (d > 0) await stockMove(pid, 'out', d, null, 'invoice', id, `Edited ${inv.no}`);
      if (d < 0) await stockMove(pid, 'return', -d, null, 'invoice', id, `Edited ${inv.no}`);
    }
    const c = await mustRow('customers', customerId);
    const v = vehicleId ? await getRow('vehicles', vehicleId) : null;
    const status = invStatus(tt.total, num(inv.paid));
    const d = clean({ items, ...tt, customer_id: c.id, customer_name: c.name, customer_phone: c.phone, vehicle_id: v ? v.id : null, plate: v ? v.plate : null, model: v ? v.model : null, series: v ? v.series : null,
      date: body.date || inv.date, notes: body.notes !== undefined ? body.notes || null : inv.notes || null, status, open: ['unpaid', 'partial'].includes(status), total_eff: tt.total });
    d.vehicle_id = v ? v.id : null; d.plate = v ? v.plate : null;
    d.kw = keywords(inv.no, c.name, c.phone, d.plate, inv.work_order_no);
    const b = F.writeBatch(db);
    b.update(ref('invoices', id), d);
    const paid = num(inv.paid);
    if (c.id === inv.customer_id) b.update(ref('customers', c.id), { balance: inc(r2(tt.total - inv.total)) });
    else {
      b.update(ref('customers', inv.customer_id), { balance: inc(-r2(inv.total - paid)) });
      b.update(ref('customers', c.id), { balance: inc(r2(tt.total - paid)) });
      for (const t of await all('transactions', W('ref_type', '==', 'invoice'), W('ref_id', '==', String(id)))) b.update(ref('transactions', t.id), { party_id: c.id, party_name: c.name });
    }
    if (inv.work_order_id) b.update(ref('work_orders', inv.work_order_id), { invoice_status: status });
    await b.commit();
    await audit('edit', 'invoices', id, { old_total: inv.total, total: tt.total });
    return invoiceFull(id);
  }
  async function deleteInvoice(id) {
    const inv = await mustRow('invoices', id);
    for (const t of await all('transactions', W('ref_type', '==', 'invoice'), W('ref_id', '==', String(id)))) await removeTx(t);
    if (inv.status !== 'cancelled') {
      if (!inv.work_order_id) for (const it of inv.items || []) if (it.part_id) await stockMove(it.part_id, 'return', it.qty, it.unit_cost, 'invoice', id, 'Invoice deleted');
      await F.updateDoc(ref('customers', inv.customer_id), { balance: inc(-r2(inv.total - inv.paid)) }).catch(() => {});
    }
    if (inv.work_order_id) {
      const w = await getRow('work_orders', inv.work_order_id);
      if (w && w.invoice_id === id) await F.updateDoc(ref('work_orders', w.id), { invoice_id: null, invoice_no: null, invoice_status: null });
    }
    await F.deleteDoc(ref('invoices', id));
    await audit('delete', 'invoices', id, { no: inv.no, total: inv.total, paid: inv.paid });
  }

  // ------------------------------------------------------------------ purchases
  // a purchase line can name a part that is not in stock yet: it is registered automatically
  // (or matched to an existing part with the same code / name)
  async function ensurePart(it, supplierId) {
    if (it.part_id) return;
    const name = String(it.new_name || '').trim(); const code = String(it.new_part_no || '').trim();
    if (!name && !code) throw bad('required', { field: 'part' });
    let ex = null;
    if (code) ex = (await all('parts', W('part_no', '==', code), L(1)))[0] || (await all('parts', W('oem_no', '==', code), L(1)))[0];
    if (!ex && name) ex = (await all('parts', W('name_en', '==', name), L(1)))[0] || (await all('parts', W('name_ar', '==', name), L(1)))[0];
    if (ex) { it.part_id = ex.id; return; }
    const p = await createResource('parts', { part_no: code || null, name_en: name || code, name_ar: /[\u0600-\u06FF]/.test(name) ? name : null, price: r2(it.price), cost: 0, qty: 0, min_qty: 0, supplier_id: supplierId || null, notes: 'Added from a purchase invoice' });
    it.part_id = p.id;
  }
  const purchaseLines = (body) => (Array.isArray(body.items) ? body.items : []).filter((i) => (i.part_id || i.new_name || i.new_part_no) && num(i.qty) > 0);
  async function createPurchase(body) {
    if (!body.supplier_id) throw bad('required', { field: 'supplier_id' });
    const src = purchaseLines(body);
    if (!src.length) throw bad('purchase_empty');
    const s = await mustRow('suppliers', body.supplier_id);
    for (const it of src) await ensurePart(it, s.id);
    const isReturn = body.is_return ? 1 : 0;
    const items = [];
    for (const it of src) {
      const p = await mustRow('parts', it.part_id);
      items.push({ part_id: p.id, part_no: p.part_no || null, name_en: p.name_en, name_ar: p.name_ar || null, qty: num(it.qty), unit_cost: r2(it.unit_cost), amount: r2(num(it.qty) * num(it.unit_cost)), price: num(it.price) });
    }
    const subtotal = r2(items.reduce((a, i) => a + i.amount, 0));
    const total = r2(subtotal - r2(body.discount) + r2(body.tax));
    const no = await nextNo('purchases', isReturn ? 'PR' : 'PO');
    const r = newRef('purchases');
    const d = clean({ no, supplier_id: s.id, supplier_name: s.name, date: body.date || today(), supplier_invoice_no: body.supplier_invoice_no || null, items, subtotal, discount: r2(body.discount), tax: r2(body.tax), total, paid: 0, is_return: isReturn, status: 'unpaid', notes: body.notes || null, created_at: nowStr() });
    d.kw = keywords(no, d.supplier_invoice_no, s.name);
    for (const it of items) {
      if (isReturn) await stockMove(it.part_id, 'out', it.qty, it.unit_cost, 'purchase_return', r.id, 'Return to supplier');
      else {
        await stockMove(it.part_id, 'in', it.qty, it.unit_cost, 'purchase', r.id, 'Purchase');
        const upd = {};
        if (it.price > 0) upd.price = r2(it.price);
        const p = await getRow('parts', it.part_id);
        if (!p.supplier_id) { upd.supplier_id = s.id; upd.supplier_name = s.name; }
        if (Object.keys(upd).length) await F.updateDoc(ref('parts', it.part_id), upd);
      }
    }
    const b = F.writeBatch(db);
    b.set(r, d);
    b.update(ref('suppliers', s.id), { balance: inc(isReturn ? -total : total) });
    await b.commit();
    if (body.payment && num(body.payment.amount) > 0) await addPurchasePayment(r.id, body.payment);
    await audit('create', 'purchases', r.id);
    return purchaseFull(r.id);
  }
  async function addPurchasePayment(id, pay) {
    const p = await mustRow('purchases', id);
    const amount = r2(pay.amount);
    if (!(amount > 0)) throw bad('invalid_amount');
    if (!pay.account_id) throw bad('required', { field: 'account_id' });
    await addTx({ date: pay.date, account_id: pay.account_id, direction: p.is_return ? 'in' : 'out', amount, category: p.is_return ? 'supplier_refund' : 'supplier_payment', description: `${p.is_return ? 'Refund' : 'Payment'} ${p.no}`, ref_type: 'purchase', ref_id: id, party_type: 'supplier', party_id: p.supplier_id, method: pay.method || 'cash' });
    const paid = r2(p.paid + amount);
    await F.updateDoc(ref('purchases', id), { paid, status: paid <= 0 ? 'unpaid' : paid + 0.009 >= p.total ? 'paid' : 'partial' });
  }
  // edit a supplier invoice: stock and average cost follow the difference, supplier balance the new total
  async function editPurchase(id, body) {
    const p = await mustRow('purchases', id);
    const src = purchaseLines(body);
    if (!src.length) throw bad('purchase_empty');
    for (const it of src) await ensurePart(it, p.supplier_id);
    const sign = p.is_return ? -1 : 1;
    const allowNeg = String(await getSetting('allow_negative_stock', '0')) === '1';
    const items = [];
    for (const it of src) {
      const part = await mustRow('parts', it.part_id);
      items.push({ part_id: part.id, part_no: part.part_no || null, name_en: part.name_en, name_ar: part.name_ar || null, qty: num(it.qty), unit_cost: r2(it.unit_cost), amount: r2(num(it.qty) * num(it.unit_cost)), price: num(it.price) });
    }
    const old = p.items || [];
    const sumBy = (rows, pid, f) => rows.filter((r) => String(r.part_id) === String(pid)).reduce((s, r) => s + f(r), 0);
    const pids = [...new Set([...old, ...items].map((r) => String(r.part_id)))];
    // check stock first so a failure never leaves the invoice half-edited
    const plan = [];
    for (const pid of pids) {
      const part = await mustRow('parts', pid);
      const oq = sumBy(old, pid, (r) => num(r.qty)); const nq = sumBy(items, pid, (r) => num(r.qty));
      const ov = sumBy(old, pid, (r) => num(r.qty) * num(r.unit_cost)); const nv = sumBy(items, pid, (r) => num(r.qty) * num(r.unit_cost));
      const dq = r2(sign * (nq - oq));
      const newQty = r2(num(part.qty) + dq);
      if (newQty < 0 && !allowNeg) throw bad('insufficient_stock', { part: part.name_en, available: part.qty });
      let cost = num(part.cost);
      if (!p.is_return && (dq || Math.abs(ov - nv) > 0.001)) cost = newQty > 0 ? r2(Math.max(0, (num(part.qty) * num(part.cost) - ov + nv) / newQty)) : (nq > 0 ? r2(nv / nq) : cost);
      const it = items.find((r) => String(r.part_id) === pid);
      plan.push({ part, dq, newQty, cost, price: !p.is_return && it && it.price > 0 ? r2(it.price) : null });
    }
    const subtotal = r2(items.reduce((a, i) => a + i.amount, 0));
    const discount = r2(body.discount ?? p.discount); const tax = r2(body.tax ?? p.tax);
    const total = r2(subtotal - discount + tax);
    const b = F.writeBatch(db);
    for (const x of plan) {
      b.update(ref('parts', x.part.id), { qty: x.newQty, cost: x.cost, low: x.newQty <= num(x.part.min_qty), ...(x.price ? { price: x.price } : {}) });
      if (x.dq) b.set(newRef('stock_moves'), { part_id: x.part.id, part_no: x.part.part_no || null, name_en: x.part.name_en || null, name_ar: x.part.name_ar || null, date: nowStr(), type: 'adjust', qty: x.dq, unit_cost: x.cost, ref_type: 'purchase_edit', ref_id: id, notes: `Edited ${p.no}`, user_id: me.id, user_name: me.name, kw: keywords(x.part.part_no, x.part.name_en, x.part.name_ar, 'purchase_edit') });
    }
    const status = p.paid <= 0 ? 'unpaid' : p.paid + 0.009 >= total ? 'paid' : 'partial';
    const upd = { items, subtotal, discount, tax, total, status, supplier_invoice_no: body.supplier_invoice_no !== undefined ? body.supplier_invoice_no || null : p.supplier_invoice_no || null, date: body.date || p.date, notes: body.notes !== undefined ? body.notes || null : p.notes || null };
    upd.kw = keywords(p.no, upd.supplier_invoice_no, p.supplier_name);
    b.update(ref('purchases', id), upd);
    b.update(ref('suppliers', p.supplier_id), { balance: inc(r2(sign * (total - p.total))) });
    await b.commit();
    await audit('edit', 'purchases', id, { old_total: p.total, total });
    return purchaseFull(id);
  }
  async function purchaseFull(id) {
    const p = await mustRow('purchases', id);
    delete p.kw;
    p.payments = await all('transactions', W('ref_type', '==', 'purchase'), W('ref_id', '==', String(id)));
    return p;
  }
  async function deletePurchase(id) {
    const p = await mustRow('purchases', id);
    // check stock first so a failure never leaves the purchase half-deleted
    if (!p.is_return && String(await getSetting('allow_negative_stock', '0')) !== '1') {
      for (const it of p.items || []) {
        const part = await getRow('parts', it.part_id);
        if (part && num(part.qty) < num(it.qty)) throw bad('insufficient_stock', { part: part.name_en, available: part.qty });
      }
    }
    for (const it of p.items || []) await stockMove(it.part_id, p.is_return ? 'in' : 'out', it.qty, it.unit_cost, 'purchase_void', id, 'Purchase deleted');
    for (const t of await all('transactions', W('ref_type', '==', 'purchase'), W('ref_id', '==', String(id)))) {
      await removeTx(t);
      await F.updateDoc(ref('suppliers', p.supplier_id), { balance: inc(t.direction === 'out' ? t.amount : -t.amount) });
    }
    await F.updateDoc(ref('suppliers', p.supplier_id), { balance: inc(p.is_return ? p.total : -p.total) });
    await F.deleteDoc(ref('purchases', id));
    await audit('delete', 'purchases', id);
  }

  // ------------------------------------------------------------------ bonuses / payroll
  const invoicesBetween = async (from, to) => (await all('invoices', W('date', '>=', from), W('date', '<=', to))).filter((i) => i.status !== 'cancelled');
  async function commissions(from, to, invs) {
    invs = invs || await invoicesBetween(from, to);
    const list = (await emps()).filter((e) => Number(e.active)).sort((a, b) => (a.name < b.name ? -1 : 1));
    const bon = await all('bonuses', W('date', '>=', from), W('date', '<=', to));
    return list.map((e) => {
      let la = 0; let pa = 0; let hours = 0; const jobs = new Set();
      for (const i of invs) for (const it of i.items || []) {
        if (it.technician_id !== e.id) continue;
        if (it.kind === 'labor') { la += it.amount; hours += num(it.qty); jobs.add(i.id); } else pa += it.amount;
      }
      const lc = r2(la * num(e.labor_commission) / 100); const pc = r2(pa * num(e.parts_commission) / 100);
      const mine = bon.filter((b) => b.employee_id === e.id);
      return {
        employee_id: e.id, name: e.name, job: e.job, salary: e.salary, labor_commission_rate: e.labor_commission, parts_commission_rate: e.parts_commission,
        jobs: jobs.size, hours: r2(hours), labor_sales: r2(la), parts_sales: r2(pa), labor_commission: lc, parts_commission: pc, commission: r2(lc + pc),
        commission_recorded: r2(mine.filter((b) => b.type === 'commission').reduce((s, b) => s + b.amount, 0)),
        bonuses_net: r2(mine.reduce((s, b) => s + (b.type === 'deduction' ? -b.amount : b.amount), 0)),
      };
    });
  }
  // ------------------------------------------------------------------ attendance
  const PAY = window.GEAR_PAY;
  const ATT_READ = ['admin', 'manager', 'accountant'];
  const ATT_STATUSES = ['present', 'absent', 'leave', 'sick', 'holiday', 'unpaid'];
  const hmOf = (ts) => { const d = ts.toDate(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  // self check-ins carry a server timestamp; it wins over the phone's clock
  const fixAtt = (r) => {
    if (!r) return r;
    if (r.check_in_at && r.check_in_at.toDate) r.check_in = hmOf(r.check_in_at);
    if (r.check_out_at && r.check_out_at.toDate) r.check_out = hmOf(r.check_out_at);
    delete r.check_in_at; delete r.check_out_at;
    return r;
  };
  const attId = (empId, date) => `${empId}_${date}`;
  const attOfPeriod = async (period, empId) => {
    let rows;
    if (PAY.isWeek(period)) { const days = PAY.periodDays(period); rows = await all('attendance', W('date', '>=', days[0]), W('date', '<=', days[6])); }
    else rows = await all('attendance', ...(empId ? [W('employee_id', '==', String(empId))] : []), W('period', '==', period));
    return rows.filter((r) => !empId || r.employee_id === String(empId)).map(fixAtt);
  };
  async function attendanceCalc(e, period, recs) {
    recs = recs || await attOfPeriod(period, e.id);
    return PAY.calc(e, recs.filter((r) => r.employee_id === e.id), period, await settings(), today());
  }

  const validPeriod = (p) => { if (!/^\d{4}-\d{2}$|^W\d{4}-\d{2}-\d{2}$/.test(String(p || ''))) throw bad('invalid_period'); return p; };
  // period: "YYYY-MM" (monthly payroll) or "WYYYY-MM-DD" (weekly payroll)
  async function payroll(period) {
    validPeriod(period);
    const cycle = PAY.isWeek(period) ? 'weekly' : 'monthly';
    const list = (await emps()).filter((e) => Number(e.active) && PAY.cycleOf(e) === cycle).sort((a, b) => (a.name < b.name ? -1 : 1));
    await settings();
    const att = await attOfPeriod(period);
    const unpaid = await all('bonuses', W('paid', '==', 0));
    const sal = await all('transactions', W('category', '==', 'salary'), W('period', '==', period));
    return list.map((e) => {
      const mine = unpaid.filter((b) => b.employee_id === e.id);
      const sumT = (types) => r2(mine.filter((b) => types.includes(b.type || 'bonus')).reduce((s, b) => s + num(b.amount), 0));
      const plus = sumT(['bonus', 'commission']); const minus = sumT(['deduction']); const adv = sumT(['advance']);
      const paidSal = r2(sal.filter((t) => t.party_id === e.id).reduce((s, t) => s + num(t.salary_part ?? t.amount), 0));
      const a = PAY.calc(e, att.filter((r) => r.employee_id === e.id), period, cache.settings || {}, today());
      delete a.days;
      return { employee_id: e.id, name: e.name, job: e.job, salary: num(e.salary), pay_cycle: cycle, ...a, period_label: PAY.periodLabel(period), salary_paid: paidSal, bonuses: plus, deductions: minus, advances: adv, net: r2(a.salary_due - paidSal + plus - minus - adv) };
    });
  }
  // give an employee an advance: cash leaves the account now, the next payroll deducts it
  async function giveAdvance(body) {
    const amount = r2(body.amount);
    if (!(amount > 0)) throw bad('invalid_amount');
    if (!body.employee_id || !body.account_id) throw bad('required');
    const e = await mustRow('employees', body.employee_id);
    const date = body.date || today();
    const bref = newRef('bonuses');
    const t = await addTx({ date, account_id: body.account_id, direction: 'out', amount, category: 'advance', description: `Advance - ${e.name}${body.reason ? ' - ' + body.reason : ''}`, ref_type: 'advance', ref_id: bref.id, party_type: 'employee', party_id: e.id, method: body.method || 'cash' });
    const d = { employee_id: e.id, employee_name: e.name, job: e.job || null, date, period: date.slice(0, 7), type: 'advance', amount, reason: body.reason || null, paid: 0, transaction_id: t.id, created_at: nowStr() };
    d.kw = keywords(e.name, d.reason, d.period);
    await F.setDoc(bref, d);
    await audit('advance', 'employees', e.id, { amount });
    return { ...d, id: bref.id };
  }
  async function payPayroll(body) {
    const { employee_id, account_id, period } = body;
    if (!employee_id || !account_id || !period) throw bad('required');
    const e = await mustRow('employees', employee_id);
    const rowp = (await payroll(period)).find((x) => x.employee_id === String(employee_id));
    if (!rowp) throw bad('not_found');
    // one net payment: salary + bonuses - deductions - advances
    const salaryDue = Math.max(0, r2(rowp.salary_due - rowp.salary_paid));
    const adj = r2(rowp.bonuses - rowp.deductions - rowp.advances);
    if (!salaryDue && !adj) return { ok: true, nothing: true };
    const cash = r2(salaryDue + adj);
    const t = await addTx({ account_id, direction: 'out', amount: Math.max(0, cash), category: 'salary', description: `Salary ${PAY.periodLabel(period)} - ${e.name} (${salaryDue} + ${rowp.bonuses} - ${rowp.deductions} - ${rowp.advances})`, party_type: 'employee', party_id: e.id, period, salary_part: salaryDue });
    const b = F.writeBatch(db);
    for (const x of await all('bonuses', W('employee_id', '==', e.id), W('paid', '==', 0))) b.update(ref('bonuses', x.id), { paid: 1, transaction_id: x.type === 'advance' && x.transaction_id ? x.transaction_id : t.id });
    if (cash < 0) {
      const cref = newRef('bonuses');
      b.set(cref, { employee_id: e.id, employee_name: e.name, job: e.job || null, date: today(), period, type: 'advance', amount: -cash, reason: `Carried over from ${PAY.periodLabel(period)}`, paid: 0, transaction_id: null, created_at: nowStr(), kw: keywords(e.name, 'carried') });
    }
    await b.commit();
    await audit('payroll', 'employees', e.id, { period, cash });
    return { ok: true, paid: Math.max(0, cash), carried: cash < 0 ? -cash : 0 };
  }

  // ------------------------------------------------------------------ dashboard & reports
  const cnt = async (c, ...cons) => (await F.getCountFromServer(q(c, ...cons))).data().count;
  const sumOf = async (c, field, ...cons) => num((await F.getAggregateFromServer(q(c, ...cons), { s: F.sum(field) })).data().s);
  // each metric is independent: one failing query (e.g. an index still building) never breaks the dashboard
  const safe = async (fn, fallback) => { try { return await fn(); } catch (e) { console.warn('dashboard metric failed', e); return fallback; } };
  async function dashboard() {
    const t = today(); const month = t.slice(0, 7); const ms = month + '-01';
    const active = await safe(() => all('work_orders', W('active', '==', true)), []);
    const days = num(await getSetting('reminder_days_ahead', '30'));
    const by = {}; active.forEach((w) => { by[w.status] = (by[w.status] || 0) + 1; });
    const prio = { urgent: 0, high: 1 };
    const out = {
      in_workshop: active.length, ready_for_delivery: by.completed || 0, waiting_parts: by.waiting_parts || 0,
      receptions_today: await safe(() => cnt('receptions', W('date', '>=', t)), 0),
      appointments_today: (await safe(() => all('appointments', W('date', '==', t)), [])).filter((a) => a.status === 'scheduled').sort((a, b) => ((a.time || '') < (b.time || '') ? -1 : 1)),
      reminders_due: await safe(() => cnt('reminders', W('open', '==', true), W('due_date', '<=', addDays(t, days))),
        await safe(async () => (await all('reminders', W('open', '==', true))).filter((r) => r.due_date && r.due_date <= addDays(t, days)).length, 0)),
      low_stock: await safe(() => cnt('parts', W('low', '==', true)), 0),
      wo_by_status: Object.entries(by).map(([status, n]) => ({ status, n })),
      active_orders: active.sort((a, b) => (prio[a.priority] ?? 2) - (prio[b.priority] ?? 2) || (a.date < b.date ? 1 : -1)).slice(0, 12)
        .map((w) => ({ id: w.id, no: w.no, status: w.status, priority: w.priority, date: w.date, bay: w.bay, plate: w.plate, model: w.model, series: w.series, customer_name: w.customer_name })),
    };
    if (hasAny(MONEY)) {
      // plain single-field queries only (no aggregation indexes needed)
      const from = addDays(t, -13) < ms ? addDays(t, -13) : ms;
      const invs = await safe(() => all('invoices', W('date', '>=', from)), []);
      const txs = await safe(() => all('transactions', W('date', '>=', ms)), []);
      const sumInv = (f) => r2(invs.filter(f).reduce((s, i) => s + num(i.total_eff), 0));
      out.revenue_today = sumInv((i) => i.date === t);
      out.revenue_month = sumInv((i) => i.date >= ms && i.date <= t);
      out.collected_today = r2(txs.filter((x) => x.date === t && x.ref_type === 'invoice').reduce((s, x) => s + num(x.signed), 0));
      out.expenses_month = r2(txs.filter((x) => x.is_expense).reduce((s, x) => s + num(x.amount), 0));
      out.receivables = r2(await safe(() => sumOf('customers', 'balance'), 0));
      out.cash_balance = r2((await safe(() => all('accounts'), [])).reduce((s, a) => s + num(a.balance), 0));
      const g = {}; invs.filter((i) => i.date >= addDays(t, -13)).forEach((i) => { g[i.date] = (g[i.date] || 0) + num(i.total_eff); });
      out.daily = Object.keys(g).sort().map((date) => ({ date, total: r2(g[date]) }));
    }
    return out;
  }
  async function reports(from, to) {
    const invAll = await all('invoices', W('date', '>=', from), W('date', '<=', to));
    const invs = invAll.filter((i) => i.status !== 'cancelled');
    const S = (f) => r2(invs.reduce((s, i) => s + num(i[f]), 0));
    const inv = { n: invs.length, total: S('total'), labor: S('labor_total'), parts: S('parts_total'), parts_cost: S('parts_cost'), discount: S('discount'), tax: S('tax'), paid: S('paid') };
    const txs = await all('transactions', W('date', '>=', from), W('date', '<=', to));
    const ex = {}; txs.filter((x) => x.is_expense).forEach((x) => { ex[x.category] = (ex[x.category] || 0) + x.amount; });
    const expenses = Object.entries(ex).map(([category, amount]) => ({ category, amount: r2(amount) })).sort((a, b) => b.amount - a.amount);
    const totalExpenses = r2(expenses.reduce((s, e) => s + e.amount, 0));
    const otherIncome = r2(txs.filter((x) => x.direction === 'in' && x.category === 'other_income').reduce((s, x) => s + x.amount, 0));
    const netSales = r2(inv.total - inv.tax); const gross = r2(netSales - inv.parts_cost);
    const accs = await all('accounts');
    const group = (arr, key, val) => { const m = {}; arr.forEach((x) => { const k = key(x); m[k] = m[k] || { n: 0, amount: 0, qty: 0, profit: 0 }; val(m[k], x); }); return m; };
    const items = invs.flatMap((i) => (i.items || []).map((it) => ({ ...it, _inv: i })));
    const ts = group(items.filter((i) => i.kind === 'labor'), (i) => i.description, (a, i) => { a.n++; a.amount += i.amount; });
    const tp = group(items.filter((i) => i.kind === 'part'), (i) => i.description, (a, i) => { a.qty += i.qty; a.amount += i.amount; a.profit += i.amount - i.qty * (i.unit_cost || 0); });
    const bs = group(invs, (i) => i.series || '-', (a, i) => { a.n++; a.amount += i.total; });
    const daily = group(invs, (i) => i.date, (a, i) => { a.n++; a.amount += i.total; });
    const purchases = await all('purchases', W('date', '>=', from), W('date', '<=', to));
    const wos = await all('work_orders', W('completed_at', '>=', from), W('completed_at', '<=', to + ''));
    const sups = await all('suppliers');
    return {
      from, to, invoices: inv, net_sales: netSales, gross_profit: gross, other_income: otherIncome, expenses, total_expenses: totalExpenses,
      net_profit: r2(gross + otherIncome - totalExpenses),
      purchases: r2(purchases.reduce((s, p) => s + (p.is_return ? -p.total : p.total), 0)),
      cars_serviced: new Set(wos.filter((w) => ['completed', 'delivered'].includes(w.status)).map((w) => w.vehicle_id)).size,
      new_customers: await cnt('customers', W('created_at', '>=', from), W('created_at', '<=', to + '')),
      top_services: Object.entries(ts).map(([description, a]) => ({ description, n: a.n, amount: r2(a.amount) })).sort((a, b) => b.amount - a.amount).slice(0, 10),
      top_parts: Object.entries(tp).map(([description, a]) => ({ description, qty: a.qty, amount: r2(a.amount), profit: r2(a.profit) })).sort((a, b) => b.amount - a.amount).slice(0, 10),
      by_series: Object.entries(bs).map(([series, a]) => ({ series, n: a.n, amount: r2(a.amount) })).sort((a, b) => b.amount - a.amount),
      technicians: (await commissions(from, to, invs)).filter((x) => x.labor_sales || x.parts_sales),
      daily: Object.keys(daily).sort().map((date) => ({ date, n: daily[date].n, total: r2(daily[date].amount) })),
      cashflow: accs.map((a) => ({ name: a.name, cash_in: r2(txs.filter((x) => x.account_id === a.id && x.direction === 'in').reduce((s, x) => s + x.amount, 0)), cash_out: r2(txs.filter((x) => x.account_id === a.id && x.direction === 'out').reduce((s, x) => s + x.amount, 0)) })),
      receivables: r2(await sumOf('customers', 'balance')),
      payables: r2(sups.reduce((s, x) => s + num(x.balance), 0)),
      stock_value: r2((await all('parts', W('qty', '>', 0))).reduce((s, p) => s + p.qty * num(p.cost), 0)),
    };
  }
  async function globalSearch(term) {
    const t = norm(term).split(/\s+/)[0];
    const find = async (c, n) => (await all(c, W('kw', 'array-contains', t), L(n))).map((r) => { delete r.kw; return r; });
    return {
      customers: await find('customers', 8), vehicles: await find('vehicles', 8), work_orders: await find('work_orders', 5),
      invoices: hasAny(BILL) ? await find('invoices', 5) : [], parts: await find('parts', 5),
    };
  }

  // ------------------------------------------------------------------ setup / users / backup
  const DEFAULT_SETTINGS = {
    center_name_ar: 'مركز صيانة BMW', center_name_en: 'BMW Service Center', center_phone: '', center_address: '', tax_no: '', currency: 'EGP', vat_rate: '14', labor_rate: '600',
    invoice_footer_ar: 'شكراً لثقتكم - ضمان العمالة 30 يوم', invoice_footer_en: 'Thank you for your trust - 30 days labor warranty',
    reminder_days_ahead: '30', reminder_km_ahead: '1000', avg_km_per_month: '1500', allow_negative_stock: '0', logo: '', whatsapp_template_ar: '', whatsapp_template_en: '',
    work_start: '09:00', work_end: '17:00', work_days_month: '26', weekend_days: '5', late_grace: '15', overtime_rate: '1.5', attendance_payroll: '0', deduct_late: '1', week_start: '6',
  };
  const DEFAULT_SERVICES = [
    ['OIL', 'تغيير زيت المحرك والفلتر', 'Engine oil & filter service', 'CBS', 1, 600, 10000, 12], ['BRK-F', 'تغيير فرامل أمامي (تيل + طنابير)', 'Front brake pads & discs', 'Brakes', 1.5, 900, 40000, 0],
    ['BRK-R', 'تغيير فرامل خلفي (تيل + طنابير)', 'Rear brake pads & discs', 'Brakes', 1.5, 900, 50000, 0], ['BRK-FL', 'تغيير زيت الفرامل', 'Brake fluid service', 'CBS', 0.5, 400, 0, 24],
    ['MICRO', 'تغيير فلتر التكييف', 'Microfilter (cabin filter)', 'CBS', 0.5, 250, 20000, 12], ['AIR', 'تغيير فلتر الهواء', 'Engine air filter', 'CBS', 0.5, 250, 40000, 24],
    ['SPARK', 'تغيير البوجيهات', 'Spark plugs', 'CBS', 1.5, 900, 60000, 48], ['FUEL-F', 'تغيير فلتر البنزين/الديزل', 'Fuel filter', 'CBS', 1, 600, 60000, 0],
    ['VCHK', 'فحص دوري شامل', 'Vehicle check', 'CBS', 1, 500, 30000, 24], ['ATF', 'تغيير زيت الفتيس الأوتوماتيك', 'Automatic transmission fluid', 'Drivetrain', 2, 1200, 80000, 0],
    ['DIFF', 'تغيير زيت الدفرنس', 'Differential oil', 'Drivetrain', 1, 500, 80000, 0], ['COOL', 'تغيير سائل التبريد', 'Coolant service', 'Engine', 1, 500, 0, 48],
    ['ISTA', 'كشف كمبيوتر ISTA', 'ISTA computer diagnosis', 'Diagnosis', 1, 750, 0, 0], ['CODE', 'برمجة وتكويد', 'Coding & programming', 'Electrical', 1, 1000, 0, 0],
    ['AC', 'صيانة تكييف وشحن فريون', 'A/C service & recharge', 'A/C', 1, 700, 0, 24], ['ALIGN', 'ضبط زوايا وترصيص', 'Wheel alignment & balancing', 'Tyres', 1, 500, 20000, 0],
    ['BATT', 'تغيير وتسجيل بطارية', 'Battery replacement & registration', 'Electrical', 0.5, 400, 0, 48], ['WASH', 'غسيل وتنظيف', 'Wash & clean', 'Other', 0.5, 200, 0, 0],
  ];
  async function setup(body) {
    const username = String(body.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw bad('invalid_username');
    if (String(body.password || '').length < 6) throw bad('password_too_short');
    if ((await getRow('meta', 'setup').catch(() => null))) throw new ApiError(403, 'already_setup');
    const cred = await F.createUserWithEmailAndPassword(auth, toEmail(username), body.password);
    const uid = cred.user.uid;
    const b = F.writeBatch(db);
    b.set(ref('users', uid), { username, name: body.name || 'Administrator', role: 'admin', active: 1, employee_id: null, created_at: nowStr() });
    b.set(ref('meta', 'setup'), { by: uid, at: nowStr() });
    await b.commit();
    await loadMe(cred.user);
    const b2 = F.writeBatch(db);
    b2.set(ref('settings', 'main'), { ...DEFAULT_SETTINGS, center_name_ar: body.center_name_ar || DEFAULT_SETTINGS.center_name_ar, center_name_en: body.center_name_en || DEFAULT_SETTINGS.center_name_en });
    [['الخزنة الرئيسية / Main Cash', 'cash'], ['البنك / Bank', 'bank'], ['ماكينة الفيزا / POS', 'pos']].forEach(([name, type], i) => b2.set(newRef('accounts'), { name, type, opening_balance: 0, balance: 0, active: 1, created_at: `${nowStr()}.${i}`, kw: keywords(name) }));
    for (const [code, ar, en, cat, h, price, km, mo] of DEFAULT_SERVICES) b2.set(newRef('service_types'), { code, name_ar: ar, name_en: en, category: cat, labor_hours: h, labor_price: price, interval_km: km, interval_months: mo, active: 1, kw: keywords(code, ar, en, cat) });
    await b2.commit();
    cache.settings = null;
    return { user: { id: uid, username, name: body.name, role: 'admin', roles: ['admin'] } };
  }
  async function createUser(body) {
    const username = String(body.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username) || !body.name) throw bad('required');
    if (!ROLES.includes(body.role)) throw bad('invalid_role');
    if (String(body.password || '').length < 6) throw bad('password_too_short');
    if ((await all('users', W('username', '==', username), L(1))).length) throw bad('username_taken');
    const second = F.initializeApp(CFG, 'creator-' + Date.now());
    const a2 = F.getAuth(second);
    try {
      await F.setPersistence(a2, F.inMemoryPersistence);
      if (CFG.emulator) F.connectAuthEmulator(a2, `http://${CFG.emulator.auth || '127.0.0.1:9099'}`, { disableWarnings: true });
      let uid;
      try { uid = (await F.createUserWithEmailAndPassword(a2, toEmail(username), body.password)).user.uid; } catch (e) {
        if (e.code === 'auth/email-already-in-use') throw bad('username_taken');
        throw e;
      }
      await F.signOut(a2);
      await F.setDoc(ref('users', uid), { username, name: body.name, role: body.role, extra_roles: parseRoles(body.extra_roles).filter((r) => r !== body.role), employee_id: body.employee_id || null, active: body.active === 0 ? 0 : 1, created_at: nowStr() });
      await audit('create', 'users', uid);
      return { id: uid };
    } finally { await F.deleteApp(second).catch(() => {}); }
  }
  const BACKUP_COLS = ['settings', 'users', 'attendance', 'customers', 'vehicles', 'employees', 'service_types', 'appointments', 'receptions', 'diagnoses', 'work_orders', 'suppliers', 'parts', 'stock_moves', 'purchases', 'invoices', 'accounts', 'transactions', 'bonuses', 'reminders', 'counters'];
  G.FB = {
    backup: async () => {
      need(['admin']);
      G.toast(G.t('loading'));
      const out = { exported_at: nowStr() };
      for (const c of BACKUP_COLS) out[c] = (await all(c)).map((r) => { delete r.kw; return r; });
      const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gear-backup-${today()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
  };

  // one-time: rebuild the parts search keywords so whole codes like "OIL-5W30" are searchable (admin, once)
  async function reindexParts() {
    if (!me || me.role !== 'admin') return;
    const st = await settings(true);
    if (st.kw_version === '2') return;
    const rows = await all('parts');
    for (let i = 0; i < rows.length; i += 400) {
      const b = F.writeBatch(db);
      for (const r of rows.slice(i, i + 400)) b.update(ref('parts', r.id), { kw: keywords(...RES.parts.kw(r)) });
      await b.commit();
    }
    await F.setDoc(ref('settings', 'main'), { kw_version: '2' }, { merge: true });
  }

  // ------------------------------------------------------------------ router
  const routes = [];
  const route = (method, pattern, roles, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, roles, handler });
  };

  route('GET', '/api/public/settings', null, async () => {
    const setupDone = await getRow('meta', 'setup').catch(() => ({}));
    const s = (await getRow('settings', 'main').catch(() => null)) || {};
    return { center_name_ar: s.center_name_ar, center_name_en: s.center_name_en, logo: s.logo || '', needs_setup: !setupDone, firebase: true };
  });
  route('POST', '/api/auth/setup', null, ({ body }) => setup(body));
  route('POST', '/api/auth/login', null, async ({ body }) => {
    try { await F.signInWithEmailAndPassword(auth, toEmail(body.username || 'x'), body.password || ''); } catch (e) {
      if (e.code === 'auth/too-many-requests') throw new ApiError(429, 'too_many_attempts');
      throw new ApiError(401, 'invalid_credentials');
    }
    await loadMe(auth.currentUser);
    if (!me) { await F.signOut(auth); throw new ApiError(401, 'invalid_credentials'); }
    cache.settings = null; cache.emps = null; cache.st = null;
    await audit('login', 'users', me.id);
    reindexParts().catch((e) => console.warn('reindex', e));
    return { user: publicMe(), mustChange: false };
  });
  route('POST', '/api/auth/logout', ANY, async () => { await F.signOut(auth); me = null; return { ok: true }; });
  route('GET', '/api/auth/me', ANY, () => ({ user: publicMe() }));
  route('POST', '/api/auth/password', ANY, async ({ body }) => {
    if (String(body.password || '').length < 6) throw bad('password_too_short');
    try { await F.reauthenticateWithCredential(auth.currentUser, F.EmailAuthProvider.credential(auth.currentUser.email, body.current || '')); } catch (_) { throw bad('wrong_password'); }
    await F.updatePassword(auth.currentUser, body.password);
    return { ok: true };
  });
  route('GET', '/api/users', ['admin'], async () => {
    const e = await emps();
    return { rows: (await all('users')).map((u) => ({ ...u, employee_name: (e.find((x) => x.id === u.employee_id) || {}).name || null })).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)) };
  });
  route('POST', '/api/users', ['admin'], ({ body }) => createUser(body));
  route('PUT', '/api/users/:id', ['admin'], async ({ params, body }) => {
    const u = await mustRow('users', params.id);
    if (body.role && !ROLES.includes(body.role)) throw bad('invalid_role');
    if (u.id === me.id && (Number(body.active) === 0 || (body.role && body.role !== 'admin'))) throw bad('cannot_demote_self');
    if (body.password) throw bad('fb_admin_password');
    await F.updateDoc(ref('users', u.id), clean({ name: body.name || u.name, role: body.role || u.role, extra_roles: body.extra_roles === undefined ? (u.extra_roles || []) : parseRoles(body.extra_roles).filter((r) => r !== (body.role || u.role)), employee_id: body.employee_id || null, active: body.active === undefined ? u.active : Number(body.active) }));
    await audit('update', 'users', u.id);
    return { ok: true };
  });
  route('DELETE', '/api/users/:id', ['admin'], async ({ params }) => {
    if (params.id === me.id) throw bad('cannot_delete_self');
    await F.deleteDoc(ref('users', params.id));
    return { ok: true };
  });
  const PUBLIC_SETTINGS = Object.keys(DEFAULT_SETTINGS);
  route('GET', '/api/settings', ANY, async () => { const s = await settings(true); const o = {}; for (const k of PUBLIC_SETTINGS) o[k] = s[k] ?? ''; return o; });
  route('PUT', '/api/settings', ['admin'], async ({ body }) => {
    const o = {}; for (const k of PUBLIC_SETTINGS) if (body[k] !== undefined) o[k] = body[k] === null ? '' : String(body[k]);
    await F.setDoc(ref('settings', 'main'), o, { merge: true }); cache.settings = null; await audit('update', 'settings', null); return { ok: true };
  });
  route('GET', '/api/dashboard', ANY, () => dashboard());
  route('GET', '/api/search', ANY, ({ query }) => (String(query.q || '').trim().length < 2 ? {} : globalSearch(String(query.q).trim())));
  route('GET', '/api/meta', ANY, () => ({ roles: ROLES, wo_statuses: WO_STATUSES }));

  route('GET', '/api/customers/:id/full', ANY, async ({ params }) => {
    const c = await getResource('customers', params.id);
    const byDate = (a, b) => (String(a.date) < String(b.date) ? 1 : -1);
    c.vehicles = (await all('vehicles', W('customer_id', '==', c.id))).map((v) => { delete v.kw; return v; });
    c.invoices = hasAny(BILL) ? (await all('invoices', W('customer_id', '==', c.id), L(200))).sort(byDate).map((i) => ({ id: i.id, no: i.no, date: i.date, total: i.total, paid: i.paid, status: i.status, plate: i.plate })) : [];
    c.work_orders = (await all('work_orders', W('customer_id', '==', c.id), L(200))).sort(byDate).map((w) => ({ id: w.id, no: w.no, date: w.date, status: w.status, plate: w.plate, model: w.model }));
    c.reminders = (await all('reminders', W('customer_id', '==', c.id), W('open', '==', true))).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    return c;
  });
  route('GET', '/api/vehicles/:id/full', ANY, async ({ params }) => {
    const v = await getResource('vehicles', params.id);
    v.customer = (await getRow('customers', v.customer_id)) || {};
    const wos = (await all('work_orders', W('vehicle_id', '==', v.id))).sort((a, b) => (a.date < b.date ? 1 : -1));
    const sts = await serviceTypes(); const e = await emps();
    v.work_orders = wos.map((w) => ({ id: w.id, no: w.no, date: w.date, status: w.status, mileage: w.mileage, description: w.description, completed_at: w.completed_at, invoice_no: w.invoice_no }));
    v.history = wos.filter((w) => ['completed', 'delivered'].includes(w.status)).flatMap((w) => (w.labor || []).map((l) => { const s = sts.find((x) => x.id === l.service_type_id) || {}; return { work_order_id: w.id, no: w.no, date: String(w.completed_at || w.date).slice(0, 10), mileage: w.mileage, description: l.description, name_ar: s.name_ar, name_en: s.name_en, technician_name: (e.find((x) => x.id === l.technician_id) || {}).name }; }));
    v.parts_history = wos.flatMap((w) => (w.parts || []).map((p) => ({ no: w.no, date: String(w.date).slice(0, 10), qty: p.qty, description: p.description, part_no: p.part_no, name_en: p.name_en, name_ar: p.name_ar })));
    v.receptions = (await all('receptions', W('vehicle_id', '==', v.id))).sort((a, b) => (a.date < b.date ? 1 : -1));
    v.diagnoses = (await all('diagnoses', W('vehicle_id', '==', v.id))).sort((a, b) => (a.date < b.date ? 1 : -1));
    v.reminders = (await all('reminders', W('vehicle_id', '==', v.id))).map((r) => ({ ...r, name_ar: r.service_name_ar, name_en: r.service_name_en })).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    return v;
  });
  route('POST', '/api/receptions/:id/work-order', SHOP, async ({ params, body }) => {
    const r = await mustRow('receptions', params.id);
    if (r.work_order_id && (await getRow('work_orders', r.work_order_id))) return { id: r.work_order_id, existing: true };
    const d = r.diagnosis_id ? await getRow('diagnoses', r.diagnosis_id) : null;
    const desc = [r.complaints, d && d.recommendations].filter(Boolean).join('\n---\n');
    const wo = await createResource('work_orders', { reception_id: r.id, diagnosis_id: d ? d.id : null, vehicle_id: r.vehicle_id, mileage: r.mileage, advisor_ids: r.advisor_ids || r.advisor_id || '', description: desc, priority: body.priority || 'normal' });
    return { id: wo.id };
  });

  route('GET', '/api/work-orders/:id/full', ANY, ({ params }) => woFull(params.id));
  route('POST', '/api/work-orders/:id/status', SHOP, async ({ params, body }) => { await setWoStatus(params.id, body.status); return woFull(params.id); });
  route('POST', '/api/work-orders/:id/labor', SHOP, async ({ params, body }) => {
    const w = await editableWo(params.id);
    let { service_type_id, description, technician_id, hours, rate } = body;
    if (service_type_id) {
      const s = (await serviceTypes()).find((x) => x.id === String(service_type_id));
      if (s) {
        if (hours === undefined || hours === '' || hours === null) hours = s.labor_hours || 1;
        if (rate === undefined || rate === '' || rate === null) rate = s.labor_hours ? r2(s.labor_price / (s.labor_hours || 1)) : s.labor_price;
      }
    }
    if (!service_type_id && !description) throw bad('required', { field: 'description' });
    hours = num(hours, 1); rate = num(rate, num(await getSetting('labor_rate', '0')));
    const amount = body.amount !== undefined && body.amount !== '' && body.amount !== null ? r2(body.amount) : r2(hours * rate);
    const labor = [...(w.labor || []), clean({ id: `${w.id}_${rid()}`, service_type_id: service_type_id ? String(service_type_id) : null, description: description || null, technician_id: technician_id ? String(technician_id) : null, hours, rate, amount, done: 0 })];
    await saveLines(w.id, labor, w.parts || []);
    return woFull(w.id);
  });
  route('PUT', '/api/wo-labor/:id', SHOP, async ({ params, body }) => {
    const wid = woIdOf(params.id);
    const w = await mustRow('work_orders', wid);
    const labor = [...(w.labor || [])]; const i = labor.findIndex((l) => l.id === params.id);
    if (i < 0) throw new ApiError(404, 'not_found');
    const l = labor[i];
    if (body.done !== undefined && Object.keys(body).length === 1) labor[i] = { ...l, done: body.done ? 1 : 0 };
    else {
      await editableWo(wid);
      const hours = num(body.hours, l.hours); const rate = num(body.rate, l.rate);
      const amount = body.amount !== undefined && body.amount !== '' && body.amount !== null ? r2(body.amount) : r2(hours * rate);
      labor[i] = { ...l, description: body.description !== undefined ? body.description : l.description, technician_id: body.technician_id !== undefined ? (body.technician_id ? String(body.technician_id) : null) : l.technician_id, hours, rate, amount, done: body.done !== undefined ? (body.done ? 1 : 0) : l.done };
    }
    await saveLines(wid, labor, w.parts || []);
    return woFull(wid);
  });
  route('DELETE', '/api/wo-labor/:id', SHOP, async ({ params }) => {
    const wid = woIdOf(params.id); const w = await editableWo(wid);
    await saveLines(wid, (w.labor || []).filter((l) => l.id !== params.id), w.parts || []);
    return woFull(wid);
  });
  route('POST', '/api/work-orders/:id/parts', [...SHOP, 'storekeeper'], async ({ params, body }) => {
    const w = await editableWo(params.id);
    const qty = num(body.qty, 1);
    if (!(qty > 0)) throw bad('invalid_qty');
    const lineId = `${w.id}_${rid()}`;
    let line;
    if (body.part_id) {
      const p = await mustRow('parts', body.part_id);
      const price = body.unit_price !== undefined && body.unit_price !== '' && body.unit_price !== null ? r2(body.unit_price) : num(p.price);
      await stockMove(p.id, 'out', qty, p.cost, 'work_order', w.id, `WO part ${lineId}`);
      line = { id: lineId, part_id: p.id, part_no: p.part_no || null, name_en: p.name_en, name_ar: p.name_ar || null, description: body.description || null, qty, unit_price: price, unit_cost: num(p.cost), amount: r2(qty * price), technician_id: body.technician_id ? String(body.technician_id) : null };
    } else {
      if (!body.description) throw bad('required', { field: 'description' });
      const price = r2(body.unit_price);
      line = { id: lineId, part_id: null, description: body.description, qty, unit_price: price, unit_cost: r2(body.unit_cost), amount: r2(qty * price), technician_id: body.technician_id ? String(body.technician_id) : null };
    }
    const fresh = await mustRow('work_orders', w.id);
    await saveLines(w.id, fresh.labor || [], [...(fresh.parts || []), clean(line)]);
    return woFull(w.id);
  });
  route('PUT', '/api/wo-parts/:id', [...SHOP, 'storekeeper'], async ({ params, body }) => {
    const wid = woIdOf(params.id); const w = await editableWo(wid);
    const parts = [...(w.parts || [])]; const i = parts.findIndex((p) => p.id === params.id);
    if (i < 0) throw new ApiError(404, 'not_found');
    const wp = parts[i];
    const qty = num(body.qty, wp.qty); if (!(qty > 0)) throw bad('invalid_qty');
    const price = num(body.unit_price, wp.unit_price);
    const diff = r2(qty - wp.qty);
    if (wp.part_id && diff > 0) await stockMove(wp.part_id, 'out', diff, wp.unit_cost, 'work_order', wid, 'WO qty change');
    if (wp.part_id && diff < 0) await stockMove(wp.part_id, 'return', -diff, wp.unit_cost, 'work_order', wid, 'WO qty change');
    parts[i] = { ...wp, qty, unit_price: price, amount: r2(qty * price), technician_id: body.technician_id !== undefined ? (body.technician_id ? String(body.technician_id) : null) : wp.technician_id, description: body.description !== undefined ? body.description : wp.description };
    await saveLines(wid, w.labor || [], parts);
    return woFull(wid);
  });
  route('DELETE', '/api/wo-parts/:id', [...SHOP, 'storekeeper'], async ({ params }) => {
    const wid = woIdOf(params.id); const w = await editableWo(wid);
    const wp = (w.parts || []).find((p) => p.id === params.id);
    if (!wp) throw new ApiError(404, 'not_found');
    if (wp.part_id) await stockMove(wp.part_id, 'return', wp.qty, wp.unit_cost, 'work_order', wid, 'Removed from WO');
    await saveLines(wid, w.labor || [], (w.parts || []).filter((p) => p.id !== params.id));
    return woFull(wid);
  });
  route('POST', '/api/work-orders/:id/invoice', BILL, ({ params, body }) => invoiceFromWo(params.id, body));

  route('POST', '/api/invoices', BILL, ({ body }) => manualInvoice(body));
  route('GET', '/api/invoices/:id/full', BILL, ({ params }) => invoiceFull(params.id));
  route('POST', '/api/invoices/:id/payments', [...MONEY, 'advisor'], async ({ params, body }) => { await addInvoicePayment(params.id, body); return invoiceFull(params.id); });
  route('POST', '/api/invoices/:id/discount', MGMT, async ({ params, body }) => {
    const inv = await mustRow('invoices', params.id);
    if (inv.status === 'cancelled') throw bad('invoice_cancelled');
    const tt = totals(inv.items || [], body.discount, body.tax_rate !== undefined ? body.tax_rate : inv.tax_rate);
    if (inv.paid > tt.total + 0.009) throw bad('amount_exceeds_due');
    const status = invStatus(tt.total, inv.paid);
    await F.updateDoc(ref('invoices', inv.id), { ...tt, status, open: ['unpaid', 'partial'].includes(status), total_eff: tt.total });
    await F.updateDoc(ref('customers', inv.customer_id), { balance: inc(r2(tt.total - inv.total)) });
    await audit('discount', 'invoices', inv.id, body);
    return invoiceFull(inv.id);
  });
  route('PUT', '/api/invoices/:id/full', MONEY, ({ params, body }) => editInvoice(params.id, body));
  route('DELETE', '/api/invoices/:id', MGMT, async ({ params }) => { await deleteInvoice(params.id); return { ok: true }; });
  route('POST', '/api/invoices/:id/cancel', MGMT, async ({ params }) => { await cancelInvoice(params.id); return invoiceFull(params.id); });

  route('POST', '/api/purchases', SUPP, ({ body }) => createPurchase(body));
  route('GET', '/api/purchases/:id/full', SUPP, ({ params }) => purchaseFull(params.id));
  route('POST', '/api/purchases/:id/payments', MONEY, async ({ params, body }) => { await addPurchasePayment(params.id, body); return purchaseFull(params.id); });
  route('PUT', '/api/purchases/:id', MONEY, ({ params, body }) => editPurchase(params.id, body));
  route('DELETE', '/api/purchases/:id', MGMT, async ({ params }) => { await deletePurchase(params.id); return { ok: true }; });
  route('GET', '/api/suppliers/:id/statement', SUPP, async ({ params }) => {
    const s = await getResource('suppliers', params.id);
    const rows = [];
    for (const p of await all('purchases', W('supplier_id', '==', s.id))) rows.push({ date: p.date, type: p.is_return ? 'purchase_return' : 'purchase', ref: p.no, ref_id: p.id, debit: p.is_return ? p.total : 0, credit: p.is_return ? 0 : p.total, notes: p.supplier_invoice_no, _c: p.created_at });
    for (const t of await all('transactions', W('party_type', '==', 'supplier'), W('party_id', '==', s.id))) rows.push({ date: t.date, type: t.category, ref: t.description, debit: t.direction === 'out' ? t.amount : 0, credit: t.direction === 'in' ? t.amount : 0, notes: t.method, _c: t.created_at });
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a._c < b._c ? -1 : 1));
    let bal = num(s.opening_balance);
    for (const r of rows) { bal = r2(bal + r.credit - r.debit); r.balance = bal; delete r._c; }
    return { supplier: s, rows, opening_balance: num(s.opening_balance) };
  });
  route('POST', '/api/suppliers/:id/payments', MONEY, async ({ params, body }) => {
    const s = await mustRow('suppliers', params.id);
    if (!(num(body.amount) > 0) || !body.account_id) throw bad('invalid_amount');
    await addTx({ date: body.date, account_id: body.account_id, direction: 'out', amount: body.amount, category: 'supplier_payment', description: body.description || `Payment to ${s.name}`, party_type: 'supplier', party_id: s.id, method: body.method || 'cash' });
    return { ok: true };
  });
  route('POST', '/api/stock/adjust', STORE, async ({ body }) => {
    const { part_id, type, qty, notes } = body;
    if (!part_id || !['in', 'out', 'adjust'].includes(type)) throw bad('required');
    if (type === 'adjust') {
      const p = await mustRow('parts', part_id);
      const delta = r2(num(qty) - num(p.qty));
      if (delta) await stockMove(part_id, 'adjust', delta, p.cost, 'stocktake', null, notes || 'Stock count');
    } else {
      if (!(num(qty) > 0)) throw bad('invalid_qty');
      await stockMove(part_id, type, num(qty), num(body.unit_cost), 'manual', null, notes);
    }
    return getResource('parts', part_id);
  });
  route('POST', '/api/transfer', MONEY, async ({ body }) => {
    const amount = r2(body.amount);
    if (!(amount > 0) || !body.from || !body.to || body.from === body.to) throw bad('invalid_transfer');
    const refId = 'T' + Date.now();
    await addTx({ date: body.date, account_id: body.from, direction: 'out', amount, category: 'transfer', description: body.description || 'Transfer', ref_type: 'transfer', ref_id: refId });
    await addTx({ date: body.date, account_id: body.to, direction: 'in', amount, category: 'transfer', description: body.description || 'Transfer', ref_type: 'transfer', ref_id: refId });
    return { ok: true };
  });
  route('GET', '/api/cash/daily', MONEY, async ({ query }) => {
    const date = query.date || today();
    const accs = (await all('accounts')).filter((a) => Number(a.active)).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const after = await all('transactions', W('date', '>=', date));
    const accounts = accs.map((a) => {
      const mine = after.filter((t) => t.account_id === a.id);
      const later = mine.filter((t) => t.date > date).reduce((s, t) => s + t.signed, 0);
      const cin = mine.filter((t) => t.date === date && t.direction === 'in').reduce((s, t) => s + t.amount, 0);
      const cout = mine.filter((t) => t.date === date && t.direction === 'out').reduce((s, t) => s + t.amount, 0);
      const closing = r2(num(a.balance) - later);
      return { id: a.id, name: a.name, type: a.type, opening: r2(closing - cin + cout), cash_in: r2(cin), cash_out: r2(cout), closing };
    });
    const g = {};
    after.filter((t) => t.date === date).forEach((t) => { const k = t.category + '|' + t.direction; g[k] = g[k] || { category: t.category, direction: t.direction, amount: 0, n: 0 }; g[k].amount += t.amount; g[k].n++; });
    return { date, accounts, by_category: Object.values(g).map((x) => ({ ...x, amount: r2(x.amount) })) };
  });
  route('POST', '/api/transactions', MONEY, async ({ body }) => {
    if (!['in', 'out'].includes(body.direction)) throw bad('invalid_direction');
    if (!(num(body.amount) > 0)) throw bad('invalid_amount');
    if (!body.account_id || !body.category) throw bad('required');
    const t = await addTx(body);
    await audit('create', 'transactions', t.id);
    return t;
  });
  route('GET', '/api/bonuses/commissions', MONEY, ({ query }) => commissions(query.from || today().slice(0, 8) + '01', query.to || today()));
  route('POST', '/api/bonuses/commissions/approve', MONEY, async ({ body }) => {
    const { from, to } = body;
    if (!from || !to) throw bad('required');
    const period = body.period || from.slice(0, 7);
    let n = 0;
    for (const c of await commissions(from, to)) {
      const remaining = r2(c.commission - c.commission_recorded);
      if (remaining > 0) { await createResource('bonuses', { employee_id: c.employee_id, date: to, period, type: 'commission', amount: remaining, reason: `Commission ${from} → ${to}` }); n++; }
    }
    return { ok: true, created: n };
  });
  route('GET', '/api/payroll', MONEY, ({ query }) => payroll(query.period || today().slice(0, 7)));
  route('POST', '/api/advances', MONEY, ({ body }) => giveAdvance(body));
  route('POST', '/api/payroll/pay', MONEY, ({ body }) => payPayroll(body));
  route('GET', '/api/attendance', ATT_READ, async ({ query }) => {
    const date = query.date || today();
    const list = (await emps()).filter((e) => Number(e.active)).sort((a, b) => (a.name < b.name ? -1 : 1));
    const recs = (await all('attendance', W('date', '==', date))).map(fixAtt);
    const st = await settings();
    const work = !PAY.config(st).weekend.includes(PAY.weekday(date));
    return {
      date, work_day: work,
      rows: list.map((e) => {
        const r = recs.find((x) => x.employee_id === e.id) || null;
        const cfg = PAY.empConfig(e, st); // the employee's own schedule
        const wd = !cfg.weekend.includes(PAY.weekday(date));
        return { employee_id: e.id, name: e.name, job: e.job, record: r, work_day: wd, schedule: `${e.work_start || st.work_start || '09:00'}-${e.work_end || st.work_end || '17:00'}`, by_attendance: cfg.byAttendance, ...PAY.dayStats(r, cfg, wd) };
      }),
    };
  });
  route('GET', '/api/attendance/month', ANY, async ({ query }) => {
    const period = query.period || today().slice(0, 7);
    const mgr = hasAny(ATT_READ);
    const empId = mgr ? String(query.employee_id || me.employee_id || '') : String(me.employee_id || '');
    const e = empId ? await getRow('employees', empId) : null;
    if (!e) throw new ApiError(404, 'not_found');
    const res = await attendanceCalc(e, period);
    if (!mgr) for (const k of ['salary', 'salary_due', 'absence_deduction', 'late_deduction', 'overtime_pay']) delete res[k];
    return { employee: { id: e.id, name: e.name, job: e.job, pay_type: e.pay_type }, period, ...res };
  });
  route('GET', '/api/attendance/me', ANY, async () => {
    if (!me.employee_id) return { linked: false };
    const r = await getRow('attendance', attId(me.employee_id, today())).catch(() => null);
    return { linked: true, date: today(), record: fixAtt(r) };
  });
  // attendance is recorded by the manager / accountant only (server timestamp)
  const ATT_WRITE = ['admin', 'manager', 'accountant'];
  route('POST', '/api/attendance/punch', ATT_WRITE, async ({ body }) => {
    const mgr = true;
    const empId = String(body.employee_id || '');
    if (!empId) throw bad('required', { field: 'employee_id' });
    const e = await mustRow('employees', empId);
    const d = today(); const id = attId(empId, d);
    const r = await getRow('attendance', id).catch(() => null);
    const tm = nowStr().slice(11, 16);
    if (body.action === 'out') {
      if (!r || !r.check_in) throw bad('not_checked_in');
      if (r.check_out && !mgr) throw bad('already_checked_out');
      await F.updateDoc(ref('attendance', id), { check_out: tm, check_out_at: F.serverTimestamp() });
    } else if (r) {
      if (r.check_in && !mgr) throw bad('already_checked_in');
      await F.updateDoc(ref('attendance', id), { status: 'present', check_in: tm, check_in_at: F.serverTimestamp() });
    } else {
      await F.setDoc(ref('attendance', id), { employee_id: empId, employee_name: e.name, date: d, period: d.slice(0, 7), status: 'present', check_in: tm, check_in_at: F.serverTimestamp(), created_at: nowStr(), self: !mgr });
    }
    await audit('punch:' + (body.action || 'in'), 'attendance', empId);
    return fixAtt(await getRow('attendance', id));
  });
  route('PUT', '/api/attendance', ATT_WRITE, async ({ body }) => {
    const empId = String(body.employee_id || ''); const date = String(body.date || '').slice(0, 10);
    if (!empId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('required');
    const e = await mustRow('employees', empId);
    const status = ATT_STATUSES.includes(body.status) ? body.status : 'present';
    const hm = (v) => (v && /^\d{1,2}:\d{2}/.test(v) ? String(v).slice(0, 5).padStart(5, '0') : null);
    const d = { employee_id: empId, employee_name: e.name, date, period: date.slice(0, 7), status, check_in: status === 'present' ? hm(body.check_in) : null,
      check_out: status === 'present' ? hm(body.check_out) : null, check_in_at: null, check_out_at: null, notes: body.notes || null, updated_by: me.id, created_at: nowStr() };
    await F.setDoc(ref('attendance', attId(empId, date)), d);
    await audit('update', 'attendance', empId, { date, status });
    return { ...d, id: attId(empId, date) };
  });
  route('DELETE', '/api/attendance/:id', ATT_WRITE, async ({ params }) => { await F.deleteDoc(ref('attendance', params.id)); return { ok: true }; });

  route('GET', '/api/reminders/due', FRONT, async ({ query }) => {
    const days = num(query.days, num(await getSetting('reminder_days_ahead', '30')));
    const t = today();
    const a = await all('reminders', W('open', '==', true), W('due_date', '<=', addDays(t, days)));
    const b = await all('reminders', W('km_due', '==', true));
    const m = new Map(); [...a, ...b].forEach((r) => { if (r.open) m.set(r.id, r); });
    const rows = [...m.values()].sort((x, y) => (x.due_date < y.due_date ? -1 : 1));
    rows.forEach((r) => { delete r.kw; r.overdue = (r.due_date && r.due_date < t) || (r.due_mileage && r.current_mileage >= r.due_mileage) ? 1 : 0; });
    return { rows };
  });
  // attachments: compressed images stored as data URLs in Firestore (no Cloud Storage needed on Spark)
  route('POST', '/api/attachments', ANY, async ({ body }) => {
    const { ref_type, ref_id, name, mime } = body;
    let { data } = body;
    if (!ref_type || !ref_id || !data) throw bad('required');
    if (!/^image\/(jpeg|png|webp|gif)$|^application\/pdf$/.test(mime || '')) throw bad('invalid_file_type');
    if (mime.startsWith('image/') && data.length > 700000) data = await shrink(data, 1100, 0.7);
    if (data.length > 900000) throw bad('file_too_large');
    const r = newRef('attachments');
    const d = { ref_type, ref_id: String(ref_id), original_name: name || null, mime, size: data.length, data, created_at: nowStr() };
    await F.setDoc(r, d);
    return { ...d, id: r.id };
  });
  const shrink = (dataUrl, max, quality) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', quality)); };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
  route('GET', '/api/attachments', ANY, async ({ query }) => ({ rows: (await all('attachments', W('ref_type', '==', query.ref_type), W('ref_id', '==', String(query.ref_id)))).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)) }));
  route('DELETE', '/api/attachments/:id', [...FRONT, 'technician'], async ({ params }) => { await F.deleteDoc(ref('attachments', params.id)); return { ok: true }; });
  route('GET', '/api/reports/summary', MONEY, ({ query }) => reports(query.from || today().slice(0, 8) + '01', query.to || today()));
  route('GET', '/api/audit', ['admin'], async ({ query }) => ({ rows: await all('audit_log', O('created_at', 'desc'), L(Math.min(num(query.limit, 300), 1000))) }));

  for (const [name, def] of Object.entries(RES)) {
    const p = '/api/' + name.replace(/_/g, '-');
    route('GET', p, def.read, ({ query }) => listResource(name, def, query));
    route('GET', p + '/:id', def.read, ({ params }) => getResource(name, params.id));
    if (name !== 'transactions') route('POST', p, def.write, ({ body }) => createResource(name, body));
    route('PUT', p + '/:id', def.write, ({ params, body }) => updateResource(name, params.id, body));
    route('DELETE', p + '/:id', def.deleteRoles || MGMT, ({ params }) => deleteResource(name, params.id));
  }

  // ------------------------------------------------------------------ G.api replacement
  const MSG = {
    fb_admin_password: ['لا يمكن للمدير تغيير كلمة مرور مستخدم آخر على Firebase: يغيّرها المستخدم بنفسه، أو احذف المستخدم وأنشئه من جديد', 'On Firebase an admin cannot change another user\'s password: the user changes it, or delete and re-create the user'],
    invalid_username: ['اسم المستخدم: حروف إنجليزية صغيرة وأرقام فقط (3 أحرف على الأقل)', 'Username: lowercase English letters and digits only (min 3)'],
    already_setup: ['تم إعداد النظام بالفعل', 'System is already set up'],
  };
  Object.entries(MSG).forEach(([k, v]) => { window.I18N['err_' + k] = v; });
  G.api = async (method, url, body) => {
    await authReady;
    const u = new URL(url, location.origin);
    const r = routes.find((x) => x.method === method && x.re.test(u.pathname));
    try {
      if (!r) throw new ApiError(404, 'not_found');
      if (r.roles) need(r.roles);
      const m = u.pathname.match(r.re); const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return await r.handler({ params, query: Object.fromEntries(u.searchParams.entries()), body: body || {} });
    } catch (e) {
      let code = e.code; let extra = e.extra || {};
      if (!(e instanceof ApiError)) {
        console.error(e);
        if (code === 'permission-denied') code = 'forbidden';
        else if (code === 'unavailable') code = 'network';
        else if (String(code || '').startsWith('auth/')) code = code === 'auth/network-request-failed' ? 'network' : 'server_error';
        else { extra = { message: e.message }; code = 'server_error'; }
      }
      if (code === 'unauthorized' && !url.includes('/api/auth/')) { G.user = null; G.showLogin(); }
      let msg = G.t('err_' + code);
      if (msg === 'err_' + code) msg = code;
      if (extra.field) msg += `: ${G.t(String(extra.field).replace(/_id$/, ''))}`;
      if (extra.part) msg += ` (${extra.part} - ${G.t('in_stock')}: ${extra.available})`;
      if (extra.due !== undefined) msg += ` (${G.t('due')}: ${extra.due})`;
      if (code === 'server_error' && extra.message) msg += ': ' + extra.message;
      const err = new Error(msg); err.code = code; throw err;
    }
  };
}
