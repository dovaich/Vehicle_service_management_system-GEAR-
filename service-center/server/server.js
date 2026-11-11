'use strict';
// GEAR Service Center - zero-dependency HTTP server
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const D = require('./db');
const PAY = require('../public/js/payroll-calc');
const { all, get, run, tx, getSetting } = D;

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOAD_DIR = path.join(D.DATA_DIR, 'uploads');

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
const bad = (code, extra) => new HttpError(400, code, extra);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n, d = 0) => (n === '' || n === null || n === undefined || isNaN(Number(n)) ? d : Number(n));
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const nowStr = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
};
function addMonths(dateStr, months) {
  const d = new Date((dateStr || today()).slice(0, 10) + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + Number(months));
  return d.toISOString().slice(0, 10);
}
function sqlVal(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}
function setNo(table, prefix, id) {
  const no = `${prefix}-${String(id).padStart(5, '0')}`;
  run(`UPDATE ${table} SET no = ? WHERE id = ?`, no, id);
  return no;
}
function audit(user, action, entity, id, details) {
  try {
    run('INSERT INTO audit_log(user_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)', user ? user.id : null, action, entity, id || null, details ? JSON.stringify(details).slice(0, 2000) : null);
  } catch (_) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------
const ROLES = ['admin', 'manager', 'advisor', 'technician', 'accountant', 'storekeeper'];
const ANY = ROLES;
const FRONT = ['admin', 'manager', 'advisor'];
const SHOP = ['admin', 'manager', 'advisor', 'technician'];
const MONEY = ['admin', 'manager', 'accountant'];
const STORE = ['admin', 'manager', 'storekeeper'];
const MGMT = ['admin', 'manager'];

// a user has a main role plus optional extra roles (e.g. accountant + storekeeper)
const parseRoles = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter((x) => ROLES.includes(x));
const rolesOf = (u) => (u ? [...new Set([u.role, ...parseRoles(u.extra_roles)])] : []);
const hasAny = (u, roles) => rolesOf(u).some((r) => roles.includes(r));
const onlyIn = (u, roles) => rolesOf(u).every((r) => roles.includes(r)); // every role is restricted
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, roles: rolesOf(u), employee_id: u.employee_id });
function need(user, roles) {
  if (!user) throw new HttpError(401, 'unauthorized');
  if (!hasAny(user, roles)) throw new HttpError(403, 'forbidden');
}

// ---------------------------------------------------------------------------
// Generic resources (CRUD)
// ---------------------------------------------------------------------------
const RES = {
  customers: {
    table: 'customers',
    cols: ['name', 'phone', 'phone2', 'email', 'address', 'type', 'tax_no', 'notes'],
    required: ['name'],
    select: `SELECT c.*, (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id=c.id) AS vehicles_count,
             ROUND((SELECT COALESCE(SUM(total-paid),0) FROM invoices i WHERE i.customer_id=c.id AND i.status!='cancelled'),2) AS balance
             FROM customers c`,
    alias: 'c',
    search: ['c.name', 'c.phone', 'c.phone2', 'c.email', 'c.tax_no',
      "(SELECT group_concat(plate||' '||COALESCE(vin,''),' ') FROM vehicles WHERE customer_id=c.id)"],
    filters: { type: 'c.type' },
    order: 'c.id DESC',
    read: ANY, write: FRONT,
  },
  vehicles: {
    table: 'vehicles',
    cols: ['customer_id', 'plate', 'vin', 'make', 'series', 'model', 'chassis_code', 'year', 'color', 'engine', 'fuel', 'transmission', 'mileage', 'warranty_until', 'notes'],
    required: ['customer_id'],
    select: `SELECT v.*, c.name AS customer_name, c.phone AS customer_phone FROM vehicles v LEFT JOIN customers c ON c.id=v.customer_id`,
    alias: 'v',
    search: ['v.plate', 'v.vin', 'v.model', 'v.series', 'v.chassis_code', 'c.name', 'c.phone'],
    filters: { customer_id: 'v.customer_id', series: 'v.series' },
    order: 'v.id DESC',
    read: ANY, write: FRONT,
  },
  employees: {
    table: 'employees',
    cols: ['name', 'phone', 'job', 'national_id', 'hire_date', 'pay_type', 'pay_cycle', 'attendance_based', 'work_start', 'work_end', 'weekend_days', 'salary', 'labor_commission', 'parts_commission', 'active', 'notes'],
    required: ['name'],
    select: 'SELECT e.* FROM employees e',
    alias: 'e',
    search: ['e.name', 'e.phone', 'e.job'],
    filters: { job: 'e.job', active: 'e.active' },
    order: 'e.active DESC, e.name',
    read: ANY, write: MGMT,
    hideFor: { roles: ['advisor', 'technician', 'storekeeper'], cols: ['salary', 'national_id'] },
  },
  service_types: {
    table: 'service_types',
    cols: ['code', 'name_ar', 'name_en', 'category', 'labor_hours', 'labor_price', 'interval_km', 'interval_months', 'active'],
    required: ['name_en'],
    select: 'SELECT s.* FROM service_types s',
    alias: 's',
    search: ['s.code', 's.name_ar', 's.name_en', 's.category'],
    filters: { category: 's.category', active: 's.active' },
    order: 's.category, s.name_en',
    read: ANY, write: MGMT,
  },
  appointments: {
    table: 'appointments',
    cols: ['customer_id', 'vehicle_id', 'date', 'time', 'service', 'advisor_id', 'status', 'notes'],
    required: ['customer_id', 'date'],
    select: `SELECT a.*, c.name AS customer_name, c.phone AS customer_phone, v.plate, v.model, v.series, e.name AS advisor_name
             FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN vehicles v ON v.id=a.vehicle_id
             LEFT JOIN employees e ON e.id=a.advisor_id`,
    alias: 'a',
    search: ['c.name', 'c.phone', 'v.plate', 'a.service'],
    filters: { status: 'a.status', customer_id: 'a.customer_id', vehicle_id: 'a.vehicle_id' },
    dateCol: 'a.date',
    order: 'a.date DESC, a.time DESC',
    read: ANY, write: FRONT,
  },
  receptions: {
    table: 'receptions',
    cols: ['vehicle_id', 'customer_id', 'date', 'mileage', 'fuel_level', 'complaints', 'checklist', 'damages', 'belongings', 'warning_lights', 'advisor_id', 'advisor_ids', 'expected_delivery', 'driver_name', 'driver_phone', 'status', 'notes'],
    required: ['vehicle_id'],
    select: `SELECT r.*, c.name AS customer_name, c.phone AS customer_phone, v.plate, v.vin, v.model, v.series, v.color, v.year,
             COALESCE((SELECT group_concat(x.name, '، ') FROM employees x WHERE r.advisor_ids IS NOT NULL AND (',' || r.advisor_ids || ',') LIKE ('%,' || x.id || ',%')), e.name) AS advisor_name, (SELECT id FROM work_orders w WHERE w.reception_id=r.id LIMIT 1) AS work_order_id,
             (SELECT id FROM diagnoses d WHERE d.reception_id=r.id ORDER BY d.id DESC LIMIT 1) AS diagnosis_id
             FROM receptions r LEFT JOIN customers c ON c.id=r.customer_id LEFT JOIN vehicles v ON v.id=r.vehicle_id
             LEFT JOIN employees e ON e.id=r.advisor_id`,
    alias: 'r',
    search: ['r.no', 'c.name', 'c.phone', 'v.plate', 'v.vin', 'r.complaints'],
    filters: { status: 'r.status', vehicle_id: 'r.vehicle_id', customer_id: 'r.customer_id' },
    dateCol: 'r.date',
    order: 'r.id DESC',
    read: ANY, write: FRONT,
    beforeSave(data) {
      normalizeAdvisors(data);
      if (data.vehicle_id && !data.customer_id) {
        const v = get('SELECT customer_id FROM vehicles WHERE id=?', data.vehicle_id);
        if (!v) throw bad('vehicle_not_found');
        data.customer_id = v.customer_id;
      }
    },
    afterCreate(id, data) {
      setNo('receptions', 'RC', id);
      if (num(data.mileage) > 0) run('UPDATE vehicles SET mileage=? WHERE id=? AND COALESCE(mileage,0) < ?', num(data.mileage), data.vehicle_id, num(data.mileage));
    },
  },
  diagnoses: {
    table: 'diagnoses',
    cols: ['reception_id', 'vehicle_id', 'technician_id', 'date', 'tool', 'fault_codes', 'findings', 'recommendations', 'estimated_cost', 'estimated_hours', 'approval', 'notes'],
    required: ['vehicle_id'],
    select: `SELECT d.*, v.plate, v.model, v.series, v.vin, c.name AS customer_name, c.phone AS customer_phone, e.name AS technician_name, r.no AS reception_no
             FROM diagnoses d LEFT JOIN vehicles v ON v.id=d.vehicle_id LEFT JOIN customers c ON c.id=v.customer_id
             LEFT JOIN employees e ON e.id=d.technician_id LEFT JOIN receptions r ON r.id=d.reception_id`,
    alias: 'd',
    search: ['v.plate', 'v.vin', 'c.name', 'd.fault_codes', 'd.findings', 'r.no'],
    filters: { approval: 'd.approval', vehicle_id: 'd.vehicle_id', reception_id: 'd.reception_id', technician_id: 'd.technician_id' },
    dateCol: 'd.date',
    order: 'd.id DESC',
    read: ANY, write: SHOP,
    beforeSave(data) {
      if (data.reception_id && !data.vehicle_id) {
        const r = get('SELECT vehicle_id FROM receptions WHERE id=?', data.reception_id);
        if (r) data.vehicle_id = r.vehicle_id;
      }
    },
    afterCreate(id, data) {
      if (data.reception_id) run("UPDATE receptions SET status='diagnosed' WHERE id=? AND status='open'", data.reception_id);
    },
  },
  work_orders: {
    table: 'work_orders',
    cols: ['reception_id', 'diagnosis_id', 'vehicle_id', 'customer_id', 'date', 'mileage', 'priority', 'bay', 'advisor_id', 'advisor_ids', 'description', 'qc_checklist', 'qc_by', 'notes'],
    required: ['vehicle_id'],
    select: `SELECT w.*, c.name AS customer_name, c.phone AS customer_phone, v.plate, v.model, v.series, v.vin, COALESCE((SELECT group_concat(x.name, '، ') FROM employees x WHERE w.advisor_ids IS NOT NULL AND (',' || w.advisor_ids || ',') LIKE ('%,' || x.id || ',%')), e.name) AS advisor_name,
             i.no AS invoice_no, i.status AS invoice_status,
             (SELECT COALESCE(SUM(amount),0) FROM wo_labor WHERE work_order_id=w.id) AS labor_total,
             (SELECT COALESCE(SUM(amount),0) FROM wo_parts WHERE work_order_id=w.id) AS parts_total,
             (SELECT group_concat(DISTINCT t.name) FROM wo_labor l JOIN employees t ON t.id=l.technician_id WHERE l.work_order_id=w.id) AS technicians
             FROM work_orders w LEFT JOIN customers c ON c.id=w.customer_id LEFT JOIN vehicles v ON v.id=w.vehicle_id
             LEFT JOIN employees e ON e.id=w.advisor_id LEFT JOIN invoices i ON i.id=w.invoice_id`,
    alias: 'w',
    search: ['w.no', 'c.name', 'c.phone', 'v.plate', 'v.vin', 'w.description'],
    filters: { status: 'w.status', vehicle_id: 'w.vehicle_id', customer_id: 'w.customer_id', priority: 'w.priority' },
    dateCol: 'w.date',
    order: 'w.id DESC',
    read: ANY, write: SHOP,
    beforeSave(data) {
      normalizeAdvisors(data);
      if (data.vehicle_id && !data.customer_id) {
        const v = get('SELECT customer_id FROM vehicles WHERE id=?', data.vehicle_id);
        if (!v) throw bad('vehicle_not_found');
        data.customer_id = v.customer_id;
      }
    },
    afterCreate(id, data) {
      setNo('work_orders', 'WO', id);
      if (data.reception_id) run("UPDATE receptions SET status='in_work' WHERE id=? AND status IN ('open','diagnosed')", data.reception_id);
    },
    beforeDelete(id) {
      const w = get('SELECT invoice_id FROM work_orders WHERE id=?', id);
      if (w && w.invoice_id) throw bad('work_order_invoiced');
      // return parts to stock
      for (const p of all('SELECT * FROM wo_parts WHERE work_order_id=?', id)) {
        if (p.part_id) stockMove(p.part_id, 'return', p.qty, p.unit_cost, 'work_order', id, 'WO deleted', null);
      }
    },
  },
  suppliers: {
    table: 'suppliers',
    cols: ['name', 'contact', 'phone', 'email', 'address', 'tax_no', 'opening_balance', 'notes'],
    required: ['name'],
    select: `SELECT s.*,
             ROUND(s.opening_balance + (SELECT COALESCE(SUM(CASE WHEN is_return=1 THEN -total ELSE total END),0) FROM purchases p WHERE p.supplier_id=s.id)
             - (SELECT COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE -amount END),0) FROM transactions t WHERE t.party_type='supplier' AND t.party_id=s.id),2) AS balance
             FROM suppliers s`,
    alias: 's',
    search: ['s.name', 's.contact', 's.phone', 's.email'],
    filters: {},
    order: 's.name',
    read: ['admin', 'manager', 'accountant', 'storekeeper'], write: ['admin', 'manager', 'accountant', 'storekeeper'],
  },
  parts: {
    table: 'parts',
    cols: ['part_no', 'oem_no', 'name_ar', 'name_en', 'category', 'brand', 'unit', 'min_qty', 'cost', 'price', 'location', 'supplier_id', 'active', 'notes'],
    createCols: ['qty'],
    required: ['name_en'],
    select: 'SELECT p.*, s.name AS supplier_name, ROUND(p.qty*p.cost,2) AS stock_value FROM parts p LEFT JOIN suppliers s ON s.id=p.supplier_id',
    alias: 'p',
    search: ['p.part_no', 'p.oem_no', 'p.name_ar', 'p.name_en', 'p.category', 'p.brand', 'p.location'],
    filters: { category: 'p.category', supplier_id: 'p.supplier_id', active: 'p.active' },
    special: { low: 'p.qty <= p.min_qty' },
    order: 'p.name_en',
    read: ANY, write: STORE,
    hideFor: { roles: ['advisor', 'technician'], cols: ['cost', 'stock_value'] },
    afterCreate(id, data, user) {
      const q = num(data.qty);
      if (q > 0) stockMove(id, 'in', q, num(data.cost), 'opening', null, 'Opening stock', user);
    },
  },
  stock_moves: {
    table: 'stock_moves',
    cols: [],
    select: 'SELECT m.*, p.name_en, p.name_ar, p.part_no, u.name AS user_name FROM stock_moves m LEFT JOIN parts p ON p.id=m.part_id LEFT JOIN users u ON u.id=m.user_id',
    alias: 'm',
    search: ['p.part_no', 'p.name_en', 'p.name_ar', 'm.notes', 'm.ref_type'],
    filters: { part_id: 'm.part_id', type: 'm.type' },
    dateCol: 'm.date',
    order: 'm.id DESC',
    read: ['admin', 'manager', 'storekeeper', 'accountant'], write: [],
  },
  purchases: {
    table: 'purchases',
    cols: ['supplier_invoice_no', 'notes', 'date'],
    select: 'SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id',
    alias: 'p',
    search: ['p.no', 'p.supplier_invoice_no', 's.name'],
    filters: { supplier_id: 'p.supplier_id', status: 'p.status', is_return: 'p.is_return' },
    dateCol: 'p.date',
    order: 'p.id DESC',
    read: ['admin', 'manager', 'accountant', 'storekeeper'], write: ['admin', 'manager', 'accountant', 'storekeeper'],
    noCreate: true, noDelete: true,
  },
  invoices: {
    table: 'invoices',
    cols: ['notes'],
    select: `SELECT i.*, ROUND(i.total-i.paid,2) AS due, c.name AS customer_name, c.phone AS customer_phone, v.plate, v.model, v.series, w.no AS work_order_no
             FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id LEFT JOIN vehicles v ON v.id=i.vehicle_id LEFT JOIN work_orders w ON w.id=i.work_order_id`,
    alias: 'i',
    search: ['i.no', 'c.name', 'c.phone', 'v.plate', 'w.no'],
    filters: { status: 'i.status', customer_id: 'i.customer_id', vehicle_id: 'i.vehicle_id' },
    special: { unpaid: "i.status IN ('unpaid','partial')" },
    dateCol: 'i.date',
    order: 'i.id DESC',
    read: ['admin', 'manager', 'advisor', 'accountant'], write: ['admin', 'manager', 'advisor', 'accountant'],
    noCreate: true, noDelete: true,
  },
  accounts: {
    table: 'accounts',
    cols: ['name', 'type', 'opening_balance', 'active'],
    required: ['name'],
    select: `SELECT a.*, ROUND(a.opening_balance + (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) FROM transactions t WHERE t.account_id=a.id),2) AS balance FROM accounts a`,
    alias: 'a',
    search: ['a.name'],
    filters: { active: 'a.active' },
    order: 'a.id',
    read: MONEY.concat(['advisor']), write: MGMT,
    beforeDelete(id) {
      if (get('SELECT id FROM transactions WHERE account_id=? LIMIT 1', id)) throw bad('account_has_transactions');
    },
  },
  transactions: {
    table: 'transactions',
    cols: ['date', 'account_id', 'direction', 'amount', 'category', 'description', 'method', 'party_type', 'party_id'],
    required: ['account_id', 'direction', 'amount', 'category'],
    select: `SELECT t.*, a.name AS account_name, u.name AS user_name,
             CASE t.party_type WHEN 'customer' THEN (SELECT name FROM customers WHERE id=t.party_id)
                               WHEN 'supplier' THEN (SELECT name FROM suppliers WHERE id=t.party_id)
                               WHEN 'employee' THEN (SELECT name FROM employees WHERE id=t.party_id) END AS party_name
             FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN users u ON u.id=t.user_id`,
    alias: 't',
    search: ['t.description', 't.category', 'a.name'],
    filters: { account_id: 't.account_id', direction: 't.direction', category: 't.category', party_type: 't.party_type', party_id: 't.party_id' },
    dateCol: 't.date',
    order: 't.date DESC, t.id DESC',
    read: MONEY, write: MONEY,
    noUpdate: true,
    beforeSave(data, user) {
      if (!['in', 'out'].includes(data.direction)) throw bad('invalid_direction');
      if (!(num(data.amount) > 0)) throw bad('invalid_amount');
      data.amount = r2(data.amount);
      data.user_id = user.id;
    },
    beforeDelete(id) {
      const t = get('SELECT * FROM transactions WHERE id=?', id);
      if (t && t.ref_type && t.ref_type !== 'transfer') throw bad('linked_transaction');
      if (t && t.ref_type === 'transfer') run("DELETE FROM transactions WHERE ref_type='transfer' AND ref_id=? AND id!=?", t.ref_id, id);
    },
  },
  bonuses: {
    table: 'bonuses',
    cols: ['employee_id', 'date', 'period', 'type', 'amount', 'reason'],
    required: ['employee_id', 'amount'],
    select: 'SELECT b.*, e.name AS employee_name, e.job FROM bonuses b LEFT JOIN employees e ON e.id=b.employee_id',
    alias: 'b',
    search: ['e.name', 'b.reason', 'b.period'],
    filters: { employee_id: 'b.employee_id', type: 'b.type', paid: 'b.paid', period: 'b.period' },
    dateCol: 'b.date',
    order: 'b.id DESC',
    read: MONEY, write: MONEY,
    beforeSave(data) {
      if (data.type === 'advance') throw bad('use_advance_form'); // advances go through /api/advances (they move cash)
    },
    beforeDelete(id) {
      const b = get('SELECT * FROM bonuses WHERE id=?', id);
      if (b && b.paid) throw bad('already_paid');
      // deleting an unsettled advance gives the money back to the cash account
      if (b && b.type === 'advance' && b.transaction_id) run('DELETE FROM transactions WHERE id=?', b.transaction_id);
    },
  },
  reminders: {
    table: 'reminders',
    cols: ['vehicle_id', 'customer_id', 'service_type_id', 'title', 'due_date', 'due_mileage', 'status', 'notes'],
    required: ['vehicle_id'],
    select: `SELECT m.*, v.plate, v.model, v.series, v.mileage AS current_mileage, c.name AS customer_name, c.phone AS customer_phone,
             s.name_ar AS service_name_ar, s.name_en AS service_name_en
             FROM reminders m LEFT JOIN vehicles v ON v.id=m.vehicle_id LEFT JOIN customers c ON c.id=m.customer_id
             LEFT JOIN service_types s ON s.id=m.service_type_id`,
    alias: 'm',
    search: ['v.plate', 'c.name', 'c.phone', 'm.title', 's.name_ar', 's.name_en'],
    filters: { status: 'm.status', vehicle_id: 'm.vehicle_id', customer_id: 'm.customer_id' },
    dateCol: 'm.due_date',
    order: 'm.due_date ASC',
    read: ANY, write: FRONT,
    beforeSave(data) {
      if (data.vehicle_id && !data.customer_id) {
        const v = get('SELECT customer_id FROM vehicles WHERE id=?', data.vehicle_id);
        if (v) data.customer_id = v.customer_id;
      }
      if (data.status === 'contacted') data.contacted_at = nowStr();
    },
  },
};

