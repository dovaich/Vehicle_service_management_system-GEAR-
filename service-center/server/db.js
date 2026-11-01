'use strict';
// Database layer: SQLite via Node's built-in node:sqlite (Node >= 22.13)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.GEAR_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'gear.db');
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'advisor',
  employee_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  phone2 TEXT,
  email TEXT,
  address TEXT,
  type TEXT DEFAULT 'individual',
  tax_no TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  plate TEXT,
  vin TEXT,
  make TEXT DEFAULT 'BMW',
  series TEXT,
  model TEXT,
  chassis_code TEXT,
  year INTEGER,
  color TEXT,
  engine TEXT,
  fuel TEXT,
  transmission TEXT,
  mileage INTEGER DEFAULT 0,
  warranty_until TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  job TEXT DEFAULT 'technician',
  national_id TEXT,
  hire_date TEXT,
  salary REAL DEFAULT 0,
  labor_commission REAL DEFAULT 0,
  parts_commission REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS service_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  category TEXT,
  labor_hours REAL DEFAULT 1,
  labor_price REAL DEFAULT 0,
  interval_km INTEGER DEFAULT 0,
  interval_months INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  time TEXT,
  service TEXT,
  advisor_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'scheduled',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS receptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  date TEXT DEFAULT (datetime('now','localtime')),
  mileage INTEGER,
  fuel_level TEXT,
  complaints TEXT,
  checklist TEXT,
  damages TEXT,
  belongings TEXT,
  warning_lights TEXT,
  advisor_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  expected_delivery TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  status TEXT DEFAULT 'open',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS diagnoses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reception_id INTEGER REFERENCES receptions(id) ON DELETE CASCADE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  technician_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  date TEXT DEFAULT (datetime('now','localtime')),
  tool TEXT,
  fault_codes TEXT,
  findings TEXT,
  recommendations TEXT,
  estimated_cost REAL DEFAULT 0,
  estimated_hours REAL DEFAULT 0,
  approval TEXT DEFAULT 'pending',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT,
  reception_id INTEGER REFERENCES receptions(id) ON DELETE SET NULL,
  diagnosis_id INTEGER REFERENCES diagnoses(id) ON DELETE SET NULL,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  date TEXT DEFAULT (datetime('now','localtime')),
  mileage INTEGER,
  status TEXT DEFAULT 'open',
  priority TEXT DEFAULT 'normal',
  bay TEXT,
  advisor_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  description TEXT,
  qc_checklist TEXT,
  qc_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  started_at TEXT,
  completed_at TEXT,
  delivered_at TEXT,
  invoice_id INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS wo_labor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  service_type_id INTEGER REFERENCES service_types(id) ON DELETE SET NULL,
  description TEXT,
  technician_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  hours REAL DEFAULT 1,
  rate REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  done INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wo_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  part_id INTEGER REFERENCES parts(id) ON DELETE SET NULL,
  description TEXT,
  qty REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  unit_cost REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  technician_id INTEGER REFERENCES employees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  tax_no TEXT,
  opening_balance REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_no TEXT,
  oem_no TEXT,
  name_ar TEXT,
  name_en TEXT NOT NULL,
  category TEXT,
  brand TEXT,
  unit TEXT DEFAULT 'pcs',
  qty REAL DEFAULT 0,
  min_qty REAL DEFAULT 0,
  cost REAL DEFAULT 0,
  price REAL DEFAULT 0,
  location TEXT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  active INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  date TEXT DEFAULT (datetime('now','localtime')),
  type TEXT NOT NULL,
  qty REAL NOT NULL,
  unit_cost REAL DEFAULT 0,
  ref_type TEXT,
  ref_id INTEGER,
  notes TEXT,
  user_id INTEGER
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  date TEXT DEFAULT (date('now','localtime')),
  supplier_invoice_no TEXT,
  subtotal REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  total REAL DEFAULT 0,
  paid REAL DEFAULT 0,
  is_return INTEGER DEFAULT 0,
  status TEXT DEFAULT 'unpaid',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  part_id INTEGER REFERENCES parts(id) ON DELETE SET NULL,
  description TEXT,
  qty REAL DEFAULT 1,
  unit_cost REAL DEFAULT 0,
  amount REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT,
  work_order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  date TEXT DEFAULT (date('now','localtime')),
  labor_total REAL DEFAULT 0,
  parts_total REAL DEFAULT 0,
  parts_cost REAL DEFAULT 0,
  subtotal REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  total REAL DEFAULT 0,
  paid REAL DEFAULT 0,
  status TEXT DEFAULT 'unpaid',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind TEXT DEFAULT 'labor',
  description TEXT,
  qty REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  unit_cost REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  part_id INTEGER,
  technician_id INTEGER
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'cash',
  opening_balance REAL DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT DEFAULT (date('now','localtime')),
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  ref_type TEXT,
  ref_id INTEGER,
  party_type TEXT,
  party_id INTEGER,
  method TEXT,
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS bonuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT DEFAULT (date('now','localtime')),
  period TEXT,
  type TEXT DEFAULT 'bonus',
  amount REAL NOT NULL,
  reason TEXT,
  paid INTEGER DEFAULT 0,
  transaction_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  service_type_id INTEGER REFERENCES service_types(id) ON DELETE SET NULL,
  title TEXT,
  due_date TEXT,
  due_mileage INTEGER,
  last_service_date TEXT,
  last_mileage INTEGER,
  work_order_id INTEGER,
  status TEXT DEFAULT 'pending',
  contacted_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_type TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT,
  mime TEXT,
  size INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate);
CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin);
CREATE INDEX IF NOT EXISTS idx_wo_vehicle ON work_orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_inv_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id, date);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_date);
CREATE INDEX IF NOT EXISTS idx_stock_part ON stock_moves(part_id);
`;

db.exec(SCHEMA);

// ---------- helpers ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pw), salt, 64);
  const orig = Buffer.from(hash, 'hex');
  return orig.length === test.length && crypto.timingSafeEqual(orig, test);
}

const all = (sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
const get = (sql, ...p) => {
  const r = db.prepare(sql).get(...p);
  return r ? { ...r } : undefined;
};
const run = (sql, ...p) => db.prepare(sql).run(...p);

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function getSetting(key, def = null) {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  return r ? r.value : def;
}
function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value == null ? '' : String(value));
}
function allSettings() {
  const o = {};
  for (const r of all('SELECT key, value FROM settings')) o[r.key] = r.value;
  return o;
}

// ---------- seed ----------
function seed() {
  const defaults = {
    center_name_ar: 'مركز صيانة BMW',
    center_name_en: 'BMW Service Center',
    center_phone: '',
    center_address: '',
    tax_no: '',
    currency: 'EGP',
    vat_rate: '14',
    labor_rate: '600',
    invoice_footer_ar: 'شكراً لثقتكم - ضمان العمالة 30 يوم',
    invoice_footer_en: 'Thank you for your trust - 30 days labor warranty',
    reminder_days_ahead: '30',
    reminder_km_ahead: '1000',
    avg_km_per_month: '1500',
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (getSetting(k) === null) setSetting(k, v);
  }

  if (!get('SELECT id FROM users LIMIT 1')) {
    run('INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,?)', 'admin', 'Administrator', hashPassword('admin123'), 'admin');
  }

  if (!get('SELECT id FROM accounts LIMIT 1')) {
    run("INSERT INTO accounts(name,type) VALUES('الخزنة الرئيسية / Main Cash','cash')");
    run("INSERT INTO accounts(name,type) VALUES('البنك / Bank','bank')");
    run("INSERT INTO accounts(name,type) VALUES('ماكينة الفيزا / POS','pos')");
  }

  if (!get('SELECT id FROM service_types LIMIT 1')) {
    // BMW Condition Based Service (CBS) inspired defaults
    const st = [
      ['OIL', 'تغيير زيت المحرك والفلتر', 'Engine oil & filter service', 'CBS', 1, 600, 10000, 12],
      ['BRK-F', 'تغيير فرامل أمامي (تيل + طنابير)', 'Front brake pads & discs', 'Brakes', 1.5, 900, 40000, 0],
      ['BRK-R', 'تغيير فرامل خلفي (تيل + طنابير)', 'Rear brake pads & discs', 'Brakes', 1.5, 900, 50000, 0],
      ['BRK-FL', 'تغيير زيت الفرامل', 'Brake fluid service', 'CBS', 0.5, 400, 0, 24],
      ['MICRO', 'تغيير فلتر التكييف', 'Microfilter (cabin filter)', 'CBS', 0.5, 250, 20000, 12],
      ['AIR', 'تغيير فلتر الهواء', 'Engine air filter', 'CBS', 0.5, 250, 40000, 24],
      ['SPARK', 'تغيير البوجيهات', 'Spark plugs', 'CBS', 1.5, 900, 60000, 48],
      ['FUEL-F', 'تغيير فلتر البنزين/الديزل', 'Fuel filter', 'CBS', 1, 600, 60000, 0],
      ['VCHK', 'فحص دوري شامل', 'Vehicle check', 'CBS', 1, 500, 30000, 24],
      ['ATF', 'تغيير زيت الفتيس الأوتوماتيك', 'Automatic transmission fluid', 'Drivetrain', 2, 1200, 80000, 0],
      ['DIFF', 'تغيير زيت الدفرنس', 'Differential oil', 'Drivetrain', 1, 500, 80000, 0],
      ['COOL', 'تغيير سائل التبريد', 'Coolant service', 'Engine', 1, 500, 0, 48],
      ['ISTA', 'كشف كمبيوتر ISTA', 'ISTA computer diagnosis', 'Diagnosis', 1, 750, 0, 0],
      ['CODE', 'برمجة وتكويد', 'Coding & programming', 'Electrical', 1, 1000, 0, 0],
      ['AC', 'صيانة تكييف وشحن فريون', 'A/C service & recharge', 'A/C', 1, 700, 0, 24],
      ['ALIGN', 'ضبط زوايا وترصيص', 'Wheel alignment & balancing', 'Tyres', 1, 500, 20000, 0],
      ['BATT', 'تغيير وتسجيل بطارية', 'Battery replacement & registration', 'Electrical', 0.5, 400, 0, 48],
      ['WASH', 'غسيل وتنظيف', 'Wash & clean', 'Other', 0.5, 200, 0, 0],
    ];
    const ins = db.prepare('INSERT INTO service_types(code,name_ar,name_en,category,labor_hours,labor_price,interval_km,interval_months) VALUES(?,?,?,?,?,?,?,?)');
    for (const s of st) ins.run(...s);
  }
}
seed();

module.exports = { db, all, get, run, tx, getSetting, setSetting, allSettings, hashPassword, verifyPassword, DATA_DIR, DB_FILE };