// several service advisors per car: advisor_ids = "3,7"; advisor_id keeps the first one
function normalizeAdvisors(data) {
  if (data.advisor_ids !== undefined) {
    const ids = [...new Set(String(data.advisor_ids || '').split(',').map((x) => x.trim()).filter((x) => /^\d+$/.test(x)))];
    data.advisor_ids = ids.length ? ids.join(',') : null;
    data.advisor_id = ids.length ? Number(ids[0]) : null;
  } else if (data.advisor_id !== undefined) {
    data.advisor_ids = data.advisor_id ? String(data.advisor_id) : null;
  }
}

function hideCols(def, user, rows) {
  if (!def.hideFor || !onlyIn(user, def.hideFor.roles)) return rows;
  for (const r of rows) for (const c of def.hideFor.cols) delete r[c];
  return rows;
}

function listResource(def, q, user) {
  const where = [];
  const params = [];
  for (const [k, expr] of Object.entries(def.filters || {})) {
    if (q[k] !== undefined && q[k] !== '') {
      where.push(`${expr} = ?`);
      params.push(q[k]);
    }
  }
  for (const [k, expr] of Object.entries(def.special || {})) {
    if (q[k] === '1') where.push(expr);
  }
  if (def.dateCol) {
    if (q.from) { where.push(`substr(${def.dateCol},1,10) >= ?`); params.push(q.from); }
    if (q.to) { where.push(`substr(${def.dateCol},1,10) <= ?`); params.push(q.to); }
  }
  if (q.q && def.search) {
    const terms = String(q.q).trim().split(/\s+/).slice(0, 5);
    for (const term of terms) {
      where.push('(' + def.search.map((s) => `COALESCE(${s},'') LIKE ?`).join(' OR ') + ')');
      for (let i = 0; i < def.search.length; i++) params.push(`%${term}%`);
    }
  }
  const limit = Math.min(num(q.limit, 200), 2000);
  const offset = num(q.offset, 0);
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = get(`SELECT COUNT(*) AS n FROM (${def.select}${whereSql})`, ...params).n;
  const rows = all(`${def.select}${whereSql} ORDER BY ${def.order} LIMIT ? OFFSET ?`, ...params, limit, offset);
  return { rows: hideCols(def, user, rows), total };
}

function getResource(def, id, user) {
  const row = get(`${def.select} WHERE ${def.alias}.id = ?`, id);
  if (!row) throw new HttpError(404, 'not_found');
  return hideCols(def, user, [row])[0];
}

function pick(data, cols) {
  const out = {};
  for (const c of cols) if (data[c] !== undefined) out[c] = data[c] === '' ? null : data[c];
  return out;
}

function createResource(name, def, body, user) {
  if (def.noCreate) throw new HttpError(405, 'not_allowed');
  const data = pick(body, [...def.cols, ...(def.createCols || [])]);
  return tx(() => {
    if (def.beforeSave) def.beforeSave(data, user, null);
    for (const r of def.required || []) if (data[r] === undefined || data[r] === null || data[r] === '') throw bad('required', { field: r });
    const cols = Object.keys(data).filter((c) => [...def.cols, ...(def.createCols || []), 'customer_id', 'user_id', 'contacted_at'].includes(c));
    // parts opening qty is recorded through a stock movement in afterCreate
    const insertCols = cols.filter((c) => !(name === 'parts' && c === 'qty'));
    const sql = insertCols.length
      ? `INSERT INTO ${def.table}(${insertCols.join(',')}) VALUES(${insertCols.map(() => '?').join(',')})`
      : `INSERT INTO ${def.table} DEFAULT VALUES`;
    const id = Number(run(sql, ...insertCols.map((c) => sqlVal(data[c]))).lastInsertRowid);
    if (def.afterCreate) def.afterCreate(id, data, user);
    audit(user, 'create', name, id);
    return getResource(def, id, user);
  });
}

function updateResource(name, def, id, body, user) {
  if (def.noUpdate) throw new HttpError(405, 'not_allowed');
  const existing = get(`SELECT * FROM ${def.table} WHERE id=?`, id);
  if (!existing) throw new HttpError(404, 'not_found');
  const data = pick(body, def.cols);
  for (const r of def.required || []) if (data[r] === null || data[r] === '') throw bad('required', { field: r });
  return tx(() => {
    if (def.beforeSave) def.beforeSave(data, user, existing);
    const cols = Object.keys(data).filter((c) => [...def.cols, 'customer_id', 'contacted_at'].includes(c));
    if (cols.length) run(`UPDATE ${def.table} SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`, ...cols.map((c) => sqlVal(data[c])), id);
    if (def.afterUpdate) def.afterUpdate(id, data, user, existing);
    audit(user, 'update', name, id);
    return getResource(def, id, user);
  });
}

function deleteResource(name, def, id, user) {
  if (def.noDelete) throw new HttpError(405, 'not_allowed');
  if (!get(`SELECT id FROM ${def.table} WHERE id=?`, id)) throw new HttpError(404, 'not_found');
  tx(() => {
    if (def.beforeDelete) def.beforeDelete(id, user);
    if (name === 'customers' && get("SELECT id FROM invoices WHERE customer_id=? LIMIT 1", id)) throw bad('customer_has_invoices');
    if (name === 'vehicles' && get("SELECT id FROM invoices WHERE vehicle_id=? LIMIT 1", id)) throw bad('vehicle_has_invoices');
    if (name === 'parts' && (get('SELECT id FROM wo_parts WHERE part_id=? LIMIT 1', id) || get('SELECT id FROM purchase_items WHERE part_id=? LIMIT 1', id))) throw bad('part_in_use');
    if (name === 'suppliers' && get('SELECT id FROM purchases WHERE supplier_id=? LIMIT 1', id)) throw bad('supplier_has_purchases');
    if (name === 'employees' && (get('SELECT id FROM wo_labor WHERE technician_id=? LIMIT 1', id) || get('SELECT id FROM bonuses WHERE employee_id=? LIMIT 1', id))) throw bad('employee_in_use');
    run(`DELETE FROM ${def.table} WHERE id=?`, id);
    audit(user, 'delete', name, id);
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------
function stockMove(partId, type, qty, unitCost, refType, refId, notes, user) {
  qty = Number(qty) || 0;
  if (!qty) return;
  const p = get('SELECT * FROM parts WHERE id=?', partId);
  if (!p) throw bad('part_not_found');
  // in / return => +qty ; out => -qty ; adjust => qty is signed delta
  let delta = qty;
  if (type === 'out') delta = -Math.abs(qty);
  else if (type === 'in' || type === 'return') delta = Math.abs(qty);
  const newQty = r2(p.qty + delta);
  if (newQty < 0 && getSetting('allow_negative_stock', '0') !== '1') {
    throw bad('insufficient_stock', { part: p.name_en, available: p.qty });
  }
  let newCost = p.cost;
  if (type === 'in' && refType !== 'return' && unitCost > 0) {
    newCost = p.qty > 0 ? r2((p.qty * p.cost + delta * unitCost) / (p.qty + delta)) : r2(unitCost);
  }
  run('UPDATE parts SET qty=?, cost=? WHERE id=?', newQty, newCost, partId);
  run('INSERT INTO stock_moves(part_id,type,qty,unit_cost,ref_type,ref_id,notes,user_id) VALUES(?,?,?,?,?,?,?,?)',
    partId, type, delta, r2(unitCost || p.cost), refType || null, refId || null, notes || null, user ? user.id : null);
}

// ---------------------------------------------------------------------------
// Work orders
// ---------------------------------------------------------------------------
const WO_STATUSES = ['open', 'in_progress', 'waiting_parts', 'waiting_approval', 'quality_check', 'completed', 'delivered', 'cancelled'];

function woFull(id, user) {
  const wo = getResource(RES.work_orders, id, user);
  wo.labor = all(`SELECT l.*, e.name AS technician_name, s.name_ar AS service_name_ar, s.name_en AS service_name_en, s.code AS service_code
                  FROM wo_labor l LEFT JOIN employees e ON e.id=l.technician_id LEFT JOIN service_types s ON s.id=l.service_type_id
                  WHERE l.work_order_id=? ORDER BY l.id`, id);
  wo.parts = all(`SELECT wp.*, p.part_no, p.name_ar, p.name_en, p.qty AS stock_qty, e.name AS technician_name FROM wo_parts wp
                  LEFT JOIN parts p ON p.id=wp.part_id LEFT JOIN employees e ON e.id=wp.technician_id WHERE wp.work_order_id=? ORDER BY wp.id`, id);
  if (onlyIn(user, ['advisor', 'technician'])) wo.parts.forEach((p) => delete p.unit_cost);
  wo.vehicle = get('SELECT * FROM vehicles WHERE id=?', wo.vehicle_id);
  wo.customer = get('SELECT * FROM customers WHERE id=?', wo.customer_id);
  wo.reception = wo.reception_id ? get('SELECT * FROM receptions WHERE id=?', wo.reception_id) : null;
  wo.diagnosis = wo.diagnosis_id ? get('SELECT * FROM diagnoses WHERE id=?', wo.diagnosis_id)
    : (wo.reception_id ? get('SELECT * FROM diagnoses WHERE reception_id=? ORDER BY id DESC LIMIT 1', wo.reception_id) : null);
  wo.attachments = all("SELECT * FROM attachments WHERE (ref_type='work_order' AND ref_id=?) OR (ref_type='reception' AND ref_id=?) ORDER BY id", id, wo.reception_id || -1);
  return wo;
}

function assertWoEditable(woId) {
  const w = get('SELECT * FROM work_orders WHERE id=?', woId);
  if (!w) throw new HttpError(404, 'not_found');
  if (w.invoice_id) throw bad('work_order_invoiced');
  if (['delivered', 'cancelled'].includes(w.status)) throw bad('work_order_closed');
  return w;
}

function setWoStatus(id, status, user) {
  if (!WO_STATUSES.includes(status)) throw bad('invalid_status');
  const w = get('SELECT * FROM work_orders WHERE id=?', id);
  if (!w) throw new HttpError(404, 'not_found');
  tx(() => {
    const sets = ['status=?'];
    const params = [status];
    if (status === 'in_progress' && !w.started_at) { sets.push('started_at=?'); params.push(nowStr()); }
    if (status === 'completed') { sets.push('completed_at=?'); params.push(nowStr()); }
    if (status === 'delivered') {
      sets.push('delivered_at=?'); params.push(nowStr());
      if (!w.completed_at) { sets.push('completed_at=?'); params.push(nowStr()); }
    }
    if (status === 'cancelled') {
      if (w.invoice_id) throw bad('work_order_invoiced');
      for (const p of all('SELECT * FROM wo_parts WHERE work_order_id=?', id)) {
        if (p.part_id) stockMove(p.part_id, 'return', p.qty, p.unit_cost, 'work_order', id, 'WO cancelled', user);
      }
      run('DELETE FROM wo_parts WHERE work_order_id=?', id);
    }
    run(`UPDATE work_orders SET ${sets.join(',')} WHERE id=?`, ...params, id);

    if ((status === 'completed' || status === 'delivered') && !['completed', 'delivered'].includes(w.status)) {
      generateReminders(id);
      if (num(w.mileage) > 0) run('UPDATE vehicles SET mileage=? WHERE id=? AND COALESCE(mileage,0) < ?', w.mileage, w.vehicle_id, w.mileage);
    }
    if (w.reception_id) {
      const map = { completed: 'done', delivered: 'delivered', cancelled: 'cancelled', in_progress: 'in_work' };
      if (map[status]) run('UPDATE receptions SET status=? WHERE id=?', map[status], w.reception_id);
    }
    audit(user, 'status:' + status, 'work_orders', id);
  });
}

function generateReminders(woId) {
  const w = get('SELECT * FROM work_orders WHERE id=?', woId);
  const ids = all('SELECT DISTINCT service_type_id AS id FROM wo_labor WHERE work_order_id=? AND service_type_id IS NOT NULL', woId).map((r) => r.id);
  addServiceReminders(w.vehicle_id, ids, num(w.mileage), woId);
}
// next-service reminders for the services done on a vehicle (from a work order or a quick invoice)
function addServiceReminders(vehicleId, serviceTypeIds, mileageIn, woId) {
  const v = get('SELECT * FROM vehicles WHERE id=?', vehicleId);
  if (!v || !serviceTypeIds.length) return;
  const mileage = num(mileageIn) || num(v.mileage);
  const date = today();
  const lines = all(`SELECT * FROM service_types WHERE id IN (${serviceTypeIds.map(() => '?').join(',')}) AND (interval_km > 0 OR interval_months > 0)`, ...serviceTypeIds);
  const avg = num(getSetting('avg_km_per_month', '1500'), 1500);
  for (const s of lines) {
    // close older pending reminders for same service on this vehicle
    run("UPDATE reminders SET status='done' WHERE vehicle_id=? AND service_type_id=? AND status IN ('pending','contacted','booked')", v.id, s.id);
    const dueMileage = s.interval_km > 0 && mileage ? mileage + s.interval_km : null;
    let dueDate = null;
    if (s.interval_months > 0) dueDate = addMonths(date, s.interval_months);
    if (s.interval_km > 0 && avg > 0) {
      const byKm = addMonths(date, Math.max(1, Math.round(s.interval_km / avg)));
      if (!dueDate || byKm < dueDate) dueDate = byKm;
    }
    run(`INSERT INTO reminders(vehicle_id,customer_id,service_type_id,title,due_date,due_mileage,last_service_date,last_mileage,work_order_id,status)
         VALUES(?,?,?,?,?,?,?,?,?,'pending')`, v.id, v.customer_id, s.id, `${s.name_ar} / ${s.name_en}`, dueDate, dueMileage, date, mileage || null, woId || null);
  }
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
function recalcInvoice(id) {
  const inv = get('SELECT * FROM invoices WHERE id=?', id);
  const items = all('SELECT * FROM invoice_items WHERE invoice_id=?', id);
  const labor = r2(items.filter((i) => i.kind === 'labor').reduce((s, i) => s + i.amount, 0));
  const parts = r2(items.filter((i) => i.kind !== 'labor').reduce((s, i) => s + i.amount, 0));
  const partsCost = r2(items.filter((i) => i.kind === 'part').reduce((s, i) => s + i.qty * i.unit_cost, 0));
  const subtotal = r2(labor + parts);
  const discount = Math.min(r2(inv.discount), subtotal);
  const tax = r2((subtotal - discount) * (num(inv.tax_rate) / 100));
  const total = r2(subtotal - discount + tax);
  const paid = r2(get("SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS s FROM transactions WHERE ref_type='invoice' AND ref_id=?", id).s);
  let status = inv.status === 'cancelled' ? 'cancelled' : paid <= 0 ? 'unpaid' : paid + 0.009 >= total ? 'paid' : 'partial';
  if (total === 0 && status !== 'cancelled') status = 'paid';
  run('UPDATE invoices SET labor_total=?, parts_total=?, parts_cost=?, subtotal=?, discount=?, tax=?, total=?, paid=?, status=? WHERE id=?',
    labor, parts, partsCost, subtotal, discount, tax, total, paid, status, id);
}

function invoiceFull(id, user) {
  const inv = getResource(RES.invoices, id, user);
  inv.items = all('SELECT ii.*, e.name AS technician_name, p.part_no FROM invoice_items ii LEFT JOIN employees e ON e.id=ii.technician_id LEFT JOIN parts p ON p.id=ii.part_id WHERE invoice_id=? ORDER BY ii.kind DESC, ii.id', id);
  inv.payments = all("SELECT t.*, a.name AS account_name FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE ref_type='invoice' AND ref_id=? ORDER BY t.id", id);
  inv.customer = get('SELECT * FROM customers WHERE id=?', inv.customer_id);
  inv.vehicle = inv.vehicle_id ? get('SELECT * FROM vehicles WHERE id=?', inv.vehicle_id) : null;
  inv.work_order = inv.work_order_id ? get('SELECT id,no,mileage,date,completed_at,description FROM work_orders WHERE id=?', inv.work_order_id) : null;
  if (!hasAny(user, MONEY)) { delete inv.parts_cost; inv.items.forEach((i) => delete i.unit_cost); }
  return inv;
}

function invoiceFromWo(woId, body, user) {
  const w = get('SELECT * FROM work_orders WHERE id=?', woId);
  if (!w) throw new HttpError(404, 'not_found');
  if (w.invoice_id) throw bad('work_order_invoiced');
  if (w.status === 'cancelled') throw bad('work_order_closed');
  const labor = all('SELECT l.*, s.name_ar, s.name_en FROM wo_labor l LEFT JOIN service_types s ON s.id=l.service_type_id WHERE work_order_id=?', woId);
  const parts = all('SELECT wp.*, p.name_en, p.name_ar, p.part_no FROM wo_parts wp LEFT JOIN parts p ON p.id=wp.part_id WHERE work_order_id=?', woId);
  if (!labor.length && !parts.length) throw bad('work_order_empty');
  return tx(() => {
    const taxRate = body.tax_rate !== undefined && body.tax_rate !== '' ? num(body.tax_rate) : num(getSetting('vat_rate', '0'));
    const id = Number(run('INSERT INTO invoices(work_order_id,customer_id,vehicle_id,date,discount,tax_rate,notes) VALUES(?,?,?,?,?,?,?)',
      woId, w.customer_id, w.vehicle_id, body.date || today(), r2(body.discount), taxRate, body.notes || null).lastInsertRowid);
    setNo('invoices', 'INV', id);
    const ins = 'INSERT INTO invoice_items(invoice_id,kind,description,qty,unit_price,unit_cost,amount,part_id,technician_id) VALUES(?,?,?,?,?,?,?,?,?)';
    for (const l of labor) {
      const desc = l.description || [l.name_ar, l.name_en].filter(Boolean).join(' / ');
      run(ins, id, 'labor', desc, l.hours, l.rate, 0, l.amount, null, l.technician_id);
    }
    for (const p of parts) {
      const desc = p.description || [p.part_no, p.name_en, p.name_ar].filter(Boolean).join(' - ');
      run(ins, id, p.part_id ? 'part' : 'other', desc, p.qty, p.unit_price, p.unit_cost, p.amount, p.part_id, p.technician_id);
    }
    run('UPDATE work_orders SET invoice_id=? WHERE id=?', id, woId);
    recalcInvoice(id);
    if (body.payment && num(body.payment.amount) > 0) addInvoicePayment(id, body.payment, user);
    audit(user, 'create', 'invoices', id, { from_wo: woId });
    return invoiceFull(id, user);
  });
}

// Quick invoice customer: the picked one, an existing one with the same phone, a new one from the typed
// name / phone, or (nothing typed) the shared "cash customer".
const CASH_CUSTOMER = 'عميل نقدي / Cash customer';
function resolveCustomer(body) {
  if (body.customer_id) {
    if (!get('SELECT id FROM customers WHERE id=?', body.customer_id)) throw bad('required', { field: 'customer_id' });
    return Number(body.customer_id);
  }
  const c = body.customer || {};
  const name = String(c.name || '').trim(); const phone = String(c.phone || '').trim();
  if (phone) { const ex = get('SELECT id FROM customers WHERE phone=? OR phone2=? ORDER BY id LIMIT 1', phone, phone); if (ex) return ex.id; }
  if (name || phone) {
    return Number(run('INSERT INTO customers(name,phone,email,address,tax_no,type,notes) VALUES(?,?,?,?,?,?,?)', name || phone, phone || null, c.email || null, c.address || null,
      c.tax_no || null, c.tax_no ? 'company' : 'individual', 'Created from a quick invoice').lastInsertRowid);
  }
  let id = num(getSetting('cash_customer_id', '0'));
  if (!id || !get('SELECT id FROM customers WHERE id=?', id)) {
    id = Number(run("INSERT INTO customers(name,type,notes) VALUES(?, 'individual', 'Walk-in / cash sales')", CASH_CUSTOMER).lastInsertRowid);
    D.setSetting('cash_customer_id', id);
  }
  return id;
}
// Quick invoice vehicle (optional): the picked one, the customer's car with the same plate, or a new one
function resolveVehicle(body, customerId) {
  const v = body.vehicle || {};
  const km = num(v.mileage ?? body.mileage);
  let id = body.vehicle_id ? Number(body.vehicle_id) : null;
  const plate = String(v.plate || '').trim();
  if (!id && plate) {
    const ex = get("SELECT id FROM vehicles WHERE customer_id=? AND REPLACE(COALESCE(plate,''),' ','')=REPLACE(?,' ','') LIMIT 1", customerId, plate);
    if (ex) id = ex.id;
  }
  if (!id && (plate || v.vin || v.model)) {
    id = Number(run('INSERT INTO vehicles(customer_id,plate,vin,make,series,model,year,mileage) VALUES(?,?,?,?,?,?,?,?)', customerId, plate || null, v.vin || null,
      v.make || 'BMW', v.series || null, v.model || null, v.year ? num(v.year) : null, km || 0).lastInsertRowid);
  }
  if (id && km > 0) run('UPDATE vehicles SET mileage=? WHERE id=? AND COALESCE(mileage,0) < ?', km, id, km);
  return id;
}

function createManualInvoice(body, user) {
  const items = Array.isArray(body.items) ? body.items.filter((i) => i.description || i.part_id || i.service_type_id) : [];
  if (!items.length) throw bad('invoice_empty');
  return tx(() => {
    const customerId = resolveCustomer(body);
    const vehicleId = resolveVehicle(body, customerId);
    const taxRate = body.tax_rate !== undefined && body.tax_rate !== '' && body.tax_rate !== null ? num(body.tax_rate) : num(getSetting('vat_rate', '0'));
    const id = Number(run('INSERT INTO invoices(customer_id,vehicle_id,date,discount,tax_rate,notes) VALUES(?,?,?,?,?,?)',
      customerId, vehicleId || null, body.date || today(), r2(body.discount), taxRate, body.notes || null).lastInsertRowid);
    setNo('invoices', 'INV', id);
    const services = [];
    for (const it of items) {
      const qty = num(it.qty, 1);
      let cost = 0;
      let desc = it.description;
      let kind = it.kind === 'labor' || it.service_type_id ? 'labor' : it.kind || 'other';
      if (it.service_type_id) {
        const st = get('SELECT * FROM service_types WHERE id=?', it.service_type_id);
        if (st) { desc = desc || `${st.name_ar} / ${st.name_en}`; services.push(st.id); }
      }
      if (it.part_id) {
        const p = get('SELECT * FROM parts WHERE id=?', it.part_id);
        if (!p) throw bad('part_not_found');
        cost = p.cost;
        kind = 'part';
        desc = desc || [p.part_no, p.name_en, p.name_ar].filter(Boolean).join(' - ');
        stockMove(p.id, 'out', qty, p.cost, 'invoice', id, 'Counter sale', user);
      }
      run('INSERT INTO invoice_items(invoice_id,kind,description,qty,unit_price,unit_cost,amount,part_id,technician_id) VALUES(?,?,?,?,?,?,?,?,?)',
        id, kind, desc, qty, r2(it.unit_price), cost, r2(qty * num(it.unit_price)), it.part_id || null, it.technician_id || null);
    }
    recalcInvoice(id);
    if (vehicleId && services.length) addServiceReminders(vehicleId, [...new Set(services)], num((body.vehicle || {}).mileage ?? body.mileage), null);
    if (body.payment && num(body.payment.amount) > 0) addInvoicePayment(id, body.payment, user);
    audit(user, 'create', 'invoices', id, { manual: true });
    return invoiceFull(id, user);
  });
}

function addInvoicePayment(id, p, user) {
  const inv = get('SELECT * FROM invoices WHERE id=?', id);
  if (!inv) throw new HttpError(404, 'not_found');
  if (inv.status === 'cancelled') throw bad('invoice_cancelled');
  const amount = r2(p.amount);
  if (!(amount > 0)) throw bad('invalid_amount');
  const isRefund = p.refund === true || p.refund === 1;
  if (!isRefund && amount > r2(inv.total - inv.paid) + 0.009) throw bad('amount_exceeds_due', { due: r2(inv.total - inv.paid) });
  if (!p.account_id || !get('SELECT id FROM accounts WHERE id=?', p.account_id)) throw bad('required', { field: 'account_id' });
  run(`INSERT INTO transactions(date,account_id,direction,amount,category,description,ref_type,ref_id,party_type,party_id,method,user_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, p.date || today(), p.account_id, isRefund ? 'out' : 'in', amount, isRefund ? 'refund' : 'invoice_payment',
  `${isRefund ? 'Refund' : 'Payment'} ${inv.no}`, 'invoice', id, 'customer', inv.customer_id, p.method || 'cash', user.id);
  recalcInvoice(id);
}

function cancelInvoice(id, user) {
  const inv = get('SELECT * FROM invoices WHERE id=?', id);
  if (!inv) throw new HttpError(404, 'not_found');
  if (inv.status === 'cancelled') return;
  if (r2(inv.paid) > 0) throw bad('invoice_has_payments');
  tx(() => {
    if (inv.work_order_id) {
      run('UPDATE work_orders SET invoice_id=NULL WHERE id=?', inv.work_order_id);
    } else {
      for (const it of all("SELECT * FROM invoice_items WHERE invoice_id=? AND part_id IS NOT NULL", id)) {
        stockMove(it.part_id, 'return', it.qty, it.unit_cost, 'invoice', id, 'Invoice cancelled', user);
      }
    }
    run("UPDATE invoices SET status='cancelled', notes=COALESCE(notes,'') || ' [cancelled ' || ? || ']' WHERE id=?", nowStr(), id);
    audit(user, 'cancel', 'invoices', id);
  });
}

// Delete an invoice completely: its payments leave the cash accounts, parts of a counter sale go back
// to stock, and a work-order invoice frees the work order so it can be edited and invoiced again.
function deleteInvoice(id, user) {
  const inv = get('SELECT * FROM invoices WHERE id=?', id);
  if (!inv) throw new HttpError(404, 'not_found');
  tx(() => {
    run("DELETE FROM transactions WHERE ref_type='invoice' AND ref_id=?", id);
    if (inv.status !== 'cancelled') {
      if (!inv.work_order_id) {
        for (const it of all('SELECT * FROM invoice_items WHERE invoice_id=? AND part_id IS NOT NULL', id)) {
          stockMove(it.part_id, 'return', it.qty, it.unit_cost, 'invoice', id, 'Invoice deleted', user);
        }
      }
    }
    if (inv.work_order_id) run('UPDATE work_orders SET invoice_id=NULL WHERE id=? AND invoice_id=?', inv.work_order_id, id);
    run('DELETE FROM invoices WHERE id=?', id);
    audit(user, 'delete', 'invoices', id, { no: inv.no, total: inv.total, paid: inv.paid });
  });
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------
function createPurchase(body, user) {
  if (!body.supplier_id) throw bad('required', { field: 'supplier_id' });
  const items = (Array.isArray(body.items) ? body.items : []).filter((i) => i.part_id && num(i.qty) > 0);
  if (!items.length) throw bad('purchase_empty');
  const isReturn = body.is_return ? 1 : 0;
  return tx(() => {
    const id = Number(run('INSERT INTO purchases(supplier_id,date,supplier_invoice_no,discount,tax,is_return,notes) VALUES(?,?,?,?,?,?,?)',
      body.supplier_id, body.date || today(), body.supplier_invoice_no || null, r2(body.discount), r2(body.tax), isReturn, body.notes || null).lastInsertRowid);
    setNo('purchases', isReturn ? 'PR' : 'PO', id);
    let subtotal = 0;
    for (const it of items) {
      const amount = r2(num(it.qty) * num(it.unit_cost));
      subtotal += amount;
      run('INSERT INTO purchase_items(purchase_id,part_id,description,qty,unit_cost,amount) VALUES(?,?,?,?,?,?)', id, it.part_id, it.description || null, num(it.qty), r2(it.unit_cost), amount);
      if (isReturn) stockMove(it.part_id, 'out', num(it.qty), num(it.unit_cost), 'purchase_return', id, 'Return to supplier', user);
      else {
        stockMove(it.part_id, 'in', num(it.qty), num(it.unit_cost), 'purchase', id, 'Purchase', user);
        if (num(it.price) > 0) run('UPDATE parts SET price=? WHERE id=?', r2(it.price), it.part_id);
        run('UPDATE parts SET supplier_id=COALESCE(supplier_id, ?) WHERE id=?', body.supplier_id, it.part_id);
      }
    }
    const total = r2(subtotal - r2(body.discount) + r2(body.tax));
    run('UPDATE purchases SET subtotal=?, total=? WHERE id=?', r2(subtotal), total, id);
    if (body.payment && num(body.payment.amount) > 0) addPurchasePayment(id, body.payment, user);
    recalcPurchase(id);
    audit(user, 'create', 'purchases', id);
    return purchaseFull(id);
  });
}
// Edit a supplier invoice (quantities, costs, prices, discount, tax). Stock and the parts' average cost
// follow the difference between the old and the new lines; the supplier balance follows the new total.
function editPurchase(id, body, user) {
  const p = get('SELECT * FROM purchases WHERE id=?', id);
  if (!p) throw new HttpError(404, 'not_found');
  const items = (Array.isArray(body.items) ? body.items : []).filter((i) => i.part_id && num(i.qty) > 0);
  if (!items.length) throw bad('purchase_empty');
  const sign = p.is_return ? -1 : 1; // a purchase adds stock, a return takes it out
  const allowNeg = getSetting('allow_negative_stock', '0') === '1';
  return tx(() => {
    const old = all('SELECT * FROM purchase_items WHERE purchase_id=?', id);
    const sumBy = (rows, pid, f) => rows.filter((r) => String(r.part_id) === String(pid)).reduce((s, r) => s + f(r), 0);
    const pids = [...new Set([...old, ...items].map((r) => String(r.part_id)))];
    for (const pid of pids) {
      const part = get('SELECT * FROM parts WHERE id=?', pid);
      if (!part) throw bad('part_not_found');
      const oq = sumBy(old, pid, (r) => num(r.qty)); const nq = sumBy(items, pid, (r) => num(r.qty));
      const ov = sumBy(old, pid, (r) => num(r.qty) * num(r.unit_cost)); const nv = sumBy(items, pid, (r) => num(r.qty) * num(r.unit_cost));
      const dq = r2(sign * (nq - oq));
      const newQty = r2(num(part.qty) + dq);
      if (newQty < 0 && !allowNeg) throw bad('insufficient_stock', { part: part.name_en, available: part.qty });
      let cost = num(part.cost);
      if (!p.is_return && (dq || Math.abs(ov - nv) > 0.001)) {
        // take the old purchase value out of the average and put the new one in
        cost = newQty > 0 ? r2(Math.max(0, (num(part.qty) * num(part.cost) - ov + nv) / newQty)) : (nq > 0 ? r2(nv / nq) : cost);
      }
      run('UPDATE parts SET qty=?, cost=? WHERE id=?', newQty, cost, pid);
      if (dq) run('INSERT INTO stock_moves(part_id,type,qty,unit_cost,ref_type,ref_id,notes,user_id) VALUES(?,?,?,?,?,?,?,?)', pid, 'adjust', dq, cost, 'purchase_edit', id, `Edited ${p.no}`, user.id);
      const it = items.find((r) => String(r.part_id) === pid);
      if (!p.is_return && it && num(it.price) > 0) run('UPDATE parts SET price=? WHERE id=?', r2(it.price), pid);
    }
    run('DELETE FROM purchase_items WHERE purchase_id=?', id);
    let subtotal = 0;
    for (const it of items) {
      const amount = r2(num(it.qty) * num(it.unit_cost));
      subtotal += amount;
      run('INSERT INTO purchase_items(purchase_id,part_id,description,qty,unit_cost,amount) VALUES(?,?,?,?,?,?)', id, it.part_id, it.description || null, num(it.qty), r2(it.unit_cost), amount);
    }
    const discount = r2(body.discount ?? p.discount); const tax = r2(body.tax ?? p.tax);
    const total = r2(subtotal - discount + tax);
    run('UPDATE purchases SET supplier_invoice_no=?, date=?, notes=?, discount=?, tax=?, subtotal=?, total=? WHERE id=?',
      body.supplier_invoice_no !== undefined ? body.supplier_invoice_no || null : p.supplier_invoice_no, body.date || p.date,
      body.notes !== undefined ? body.notes || null : p.notes, discount, tax, r2(subtotal), total, id);
    recalcPurchase(id);
    audit(user, 'edit', 'purchases', id, { old_total: p.total, total });
    return purchaseFull(id);
  });
}
function recalcPurchase(id) {
  const p = get('SELECT * FROM purchases WHERE id=?', id);
  const paid = r2(get("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE ref_type='purchase' AND ref_id=?", id).s);
  const status = paid <= 0 ? 'unpaid' : paid + 0.009 >= p.total ? 'paid' : 'partial';
  run('UPDATE purchases SET paid=?, status=? WHERE id=?', paid, status, id);
}
function addPurchasePayment(id, pay, user) {
  const p = get('SELECT * FROM purchases WHERE id=?', id);
  if (!p) throw new HttpError(404, 'not_found');
  const amount = r2(pay.amount);
  if (!(amount > 0)) throw bad('invalid_amount');
  if (!pay.account_id) throw bad('required', { field: 'account_id' });
  // purchase => we pay (out); purchase return => supplier refunds us (in)
  run(`INSERT INTO transactions(date,account_id,direction,amount,category,description,ref_type,ref_id,party_type,party_id,method,user_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, pay.date || today(), pay.account_id, p.is_return ? 'in' : 'out', amount, p.is_return ? 'supplier_refund' : 'supplier_payment',
  `${p.is_return ? 'Refund' : 'Payment'} ${p.no}`, 'purchase', id, 'supplier', p.supplier_id, pay.method || 'cash', user.id);
  recalcPurchase(id);
}
function purchaseFull(id) {
  const p = get('SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=?', id);
  if (!p) throw new HttpError(404, 'not_found');
  p.items = all('SELECT pi.*, pa.part_no, pa.name_en, pa.name_ar, pa.price AS part_price FROM purchase_items pi LEFT JOIN parts pa ON pa.id=pi.part_id WHERE purchase_id=?', id);
  p.payments = all("SELECT t.*, a.name AS account_name FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE ref_type='purchase' AND ref_id=?", id);
  return p;
}
function deletePurchase(id, user) {
  const p = get('SELECT * FROM purchases WHERE id=?', id);
  if (!p) throw new HttpError(404, 'not_found');
  tx(() => {
    for (const it of all('SELECT * FROM purchase_items WHERE purchase_id=?', id)) {
      if (it.part_id) stockMove(it.part_id, p.is_return ? 'in' : 'out', it.qty, it.unit_cost, 'purchase_void', id, 'Purchase deleted', user);
    }
    run("DELETE FROM transactions WHERE ref_type='purchase' AND ref_id=?", id);
    run('DELETE FROM purchases WHERE id=?', id);
    audit(user, 'delete', 'purchases', id);
  });
}

// ---------------------------------------------------------------------------
// Bonuses / commissions / payroll
// ---------------------------------------------------------------------------
function commissions(from, to) {
  const emps = all('SELECT id, name, job, salary, labor_commission, parts_commission FROM employees WHERE active=1 ORDER BY name');
  const labor = all(`SELECT ii.technician_id AS emp, SUM(ii.amount) AS amount, SUM(ii.qty) AS hours, COUNT(DISTINCT ii.invoice_id) AS jobs
                     FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
                     WHERE ii.kind='labor' AND i.status!='cancelled' AND i.date BETWEEN ? AND ? AND ii.technician_id IS NOT NULL GROUP BY ii.technician_id`, from, to);
  const parts = all(`SELECT ii.technician_id AS emp, SUM(ii.amount) AS amount FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
                     WHERE ii.kind!='labor' AND i.status!='cancelled' AND i.date BETWEEN ? AND ? AND ii.technician_id IS NOT NULL GROUP BY ii.technician_id`, from, to);
  const bon = all(`SELECT employee_id AS emp, SUM(CASE WHEN type='deduction' THEN -amount ELSE amount END) AS amount,
                   SUM(CASE WHEN type='commission' THEN amount ELSE 0 END) AS commission_recorded
                   FROM bonuses WHERE date BETWEEN ? AND ? GROUP BY employee_id`, from, to);
  const L = Object.fromEntries(labor.map((x) => [x.emp, x]));
  const P = Object.fromEntries(parts.map((x) => [x.emp, x]));
  const B = Object.fromEntries(bon.map((x) => [x.emp, x]));
  return emps.map((e) => {
    const la = L[e.id] ? r2(L[e.id].amount) : 0;
    const pa = P[e.id] ? r2(P[e.id].amount) : 0;
    const lc = r2(la * num(e.labor_commission) / 100);
    const pc = r2(pa * num(e.parts_commission) / 100);
    return {
      employee_id: e.id, name: e.name, job: e.job, salary: e.salary,
      labor_commission_rate: e.labor_commission, parts_commission_rate: e.parts_commission,
      jobs: L[e.id] ? L[e.id].jobs : 0, hours: L[e.id] ? r2(L[e.id].hours) : 0,
      labor_sales: la, parts_sales: pa, labor_commission: lc, parts_commission: pc,
      commission: r2(lc + pc),
      commission_recorded: B[e.id] ? r2(B[e.id].commission_recorded) : 0,
      bonuses_net: B[e.id] ? r2(B[e.id].amount) : 0,
    };
  });
}

const ATT_STATUSES = ['present', 'absent', 'leave', 'sick', 'holiday', 'unpaid'];
const nowHM = () => nowStr().slice(11, 16);
function attendanceCalc(e, period) {
  const days = PAY.periodDays(period);
  const recs = all('SELECT * FROM attendance WHERE employee_id=? AND date BETWEEN ? AND ?', e.id, days[0], days[days.length - 1]);
  return PAY.calc(e, recs, period, D.allSettings(), today());
}
// period: "YYYY-MM" (monthly payroll) or "WYYYY-MM-DD" (weekly payroll, week start)
function payroll(period) {
  const cycle = PAY.isWeek(period) ? 'weekly' : 'monthly';
  const emps = all('SELECT * FROM employees WHERE active=1 ORDER BY name').filter((e) => PAY.cycleOf(e) === cycle);
  return emps.map((e) => {
    const a = attendanceCalc(e, period);
    const b = get(`SELECT COALESCE(SUM(CASE WHEN type IN ('bonus','commission') THEN amount ELSE 0 END),0) AS plus,
                          COALESCE(SUM(CASE WHEN type='deduction' THEN amount ELSE 0 END),0) AS minus,
                          COALESCE(SUM(CASE WHEN type='advance' THEN amount ELSE 0 END),0) AS adv
                   FROM bonuses WHERE employee_id=? AND paid=0`, e.id);
    // salary already paid for this period (older payments kept the period only in the description)
    const salaryPaid = get(`SELECT COALESCE(SUM(COALESCE(salary_part, amount)),0) AS s FROM transactions WHERE category='salary' AND party_type='employee' AND party_id=?
                            AND (period=? OR (period IS NULL AND description LIKE ?))`, e.id, period, `%${period}%`).s;
    const net = r2(a.salary_due - r2(salaryPaid) + b.plus - b.minus - b.adv);
    delete a.days;
    return { employee_id: e.id, name: e.name, job: e.job, salary: e.salary, pay_cycle: cycle, ...a, period_label: PAY.periodLabel(period), salary_paid: r2(salaryPaid), bonuses: r2(b.plus), deductions: r2(b.minus), advances: r2(b.adv), net };
  });
}
// give an employee an advance: cash leaves the account now, and the next payroll deducts it
function giveAdvance(body, user) {
  const amount = r2(body.amount);
  if (!(amount > 0)) throw bad('invalid_amount');
  if (!body.employee_id || !body.account_id) throw bad('required');
  const e = get('SELECT * FROM employees WHERE id=?', body.employee_id);
  if (!e) throw new HttpError(404, 'not_found');
  if (!get('SELECT id FROM accounts WHERE id=?', body.account_id)) throw bad('required', { field: 'account_id' });
  const date = body.date || today();
  return tx(() => {
    const bid = Number(run("INSERT INTO bonuses(employee_id,date,period,type,amount,reason,paid) VALUES(?,?,?,'advance',?,?,0)", e.id, date, date.slice(0, 7), amount, body.reason || null).lastInsertRowid);
    const tid = Number(run(`INSERT INTO transactions(date,account_id,direction,amount,category,description,ref_type,ref_id,party_type,party_id,method,user_id)
      VALUES(?,?,'out',?,'advance',?,'advance',?,'employee',?,?,?)`, date, body.account_id, amount, `Advance - ${e.name}${body.reason ? ' - ' + body.reason : ''}`, bid, e.id, body.method || 'cash', user.id).lastInsertRowid);
    run('UPDATE bonuses SET transaction_id=? WHERE id=?', tid, bid);
    audit(user, 'advance', 'employees', e.id, { amount });
    return get('SELECT * FROM bonuses WHERE id=?', bid);
  });
}

function payPayroll(body, user) {
  const { employee_id, account_id, period } = body;
  if (!employee_id || !account_id || !period) throw bad('required');
  validPeriod(period);
  const e = get('SELECT * FROM employees WHERE id=?', employee_id);
  if (!e) throw new HttpError(404, 'not_found');
  return tx(() => {
    const row = payroll(period).find((x) => x.employee_id === Number(employee_id));
    if (!row) throw bad('not_found');
    // one net payment: salary + bonuses - deductions - advances
    const salaryDue = Math.max(0, r2(row.salary_due - row.salary_paid));
    const adj = r2(row.bonuses - row.deductions - row.advances);
    if (!salaryDue && !adj) return { ok: true, nothing: true };
    const cash = r2(salaryDue + adj);
    const desc = `Salary ${PAY.periodLabel(period)} - ${e.name} (${salaryDue} + ${row.bonuses} - ${row.deductions} - ${row.advances})`;
    const tid = Number(run(`INSERT INTO transactions(date,account_id,direction,amount,category,description,party_type,party_id,user_id,period,salary_part)
      VALUES(?,?,'out',?,'salary',?,'employee',?,?,?,?)`, today(), account_id, Math.max(0, cash), desc, e.id, user.id, period, salaryDue).lastInsertRowid);
    run("UPDATE bonuses SET paid=1, transaction_id=COALESCE(CASE WHEN type='advance' THEN transaction_id END, ?) WHERE employee_id=? AND paid=0", tid, e.id);
    // advances/deductions larger than the pay: the rest stays as an advance for the next payroll
    if (cash < 0) run("INSERT INTO bonuses(employee_id,date,period,type,amount,reason,paid) VALUES(?,?,?,'advance',?,?,0)", e.id, today(), period, -cash, `Carried over from ${PAY.periodLabel(period)}`);
    audit(user, 'payroll', 'employees', e.id, { period, cash });
    return { ok: true, paid: Math.max(0, cash), carried: cash < 0 ? -cash : 0 };
  });
}

// ---------------------------------------------------------------------------
// Dashboard & reports
// ---------------------------------------------------------------------------
function dashboard(user) {
  const t = today();
  const month = t.slice(0, 7);
  const out = {
    in_workshop: get("SELECT COUNT(*) AS n FROM work_orders WHERE status NOT IN ('delivered','cancelled')").n,
    ready_for_delivery: get("SELECT COUNT(*) AS n FROM work_orders WHERE status='completed'").n,
    waiting_parts: get("SELECT COUNT(*) AS n FROM work_orders WHERE status='waiting_parts'").n,
    receptions_today: get('SELECT COUNT(*) AS n FROM receptions WHERE substr(date,1,10)=?', t).n,
    appointments_today: all(`SELECT a.*, c.name AS customer_name, c.phone AS customer_phone, v.plate, v.model FROM appointments a
                             LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN vehicles v ON v.id=a.vehicle_id
                             WHERE a.date=? AND a.status='scheduled' ORDER BY a.time`, t),
    reminders_due: get(`SELECT COUNT(*) AS n FROM reminders WHERE status IN ('pending','contacted') AND due_date <= date('now','localtime','+' || ? || ' days')`, num(getSetting('reminder_days_ahead', '30'))).n,
    low_stock: get('SELECT COUNT(*) AS n FROM parts WHERE active=1 AND qty <= min_qty').n,
    customers: get('SELECT COUNT(*) AS n FROM customers').n,
    vehicles: get('SELECT COUNT(*) AS n FROM vehicles').n,
    wo_by_status: all("SELECT status, COUNT(*) AS n FROM work_orders WHERE status NOT IN ('delivered','cancelled') GROUP BY status"),
    active_orders: all(`SELECT w.id, w.no, w.status, w.priority, w.date, w.bay, v.plate, v.model, v.series, c.name AS customer_name
                        FROM work_orders w LEFT JOIN vehicles v ON v.id=w.vehicle_id LEFT JOIN customers c ON c.id=w.customer_id
                        WHERE w.status NOT IN ('delivered','cancelled') ORDER BY CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, w.id DESC LIMIT 12`),
  };
  if (hasAny(user, MONEY)) {
    out.revenue_today = r2(get("SELECT COALESCE(SUM(total),0) AS s FROM invoices WHERE date=? AND status!='cancelled'", t).s);
    out.revenue_month = r2(get("SELECT COALESCE(SUM(total),0) AS s FROM invoices WHERE substr(date,1,7)=? AND status!='cancelled'", month).s);
    out.collected_today = r2(get("SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS s FROM transactions WHERE date=? AND ref_type='invoice'", t).s);
    out.expenses_month = r2(get("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE substr(date,1,7)=? AND direction='out' AND category NOT IN ('transfer','supplier_payment','refund')", month).s);
    out.receivables = r2(get("SELECT COALESCE(SUM(total-paid),0) AS s FROM invoices WHERE status IN ('unpaid','partial')").s);
    out.cash_balance = r2(get(`SELECT COALESCE(SUM(a.opening_balance),0) + (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) FROM transactions) AS s FROM accounts a`).s);
    out.daily = all(`SELECT date, SUM(total) AS total FROM invoices WHERE status!='cancelled' AND date >= date('now','localtime','-13 days') GROUP BY date ORDER BY date`);
  }
  return out;
}

function reports(from, to) {
  const inv = get(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total, COALESCE(SUM(labor_total),0) AS labor, COALESCE(SUM(parts_total),0) AS parts,
                   COALESCE(SUM(parts_cost),0) AS parts_cost, COALESCE(SUM(discount),0) AS discount, COALESCE(SUM(tax),0) AS tax, COALESCE(SUM(paid),0) AS paid
                   FROM invoices WHERE status!='cancelled' AND date BETWEEN ? AND ?`, from, to);
  const expenses = all(`SELECT category, SUM(amount) AS amount FROM transactions WHERE direction='out' AND date BETWEEN ? AND ?
                        AND category NOT IN ('transfer','supplier_payment','refund') GROUP BY category ORDER BY amount DESC`, from, to);
  const otherIncome = r2(get(`SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE direction='in' AND date BETWEEN ? AND ? AND category IN ('other_income')`, from, to).s);
  const totalExpenses = r2(expenses.reduce((s, e) => s + e.amount, 0));
  const netSales = r2(inv.total - inv.tax);
  const gross = r2(netSales - inv.parts_cost);
  const cashflow = all(`SELECT a.name, SUM(CASE WHEN t.direction='in' THEN t.amount ELSE 0 END) AS cash_in, SUM(CASE WHEN t.direction='out' THEN t.amount ELSE 0 END) AS cash_out
                        FROM accounts a LEFT JOIN transactions t ON t.account_id=a.id AND t.date BETWEEN ? AND ? GROUP BY a.id ORDER BY a.id`, from, to);
  return {
    from, to,
    invoices: { ...inv, total: r2(inv.total), labor: r2(inv.labor), parts: r2(inv.parts), parts_cost: r2(inv.parts_cost), discount: r2(inv.discount), tax: r2(inv.tax), paid: r2(inv.paid) },
    net_sales: netSales,
    gross_profit: gross,
    other_income: otherIncome,
    expenses, total_expenses: totalExpenses,
    net_profit: r2(gross + otherIncome - totalExpenses),
    purchases: r2(get("SELECT COALESCE(SUM(CASE WHEN is_return=1 THEN -total ELSE total END),0) AS s FROM purchases WHERE date BETWEEN ? AND ?", from, to).s),
    cars_serviced: get("SELECT COUNT(DISTINCT vehicle_id) AS n FROM work_orders WHERE status IN ('completed','delivered') AND substr(COALESCE(completed_at,date),1,10) BETWEEN ? AND ?", from, to).n,
    new_customers: get('SELECT COUNT(*) AS n FROM customers WHERE substr(created_at,1,10) BETWEEN ? AND ?', from, to).n,
    top_services: all(`SELECT ii.description, COUNT(*) AS n, SUM(ii.amount) AS amount FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
                       WHERE ii.kind='labor' AND i.status!='cancelled' AND i.date BETWEEN ? AND ? GROUP BY ii.description ORDER BY amount DESC LIMIT 10`, from, to),
    top_parts: all(`SELECT ii.description, SUM(ii.qty) AS qty, SUM(ii.amount) AS amount, SUM(ii.amount - ii.qty*ii.unit_cost) AS profit FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
                    WHERE ii.kind='part' AND i.status!='cancelled' AND i.date BETWEEN ? AND ? GROUP BY ii.description ORDER BY amount DESC LIMIT 10`, from, to),
    by_series: all(`SELECT COALESCE(v.series,'-') AS series, COUNT(*) AS n, SUM(i.total) AS amount FROM invoices i LEFT JOIN vehicles v ON v.id=i.vehicle_id
                    WHERE i.status!='cancelled' AND i.date BETWEEN ? AND ? GROUP BY v.series ORDER BY amount DESC`, from, to),
    technicians: commissions(from, to).filter((x) => x.labor_sales || x.parts_sales),
    daily: all(`SELECT date, COUNT(*) AS n, SUM(total) AS total FROM invoices WHERE status!='cancelled' AND date BETWEEN ? AND ? GROUP BY date ORDER BY date`, from, to),
    cashflow,
    receivables: r2(get("SELECT COALESCE(SUM(total-paid),0) AS s FROM invoices WHERE status IN ('unpaid','partial')").s),
    payables: r2(all(`${RES.suppliers.select}`).reduce((s, x) => s + x.balance, 0)),
    stock_value: r2(get('SELECT COALESCE(SUM(qty*cost),0) AS s FROM parts WHERE qty > 0').s),
  };
}

function globalSearch(q) {
  const like = `%${q}%`;
  return {
    customers: all('SELECT id, name, phone FROM customers WHERE name LIKE ? OR phone LIKE ? OR phone2 LIKE ? LIMIT 8', like, like, like),
    vehicles: all('SELECT v.id, v.plate, v.vin, v.model, v.series, c.name AS customer_name FROM vehicles v LEFT JOIN customers c ON c.id=v.customer_id WHERE v.plate LIKE ? OR v.vin LIKE ? LIMIT 8', like, like),
    work_orders: all('SELECT w.id, w.no, w.status, v.plate FROM work_orders w LEFT JOIN vehicles v ON v.id=w.vehicle_id WHERE w.no LIKE ? LIMIT 5', like),
    invoices: all('SELECT id, no, total, status FROM invoices WHERE no LIKE ? LIMIT 5', like),
    parts: all('SELECT id, part_no, name_en, name_ar, qty FROM parts WHERE part_no LIKE ? OR oem_no LIKE ? OR name_en LIKE ? OR name_ar LIKE ? LIMIT 5', like, like, like, like),
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function currentUser(req) {
  let token = parseCookies(req).gear_session;
  const h = req.headers.authorization;
  if (!token && h && h.startsWith('Bearer ')) token = h.slice(7);
  if (!token) return null;
  const u = get('SELECT u.id, u.username, u.name, u.role, u.extra_roles, u.employee_id, u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?', token);
  if (!u || !u.active) return null;
  u.token = token;
  return u;
}
const loginAttempts = new Map();
// Behind a hosting proxy (Railway, Render, Fly, Nginx...) set TRUST_PROXY=1
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress;
}
function isHttps(req) {
  return !!req.socket.encrypted || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').startsWith('https'));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const routes = [];
const route = (method, pattern, roles, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, roles, handler });
};

// auth
route('POST', '/api/auth/login', null, ({ body, req, res }) => {
  const ip = clientIp(req);
  const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60000) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) throw new HttpError(429, 'too_many_attempts');
  const u = get('SELECT * FROM users WHERE username=? AND active=1', String(body.username || '').trim().toLowerCase());
  if (!u || !D.verifyPassword(body.password || '', u.password_hash)) {
    a.n++; loginAttempts.set(ip, a);
    throw new HttpError(401, 'invalid_credentials');
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token,user_id) VALUES(?,?)', token, u.id);
  run("DELETE FROM sessions WHERE created_at < datetime('now','localtime','-30 days')");
  res.setHeader('Set-Cookie', `gear_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${30 * 86400}${isHttps(req) ? '; Secure' : ''}`);
  audit(u, 'login', 'users', u.id);
  return { user: publicUser(u), mustChange: body.password === 'admin123' };
});
route('POST', '/api/auth/logout', ANY, ({ user, res, req }) => {
  run('DELETE FROM sessions WHERE token=?', user.token);
  res.setHeader('Set-Cookie', `gear_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
  return { ok: true };
});
route('GET', '/api/auth/me', ANY, ({ user }) => ({ user: publicUser(user) }));
route('POST', '/api/auth/password', ANY, ({ user, body }) => {
  const u = get('SELECT * FROM users WHERE id=?', user.id);
  if (!D.verifyPassword(body.current || '', u.password_hash)) throw bad('wrong_password');
  if (String(body.password || '').length < 6) throw bad('password_too_short');
  run('UPDATE users SET password_hash=? WHERE id=?', D.hashPassword(body.password), user.id);
  run('DELETE FROM sessions WHERE user_id=? AND token!=?', user.id, user.token);
  return { ok: true };
});

// users (admin)
route('GET', '/api/users', ['admin'], () => ({ rows: all('SELECT u.id, u.username, u.name, u.role, u.extra_roles, u.employee_id, u.active, u.created_at, e.name AS employee_name FROM users u LEFT JOIN employees e ON e.id=u.employee_id ORDER BY u.id') }));
route('POST', '/api/users', ['admin'], ({ body, user }) => {
  const username = String(body.username || '').trim().toLowerCase();
  if (!username || !body.name) throw bad('required');
  if (!ROLES.includes(body.role)) throw bad('invalid_role');
  if (String(body.password || '').length < 6) throw bad('password_too_short');
  if (get('SELECT id FROM users WHERE username=?', username)) throw bad('username_taken');
  const extra = parseRoles(body.extra_roles).filter((r) => r !== body.role).join(',');
  const id = Number(run('INSERT INTO users(username,name,password_hash,role,extra_roles,employee_id,active) VALUES(?,?,?,?,?,?,?)', username, body.name, D.hashPassword(body.password), body.role, extra || null, body.employee_id || null, body.active === 0 ? 0 : 1).lastInsertRowid);
  audit(user, 'create', 'users', id);
  return { id };
});
route('PUT', '/api/users/:id', ['admin'], ({ params, body, user }) => {
  const u = get('SELECT * FROM users WHERE id=?', params.id);
  if (!u) throw new HttpError(404, 'not_found');
  if (body.role && !ROLES.includes(body.role)) throw bad('invalid_role');
  if (u.id === user.id && (body.active === 0 || (body.role && body.role !== 'admin'))) throw bad('cannot_demote_self');
  run('UPDATE users SET name=COALESCE(?,name), role=COALESCE(?,role), employee_id=?, active=COALESCE(?,active) WHERE id=?',
    body.name || null, body.role || null, body.employee_id || null, body.active === undefined ? null : Number(body.active), u.id);
  if (body.extra_roles !== undefined) run('UPDATE users SET extra_roles=? WHERE id=?', parseRoles(body.extra_roles).filter((r) => r !== (body.role || u.role)).join(',') || null, u.id);
  if (body.password) {
    if (String(body.password).length < 6) throw bad('password_too_short');
    run('UPDATE users SET password_hash=? WHERE id=?', D.hashPassword(body.password), u.id);
    run('DELETE FROM sessions WHERE user_id=?', u.id);
  }
  if (body.active === 0) run('DELETE FROM sessions WHERE user_id=?', u.id);
  audit(user, 'update', 'users', u.id);
  return { ok: true };
});
route('DELETE', '/api/users/:id', ['admin'], ({ params, user }) => {
  if (Number(params.id) === user.id) throw bad('cannot_delete_self');
  run('DELETE FROM users WHERE id=?', params.id);
  return { ok: true };
});

// settings
const PUBLIC_SETTINGS = ['center_name_ar', 'center_name_en', 'center_phone', 'center_address', 'tax_no', 'currency', 'vat_rate', 'labor_rate',
  'invoice_footer_ar', 'invoice_footer_en', 'reminder_days_ahead', 'reminder_km_ahead', 'avg_km_per_month', 'allow_negative_stock', 'logo', 'whatsapp_template_ar', 'whatsapp_template_en',
  'work_start', 'work_end', 'work_days_month', 'weekend_days', 'late_grace', 'overtime_rate', 'attendance_payroll', 'deduct_late', 'week_start'];
route('GET', '/api/settings', ANY, () => {
  const s = D.allSettings();
  const o = {};
  for (const k of PUBLIC_SETTINGS) o[k] = s[k] ?? '';
  return o;
});
route('GET', '/api/public/settings', null, () => {
  const s = D.allSettings();
  return { center_name_ar: s.center_name_ar, center_name_en: s.center_name_en, logo: s.logo || '' };
});
route('PUT', '/api/settings', ['admin'], ({ body, user }) => {
  for (const k of PUBLIC_SETTINGS) if (body[k] !== undefined) D.setSetting(k, body[k]);
  audit(user, 'update', 'settings', null);
  return { ok: true };
});

route('GET', '/api/dashboard', ANY, ({ user }) => dashboard(user));
route('GET', '/api/search', ANY, ({ query }) => (String(query.q || '').trim().length < 2 ? {} : globalSearch(String(query.q).trim())));
route('GET', '/api/meta', ANY, () => ({ roles: ROLES, wo_statuses: WO_STATUSES }));

// customer / vehicle full profiles
route('GET', '/api/customers/:id/full', ANY, ({ params, user }) => {
  const c = getResource(RES.customers, params.id, user);
  c.vehicles = all('SELECT * FROM vehicles WHERE customer_id=? ORDER BY id DESC', c.id);
  c.invoices = hasAny(user, MONEY.concat(['advisor'])) ? all('SELECT i.id, i.no, i.date, i.total, i.paid, i.status, v.plate FROM invoices i LEFT JOIN vehicles v ON v.id=i.vehicle_id WHERE i.customer_id=? ORDER BY i.id DESC LIMIT 100', c.id) : [];
  c.work_orders = all('SELECT w.id, w.no, w.date, w.status, v.plate, v.model FROM work_orders w LEFT JOIN vehicles v ON v.id=w.vehicle_id WHERE w.customer_id=? ORDER BY w.id DESC LIMIT 100', c.id);
  c.reminders = all("SELECT m.*, v.plate FROM reminders m LEFT JOIN vehicles v ON v.id=m.vehicle_id WHERE m.customer_id=? AND m.status IN ('pending','contacted','booked') ORDER BY due_date", c.id);
  return c;
});
route('GET', '/api/vehicles/:id/full', ANY, ({ params, user }) => {
  const v = getResource(RES.vehicles, params.id, user);
  v.customer = get('SELECT * FROM customers WHERE id=?', v.customer_id);
  v.work_orders = all(`SELECT w.id, w.no, w.date, w.status, w.mileage, w.description, w.completed_at, i.no AS invoice_no, i.total AS invoice_total
                       FROM work_orders w LEFT JOIN invoices i ON i.id=w.invoice_id WHERE w.vehicle_id=? ORDER BY w.id DESC`, v.id);
  v.history = all(`SELECT w.id AS work_order_id, w.no, substr(COALESCE(w.completed_at,w.date),1,10) AS date, w.mileage, l.description, s.name_ar, s.name_en, e.name AS technician_name
                   FROM wo_labor l JOIN work_orders w ON w.id=l.work_order_id LEFT JOIN service_types s ON s.id=l.service_type_id LEFT JOIN employees e ON e.id=l.technician_id
                   WHERE w.vehicle_id=? AND w.status IN ('completed','delivered') ORDER BY w.id DESC`, v.id);
  v.parts_history = all(`SELECT w.no, substr(w.date,1,10) AS date, wp.qty, wp.description, p.part_no, p.name_en, p.name_ar FROM wo_parts wp JOIN work_orders w ON w.id=wp.work_order_id
                         LEFT JOIN parts p ON p.id=wp.part_id WHERE w.vehicle_id=? ORDER BY w.id DESC`, v.id);
  v.receptions = all('SELECT id, no, date, mileage, status, complaints FROM receptions WHERE vehicle_id=? ORDER BY id DESC', v.id);
  v.diagnoses = all('SELECT id, date, fault_codes, findings, approval FROM diagnoses WHERE vehicle_id=? ORDER BY id DESC', v.id);
  v.reminders = all('SELECT m.*, s.name_ar, s.name_en FROM reminders m LEFT JOIN service_types s ON s.id=m.service_type_id WHERE vehicle_id=? ORDER BY m.status, m.due_date', v.id);
  return v;
});

// reception -> work order
route('POST', '/api/receptions/:id/work-order', SHOP, ({ params, user, body }) => {
  const r = get('SELECT * FROM receptions WHERE id=?', params.id);
  if (!r) throw new HttpError(404, 'not_found');
  const existing = get('SELECT id FROM work_orders WHERE reception_id=?', r.id);
  if (existing) return { id: existing.id, existing: true };
  const d = get('SELECT * FROM diagnoses WHERE reception_id=? ORDER BY id DESC LIMIT 1', r.id);
  const desc = [r.complaints, d && d.recommendations].filter(Boolean).join('\n---\n');
  const wo = createResource('work_orders', RES.work_orders, {
    reception_id: r.id, diagnosis_id: d ? d.id : null, vehicle_id: r.vehicle_id, customer_id: r.customer_id,
    mileage: r.mileage, advisor_ids: r.advisor_ids || (r.advisor_id ? String(r.advisor_id) : ''), description: desc, priority: body.priority || 'normal',
  }, user);
  return { id: wo.id };
});

// work orders
route('GET', '/api/work-orders/:id/full', ANY, ({ params, user }) => woFull(params.id, user));
route('POST', '/api/work-orders/:id/status', SHOP, ({ params, body, user }) => { setWoStatus(Number(params.id), body.status, user); return woFull(params.id, user); });
route('POST', '/api/work-orders/:id/labor', SHOP, ({ params, body, user }) => {
  assertWoEditable(params.id);
  let { service_type_id, description, technician_id, hours, rate } = body;
  if (service_type_id) {
    const s = get('SELECT * FROM service_types WHERE id=?', service_type_id);
    if (s) {
      if (hours === undefined || hours === '') hours = s.labor_hours || 1;
      if (rate === undefined || rate === '') rate = s.labor_hours ? r2(s.labor_price / (s.labor_hours || 1)) : s.labor_price;
    }
  }
  if (!service_type_id && !description) throw bad('required', { field: 'description' });
  hours = num(hours, 1);
  rate = num(rate, num(getSetting('labor_rate', '0')));
  const amount = body.amount !== undefined && body.amount !== '' ? r2(body.amount) : r2(hours * rate);
  run('INSERT INTO wo_labor(work_order_id,service_type_id,description,technician_id,hours,rate,amount) VALUES(?,?,?,?,?,?,?)',
    params.id, service_type_id || null, description || null, technician_id || null, hours, rate, amount);
  return woFull(params.id, user);
});
route('PUT', '/api/wo-labor/:id', SHOP, ({ params, body, user }) => {
  const l = get('SELECT * FROM wo_labor WHERE id=?', params.id);
  if (!l) throw new HttpError(404, 'not_found');
  if (body.done !== undefined && Object.keys(body).length === 1) {
    run('UPDATE wo_labor SET done=? WHERE id=?', body.done ? 1 : 0, l.id);
    return woFull(l.work_order_id, user);
  }
  assertWoEditable(l.work_order_id);
  const hours = num(body.hours, l.hours);
  const rate = num(body.rate, l.rate);
  const amount = body.amount !== undefined && body.amount !== '' ? r2(body.amount) : r2(hours * rate);
  run('UPDATE wo_labor SET description=?, technician_id=?, hours=?, rate=?, amount=?, done=? WHERE id=?',
    body.description !== undefined ? body.description : l.description, body.technician_id !== undefined ? (body.technician_id || null) : l.technician_id,
    hours, rate, amount, body.done !== undefined ? (body.done ? 1 : 0) : l.done, l.id);
  return woFull(l.work_order_id, user);
});
route('DELETE', '/api/wo-labor/:id', SHOP, ({ params, user }) => {
  const l = get('SELECT * FROM wo_labor WHERE id=?', params.id);
  if (!l) throw new HttpError(404, 'not_found');
  assertWoEditable(l.work_order_id);
  run('DELETE FROM wo_labor WHERE id=?', l.id);
  return woFull(l.work_order_id, user);
});
route('POST', '/api/work-orders/:id/parts', [...SHOP, 'storekeeper'], ({ params, body, user }) => {
  assertWoEditable(params.id);
  const qty = num(body.qty, 1);
  if (!(qty > 0)) throw bad('invalid_qty');
  tx(() => {
    if (body.part_id) {
      const p = get('SELECT * FROM parts WHERE id=?', body.part_id);
      if (!p) throw bad('part_not_found');
      const price = body.unit_price !== undefined && body.unit_price !== '' ? r2(body.unit_price) : p.price;
      const id = Number(run('INSERT INTO wo_parts(work_order_id,part_id,description,qty,unit_price,unit_cost,amount,technician_id) VALUES(?,?,?,?,?,?,?,?)',
        params.id, p.id, body.description || null, qty, price, p.cost, r2(qty * price), body.technician_id || null).lastInsertRowid);
      stockMove(p.id, 'out', qty, p.cost, 'work_order', Number(params.id), `WO part #${id}`, user);
    } else {
      if (!body.description) throw bad('required', { field: 'description' });
      const price = r2(body.unit_price);
      run('INSERT INTO wo_parts(work_order_id,part_id,description,qty,unit_price,unit_cost,amount,technician_id) VALUES(?,?,?,?,?,?,?,?)',
        params.id, null, body.description, qty, price, r2(body.unit_cost), r2(qty * price), body.technician_id || null);
    }
  });
  return woFull(params.id, user);
});
route('PUT', '/api/wo-parts/:id', [...SHOP, 'storekeeper'], ({ params, body, user }) => {
  const wp = get('SELECT * FROM wo_parts WHERE id=?', params.id);
  if (!wp) throw new HttpError(404, 'not_found');
  assertWoEditable(wp.work_order_id);
  const qty = num(body.qty, wp.qty);
  if (!(qty > 0)) throw bad('invalid_qty');
  const price = num(body.unit_price, wp.unit_price);
  tx(() => {
    const diff = r2(qty - wp.qty);
    if (wp.part_id && diff > 0) stockMove(wp.part_id, 'out', diff, wp.unit_cost, 'work_order', wp.work_order_id, 'WO qty change', user);
    if (wp.part_id && diff < 0) stockMove(wp.part_id, 'return', -diff, wp.unit_cost, 'work_order', wp.work_order_id, 'WO qty change', user);
    run('UPDATE wo_parts SET qty=?, unit_price=?, amount=?, technician_id=?, description=? WHERE id=?', qty, price, r2(qty * price),
      body.technician_id !== undefined ? (body.technician_id || null) : wp.technician_id, body.description !== undefined ? body.description : wp.description, wp.id);
  });
  return woFull(wp.work_order_id, user);
});
route('DELETE', '/api/wo-parts/:id', [...SHOP, 'storekeeper'], ({ params, user }) => {
  const wp = get('SELECT * FROM wo_parts WHERE id=?', params.id);
  if (!wp) throw new HttpError(404, 'not_found');
  assertWoEditable(wp.work_order_id);
  tx(() => {
    if (wp.part_id) stockMove(wp.part_id, 'return', wp.qty, wp.unit_cost, 'work_order', wp.work_order_id, 'Removed from WO', user);
    run('DELETE FROM wo_parts WHERE id=?', wp.id);
  });
  return woFull(wp.work_order_id, user);
});
route('POST', '/api/work-orders/:id/invoice', ['admin', 'manager', 'advisor', 'accountant'], ({ params, body, user }) => invoiceFromWo(Number(params.id), body, user));

// invoices
route('POST', '/api/invoices', ['admin', 'manager', 'advisor', 'accountant'], ({ body, user }) => createManualInvoice(body, user));
route('GET', '/api/invoices/:id/full', ['admin', 'manager', 'advisor', 'accountant'], ({ params, user }) => invoiceFull(params.id, user));
route('POST', '/api/invoices/:id/payments', MONEY.concat(['advisor']), ({ params, body, user }) => { tx(() => addInvoicePayment(Number(params.id), body, user)); return invoiceFull(params.id, user); });
route('POST', '/api/invoices/:id/discount', MGMT, ({ params, body, user }) => {
  const inv = get('SELECT * FROM invoices WHERE id=?', params.id);
  if (!inv || inv.status === 'cancelled') throw bad('invoice_cancelled');
  run('UPDATE invoices SET discount=?, tax_rate=? WHERE id=?', r2(body.discount), body.tax_rate !== undefined ? num(body.tax_rate) : inv.tax_rate, inv.id);
  recalcInvoice(inv.id);
  const after = get('SELECT * FROM invoices WHERE id=?', inv.id);
  if (after.paid > after.total + 0.009) { run('UPDATE invoices SET discount=?, tax_rate=? WHERE id=?', inv.discount, inv.tax_rate, inv.id); recalcInvoice(inv.id); throw bad('amount_exceeds_due'); }
  audit(user, 'discount', 'invoices', inv.id, body);
  return invoiceFull(inv.id, user);
});
route('DELETE', '/api/invoices/:id', MGMT, ({ params, user }) => { deleteInvoice(Number(params.id), user); return { ok: true }; });
route('POST', '/api/invoices/:id/cancel', MGMT, ({ params, user }) => { cancelInvoice(Number(params.id), user); return invoiceFull(params.id, user); });

// purchases
route('POST', '/api/purchases', ['admin', 'manager', 'accountant', 'storekeeper'], ({ body, user }) => createPurchase(body, user));
route('GET', '/api/purchases/:id/full', ['admin', 'manager', 'accountant', 'storekeeper'], ({ params }) => purchaseFull(params.id));
route('POST', '/api/purchases/:id/payments', MONEY, ({ params, body, user }) => { tx(() => addPurchasePayment(Number(params.id), body, user)); return purchaseFull(params.id); });
route('PUT', '/api/purchases/:id', MONEY, ({ params, body, user }) => editPurchase(Number(params.id), body, user));
route('DELETE', '/api/purchases/:id', MGMT, ({ params, user }) => { deletePurchase(Number(params.id), user); return { ok: true }; });
route('GET', '/api/suppliers/:id/statement', ['admin', 'manager', 'accountant', 'storekeeper'], ({ params, user }) => {
  const s = getResource(RES.suppliers, params.id, user);
  const rows = [];
  for (const p of all('SELECT * FROM purchases WHERE supplier_id=?', s.id)) {
    rows.push({ date: p.date, type: p.is_return ? 'purchase_return' : 'purchase', ref: p.no, ref_id: p.id, debit: p.is_return ? p.total : 0, credit: p.is_return ? 0 : p.total, notes: p.supplier_invoice_no });
  }
  for (const t of all("SELECT * FROM transactions WHERE party_type='supplier' AND party_id=?", s.id)) {
    rows.push({ date: t.date, type: t.category, ref: t.description, debit: t.direction === 'out' ? t.amount : 0, credit: t.direction === 'in' ? t.amount : 0, notes: t.method });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let bal = num(s.opening_balance);
  for (const r of rows) { bal = r2(bal + r.credit - r.debit); r.balance = bal; }
  return { supplier: s, rows, opening_balance: num(s.opening_balance) };
});
route('POST', '/api/suppliers/:id/payments', MONEY, ({ params, body, user }) => {
  const s = get('SELECT * FROM suppliers WHERE id=?', params.id);
  if (!s) throw new HttpError(404, 'not_found');
  if (!(num(body.amount) > 0) || !body.account_id) throw bad('invalid_amount');
  run(`INSERT INTO transactions(date,account_id,direction,amount,category,description,party_type,party_id,method,user_id) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    body.date || today(), body.account_id, 'out', r2(body.amount), 'supplier_payment', body.description || `Payment to ${s.name}`, 'supplier', s.id, body.method || 'cash', user.id);
  return { ok: true };
});

// stock
route('POST', '/api/stock/adjust', STORE, ({ body, user }) => {
  const { part_id, type, qty, notes } = body;
  if (!part_id || !['in', 'out', 'adjust'].includes(type)) throw bad('required');
  if (type === 'adjust') {
    // qty = new counted quantity
    const p = get('SELECT * FROM parts WHERE id=?', part_id);
    if (!p) throw bad('part_not_found');
    const delta = r2(num(qty) - p.qty);
    if (delta) tx(() => stockMove(part_id, 'adjust', delta, p.cost, 'stocktake', null, notes || 'Stock count', user));
  } else {
    if (!(num(qty) > 0)) throw bad('invalid_qty');
    tx(() => stockMove(part_id, type, num(qty), num(body.unit_cost), 'manual', null, notes, user));
  }
  return getResource(RES.parts, part_id, user);
});

// cash
route('POST', '/api/transfer', MONEY, ({ body, user }) => {
  const amount = r2(body.amount);
  if (!(amount > 0) || !body.from || !body.to || body.from === body.to) throw bad('invalid_transfer');
  tx(() => {
    const ref = Date.now();
    run(`INSERT INTO transactions(date,account_id,direction,amount,category,description,ref_type,ref_id,user_id) VALUES(?,?,?,?,?,?,?,?,?)`, body.date || today(), body.from, 'out', amount, 'transfer', body.description || 'Transfer', 'transfer', ref, user.id);
    run(`INSERT INTO transactions(date,account_id,direction,amount,category,description,ref_type,ref_id,user_id) VALUES(?,?,?,?,?,?,?,?,?)`, body.date || today(), body.to, 'in', amount, 'transfer', body.description || 'Transfer', 'transfer', ref, user.id);
  });
  return { ok: true };
});
route('GET', '/api/cash/daily', MONEY, ({ query }) => {
  const date = query.date || today();
  const accounts = all(`SELECT a.id, a.name, a.type,
     a.opening_balance + (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) FROM transactions WHERE account_id=a.id AND date < ?) AS opening,
     (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=a.id AND date=? AND direction='in') AS cash_in,
     (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=a.id AND date=? AND direction='out') AS cash_out
     FROM accounts a WHERE a.active=1 ORDER BY a.id`, date, date, date);
  accounts.forEach((a) => { a.closing = r2(a.opening + a.cash_in - a.cash_out); });
  const byCategory = all("SELECT category, direction, SUM(amount) AS amount, COUNT(*) AS n FROM transactions WHERE date=? GROUP BY category, direction", date);
  return { date, accounts, by_category: byCategory };
});

// bonuses
route('GET', '/api/bonuses/commissions', MONEY, ({ query }) => commissions(query.from || today().slice(0, 8) + '01', query.to || today()));
route('POST', '/api/bonuses/commissions/approve', MONEY, ({ body, user }) => {
  const from = body.from; const to = body.to;
  if (!from || !to) throw bad('required');
  const period = body.period || from.slice(0, 7);
  let n = 0;
  tx(() => {
    for (const c of commissions(from, to)) {
      const remaining = r2(c.commission - c.commission_recorded);
      if (remaining > 0) {
        run("INSERT INTO bonuses(employee_id,date,period,type,amount,reason) VALUES(?,?,?,?,?,?)", c.employee_id, to, period, 'commission', remaining, `Commission ${from} → ${to}`);
        n++;
      }
    }
  });
  audit(user, 'approve_commissions', 'bonuses', null, { from, to });
  return { ok: true, created: n };
});
const validPeriod = (p) => { if (!/^\d{4}-\d{2}$|^W\d{4}-\d{2}-\d{2}$/.test(String(p || ''))) throw bad('invalid_period'); return p; };
route('GET', '/api/payroll', MONEY, ({ query }) => payroll(validPeriod(query.period || today().slice(0, 7))));
route('POST', '/api/advances', MONEY, ({ body, user }) => giveAdvance(body, user));
route('POST', '/api/payroll/pay', MONEY, ({ body, user }) => payPayroll(body, user));

// attendance (check-in / check-out)
const ATT_READ = ['admin', 'manager', 'accountant'];
route('GET', '/api/attendance', ATT_READ, ({ query }) => {
  const date = query.date || today();
  const emps = all('SELECT * FROM employees WHERE active=1 ORDER BY name');
  const recs = all('SELECT * FROM attendance WHERE date=?', date);
  const settings = D.allSettings();
  const work = !PAY.config(settings).weekend.includes(PAY.weekday(date));
  return {
    date, work_day: work,
    rows: emps.map((e) => {
      const r = recs.find((x) => x.employee_id === e.id);
      const cfg = PAY.empConfig(e, settings); // the employee's own schedule
      const wd = !cfg.weekend.includes(PAY.weekday(date));
      return { employee_id: e.id, name: e.name, job: e.job, record: r || null, work_day: wd, schedule: `${e.work_start || settings.work_start || '09:00'}-${e.work_end || settings.work_end || '17:00'}`, by_attendance: cfg.byAttendance, ...PAY.dayStats(r, cfg, wd) };
    }),
  };
});
route('GET', '/api/attendance/month', ANY, ({ query, user }) => {
  const period = query.period || today().slice(0, 7);
  let empId = Number(query.employee_id || user.employee_id);
  if (!hasAny(user, ATT_READ)) empId = Number(user.employee_id); // staff see only their own sheet
  const e = get('SELECT * FROM employees WHERE id=?', empId);
  if (!e) throw new HttpError(404, 'not_found');
  const res = attendanceCalc(e, period);
  if (!hasAny(user, ATT_READ)) { for (const k of ['salary', 'salary_due', 'absence_deduction', 'late_deduction', 'overtime_pay']) delete res[k]; }
  return { employee: { id: e.id, name: e.name, job: e.job, pay_type: e.pay_type }, period, ...res };
});
route('GET', '/api/attendance/me', ANY, ({ user }) => {
  if (!user.employee_id) return { linked: false };
  return { linked: true, date: today(), record: get('SELECT * FROM attendance WHERE employee_id=? AND date=?', user.employee_id, today()) || null };
});
// attendance is recorded by the manager / accountant only (at the server's clock)
const ATT_WRITE = ['admin', 'manager', 'accountant'];
route('POST', '/api/attendance/punch', ATT_WRITE, ({ body, user }) => {
  const empId = Number(body.employee_id);
  if (!empId) throw bad('required', { field: 'employee_id' });
  if (!get('SELECT id FROM employees WHERE id=?', empId)) throw new HttpError(404, 'not_found');
  const d = today(); const tm = nowHM();
  const r = get('SELECT * FROM attendance WHERE employee_id=? AND date=?', empId, d);
  if (body.action === 'out') {
    if (!r || !r.check_in) throw bad('not_checked_in');
    run('UPDATE attendance SET check_out=? WHERE id=?', tm, r.id);
  } else {
    if (r) run("UPDATE attendance SET check_in=?, status='present' WHERE id=?", tm, r.id);
    else run("INSERT INTO attendance(employee_id,date,status,check_in,user_id) VALUES(?,?,'present',?,?)", empId, d, tm, user.id);
  }
  audit(user, 'punch:' + (body.action || 'in'), 'attendance', empId);
  return get('SELECT * FROM attendance WHERE employee_id=? AND date=?', empId, d);
});
route('PUT', '/api/attendance', ATT_WRITE, ({ body, user }) => {
  const empId = Number(body.employee_id); const date = String(body.date || '').slice(0, 10);
  if (!empId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('required');
  const status = ATT_STATUSES.includes(body.status) ? body.status : 'present';
  const hm = (v) => (v && /^\d{1,2}:\d{2}/.test(v) ? String(v).slice(0, 5).padStart(5, '0') : null);
  const ci = status === 'present' ? hm(body.check_in) : null; const co = status === 'present' ? hm(body.check_out) : null;
  run(`INSERT INTO attendance(employee_id,date,status,check_in,check_out,notes,user_id) VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(employee_id,date) DO UPDATE SET status=excluded.status, check_in=excluded.check_in, check_out=excluded.check_out, notes=excluded.notes, user_id=excluded.user_id`,
  empId, date, status, ci, co, body.notes || null, user.id);
  audit(user, 'update', 'attendance', empId, { date, status });
  return get('SELECT * FROM attendance WHERE employee_id=? AND date=?', empId, date);
});
route('DELETE', '/api/attendance/:id', ATT_WRITE, ({ params, user }) => { run('DELETE FROM attendance WHERE id=?', params.id); audit(user, 'delete', 'attendance', Number(params.id)); return { ok: true }; });

// reminders
route('GET', '/api/reminders/due', FRONT, ({ query }) => {
  const days = num(query.days, num(getSetting('reminder_days_ahead', '30')));
  const kmAhead = num(getSetting('reminder_km_ahead', '1000'));
  const rows = all(`${RES.reminders.select} WHERE m.status IN ('pending','contacted','booked')
     AND (m.due_date <= date('now','localtime','+' || ? || ' days') OR (m.due_mileage IS NOT NULL AND v.mileage >= m.due_mileage - ?))
     ORDER BY m.due_date`, days, kmAhead);
  const t = today();
  rows.forEach((r) => { r.overdue = (r.due_date && r.due_date < t) || (r.due_mileage && r.current_mileage >= r.due_mileage) ? 1 : 0; });
  return { rows };
});

// attachments
route('POST', '/api/attachments', ANY, ({ body, user }) => {
  const { ref_type, ref_id, name, mime, data } = body;
  if (!ref_type || !ref_id || !data) throw bad('required');
  if (!/^image\/(jpeg|png|webp|gif)$|^application\/pdf$/.test(mime || '')) throw bad('invalid_file_type');
  const buf = Buffer.from(String(data).replace(/^data:[^,]+,/, ''), 'base64');
  if (buf.length > 8 * 1024 * 1024) throw bad('file_too_large');
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' }[mime];
  const filename = crypto.randomBytes(12).toString('hex') + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  const id = Number(run('INSERT INTO attachments(ref_type,ref_id,filename,original_name,mime,size) VALUES(?,?,?,?,?,?)', ref_type, ref_id, filename, name || null, mime, buf.length).lastInsertRowid);
  audit(user, 'upload', ref_type, ref_id);
  return get('SELECT * FROM attachments WHERE id=?', id);
});
route('GET', '/api/attachments', ANY, ({ query }) => ({ rows: all('SELECT * FROM attachments WHERE ref_type=? AND ref_id=? ORDER BY id', query.ref_type, query.ref_id) }));
route('DELETE', '/api/attachments/:id', FRONT.concat(['technician']), ({ params }) => {
  const a = get('SELECT * FROM attachments WHERE id=?', params.id);
  if (a) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, a.filename)); } catch (_) { /* ignore */ }
    run('DELETE FROM attachments WHERE id=?', a.id);
  }
  return { ok: true };
});

// reports, audit, backup
route('GET', '/api/reports/summary', MONEY, ({ query }) => reports(query.from || today().slice(0, 8) + '01', query.to || today()));
route('GET', '/api/reports/stock', STORE.concat(['accountant']), () => ({
  rows: all('SELECT p.*, s.name AS supplier_name, (p.qty*p.cost) AS value FROM parts p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.active=1 ORDER BY p.category, p.name_en'),
}));
route('GET', '/api/audit', ['admin'], ({ query }) => ({ rows: all('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT ?', Math.min(num(query.limit, 300), 2000)) }));
route('GET', '/api/backup', ['admin'], ({ res }) => {
  const file = path.join(D.DATA_DIR, 'backups', `gear-${today()}-${Date.now()}.db`);
  D.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const buf = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${path.basename(file)}"`, 'Content-Length': buf.length });
  res.end(buf);
  return undefined;
});

// generic CRUD routes
for (const [name, def] of Object.entries(RES)) {
  const p = '/api/' + name.replace(/_/g, '-');
  route('GET', p, def.read, ({ query, user }) => listResource(def, query, user));
  route('GET', p + '/:id', def.read, ({ params, user }) => getResource(def, params.id, user));
  route('POST', p, def.write, ({ body, user }) => createResource(name, def, body, user));
  route('PUT', p + '/:id', def.write, ({ params, body, user }) => updateResource(name, def, Number(params.id), body, user));
  route('DELETE', p + '/:id', name === 'transactions' || name === 'bonuses' ? MGMT.concat(['accountant']) : MGMT, ({ params, user }) => deleteResource(name, def, Number(params.id), user));
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache || 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 15 * 1024 * 1024) { reject(new HttpError(413, 'payload_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (pathname.startsWith('/api/')) {
    try {
      const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
      if (!r) throw new HttpError(404, 'not_found');
      const m = pathname.match(r.re);
      const params = {};
      r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
      let body = {};
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        const ct = req.headers['content-type'] || '';
        if (!ct.includes('application/json')) throw new HttpError(415, 'json_required');
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      }
      const user = currentUser(req);
      if (r.roles) need(user, r.roles);
      const query = Object.fromEntries(url.searchParams.entries());
      const out = r.handler({ req, res, params, query, body, user });
      if (out !== undefined && !res.headersSent) sendJson(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) sendJson(res, e.status, { error: e.code, ...(e.extra || {}) });
      else if (e instanceof SyntaxError) sendJson(res, 400, { error: 'invalid_json' });
      else {
        console.error(e);
        sendJson(res, 500, { error: 'server_error', message: String(e.message || e) });
      }
    }
    return;
  }

  // the Node server always runs the built-in backend, even if firebase-config.js holds a Firebase project
  if (pathname === '/firebase-config.js' && process.env.GEAR_USE_FIREBASE !== '1') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end('window.FIREBASE_CONFIG = null; // served by the GEAR Node.js server\n');
    return;
  }

  if (pathname.startsWith('/uploads/')) {
    if (!currentUser(req)) { res.writeHead(401); res.end(); return; }
    const f = path.basename(pathname);
    serveFile(res, path.join(UPLOAD_DIR, f), 'private, max-age=86400');
    return;
  }

  let file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  if (pathname === '/' || !path.extname(pathname)) file = path.join(PUBLIC_DIR, 'index.html');
  serveFile(res, file);
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const os = require('os');
    console.log(`\n  GEAR Service Center running:`);
    console.log(`   - PC:     http://localhost:${PORT}`);
    for (const ifs of Object.values(os.networkInterfaces())) {
      for (const i of ifs || []) if (i.family === 'IPv4' && !i.internal) console.log(`   - Mobile: http://${i.address}:${PORT}`);
    }
    console.log(`  Data: ${D.DB_FILE}`);
    console.log('  Default login: admin / admin123 (change it after first login)\n');
  });
}

module.exports = { server };
