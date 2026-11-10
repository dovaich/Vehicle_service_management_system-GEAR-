/* GEAR - attendance & salary calculation (shared by the Node server and the browser / Firebase mode).
 *
 * Settings (cfg):
 *   work_start "09:00", work_end "17:00", work_days_month 26, weekend_days "5" (0=Sun ... 5=Fri, 6=Sat),
 *   late_grace 15 (minutes), overtime_rate 1.5, attendance_payroll "0"/"1" (monthly salaries follow attendance; off by default),
 *   deduct_late "1" (late arrival + early leave are deducted)
 * Attendance record: { date "YYYY-MM-DD", status: present|absent|leave|sick|holiday|unpaid, check_in "HH:MM", check_out "HH:MM" }
 * Employee: { salary, pay_type: monthly|weekly|daily|hourly, pay_cycle: monthly|weekly, hire_date }
 *   monthly: salary = monthly amount; weekly: salary = weekly amount; daily: day wage; hourly: hour wage
 * Period: "YYYY-MM" (a month) or "WYYYY-MM-DD" (the 7 days starting that date)
 * Per employee (optional, empty = use the general settings):
 *   attendance_based "1" = salary follows attendance (absence, lateness, overtime) / "0" = full salary
 *   work_start, work_end, weekend_days = the employee's own schedule
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GEAR_PAY = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const PAID_LEAVE = ['leave', 'sick', 'holiday'];
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const num = (v, d) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? d : Number(v));
  const toMin = (hm) => {
    if (!hm) return null;
    const m = String(hm).match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const pad = (n) => String(n).padStart(2, '0');

  function config(s = {}) {
    const start = toMin(s.work_start) ?? 9 * 60;
    let end = toMin(s.work_end) ?? 17 * 60;
    if (end <= start) end = start + 8 * 60;
    return {
      start, end, dayMinutes: end - start,
      workDaysMonth: Math.max(1, num(s.work_days_month, 26)),
      weekend: String(s.weekend_days ?? '5').split(',').filter((x) => x !== '').map(Number),
      grace: Math.max(0, num(s.late_grace, 15)),
      otRate: Math.max(0, num(s.overtime_rate, 1.5)),
      byAttendance: String(s.attendance_payroll ?? '0') === '1',
      deductLate: String(s.deduct_late ?? '1') === '1',
      weekStart: num(s.week_start, 6), // 6 = Saturday
    };
  }
  // the employee's own schedule / attendance choice on top of the general settings
  function empConfig(emp, settings = {}) {
    const s = { ...settings };
    for (const k of ['work_start', 'work_end', 'weekend_days']) if (emp && emp[k] !== undefined && emp[k] !== null && String(emp[k]).trim() !== '') s[k] = emp[k];
    if (emp && (String(emp.attendance_based) === '1' || String(emp.attendance_based) === '0')) s.attendance_payroll = String(emp.attendance_based);
    return config(s);
  }
  // pay cycle: weekly salaries are paid weekly, monthly ones monthly; daily/hourly follow pay_cycle
  const cycleOf = (emp) => (emp.pay_type === 'weekly' ? 'weekly' : emp.pay_type === 'daily' || emp.pay_type === 'hourly' ? (emp.pay_cycle === 'weekly' ? 'weekly' : 'monthly') : 'monthly');
  const isWeek = (period) => /^W\d{4}-\d{2}-\d{2}$/.test(String(period));
  const addDays = (date, n) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  /** "WYYYY-MM-DD" for the week containing date */
  function weekOf(date, settings) {
    const start = config(settings).weekStart;
    const back = (new Date(date + 'T12:00:00').getDay() - start + 7) % 7;
    return 'W' + addDays(date, -back);
  }
  function periodDays(period) {
    if (isWeek(period)) { const s = period.slice(1); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
    return monthDays(period);
  }
  const periodLabel = (period) => (isWeek(period) ? `${period.slice(1)} → ${addDays(period.slice(1), 6)}` : period);

  // minutes for one day record
  function dayStats(rec, cfg, isWorkDay = true) {
    const out = { late: 0, early: 0, overtime: 0, worked: 0 };
    if (!rec || rec.status !== 'present') return out;
    const a = toMin(rec.check_in); const b = toMin(rec.check_out);
    if (a !== null && b !== null && b > a) out.worked = b - a;
    if (!isWorkDay) { out.overtime = out.worked; return out; } // working on a day off is all overtime
    if (a !== null && a > cfg.start + cfg.grace) out.late = a - cfg.start;
    if (b !== null && b < cfg.end) out.early = cfg.end - b;
    if (b !== null && b > cfg.end) out.overtime = b - Math.max(cfg.end, a ?? cfg.end);
    return out;
  }

  function monthDays(period) {
    const [y, m] = period.split('-').map(Number);
    const n = new Date(y, m, 0).getDate();
    return Array.from({ length: n }, (_, i) => `${period}-${pad(i + 1)}`);
  }
  const weekday = (date) => new Date(date + 'T12:00:00').getDay();

  /** salary calculation for one employee and one month */
  function calc(emp, records, period, settings, today) {
    const cfg = empConfig(emp, settings);
    const byDate = {};
    for (const r of records || []) byDate[String(r.date).slice(0, 10)] = r;
    const payType = emp.pay_type || 'monthly';
    const salary = num(emp.salary, 0);
    const hire = emp.hire_date ? String(emp.hire_date).slice(0, 10) : '';
    const res = {
      pay_type: payType, salary, working_days: 0, present_days: 0, absent_days: 0, leave_days: 0, unpaid_days: 0,
      late_minutes: 0, early_minutes: 0, overtime_minutes: 0, worked_minutes: 0,
      absence_deduction: 0, late_deduction: 0, overtime_pay: 0, salary_due: 0, by_attendance: true, days: [],
    };
    for (const date of periodDays(period)) {
      const isWork = !cfg.weekend.includes(weekday(date));
      const rec = byDate[date];
      const st = dayStats(rec, cfg, isWork);
      let status = rec ? rec.status : null;
      const counted = date < today || (date === today && rec); // today counts only once recorded
      if (hire && date < hire) status = status || 'not_hired';
      else if (isWork && !rec && counted) status = 'absent';
      if (isWork && counted && status !== 'not_hired') res.working_days++;
      if (status === 'present') { if (isWork) res.present_days++; }
      else if (PAID_LEAVE.includes(status)) { if (isWork) res.leave_days++; }
      else if (status === 'unpaid') { if (isWork) res.unpaid_days++; }
      else if (status === 'absent' && isWork) res.absent_days++;
      res.late_minutes += st.late; res.early_minutes += st.early; res.overtime_minutes += st.overtime; res.worked_minutes += st.worked;
      res.days.push({ date, weekday: weekday(date), work_day: isWork, status, check_in: rec ? rec.check_in || '' : '', check_out: rec ? rec.check_out || '' : '', notes: rec ? rec.notes || '' : '', id: rec ? rec.id : null, ...st });
    }
    const short = cfg.deductLate ? res.late_minutes + res.early_minutes : 0;
    if (payType === 'daily') {
      const minRate = salary / cfg.dayMinutes;
      const base = (res.present_days + res.leave_days) * salary;
      res.late_deduction = r2(short * minRate);
      res.overtime_pay = r2(res.overtime_minutes * minRate * cfg.otRate);
      res.salary_due = r2(Math.max(0, base - res.late_deduction + res.overtime_pay));
    } else if (payType === 'hourly') {
      const regular = Math.max(0, res.worked_minutes - res.overtime_minutes) + res.leave_days * cfg.dayMinutes;
      res.overtime_pay = r2((res.overtime_minutes / 60) * salary * cfg.otRate);
      res.salary_due = r2((regular / 60) * salary + res.overtime_pay);
    } else {
      // weekly salary: a day is salary / working days in the week; monthly: salary / working days per month
      const workDaysWeek = Math.max(1, 7 - cfg.weekend.length);
      const dayRate = payType === 'weekly' ? salary / workDaysWeek : salary / cfg.workDaysMonth;
      const minRate = dayRate / cfg.dayMinutes;
      if (!cfg.byAttendance) {
        res.by_attendance = false;
        res.salary_due = r2(salary);
      } else {
        res.absence_deduction = r2((res.absent_days + res.unpaid_days) * dayRate);
        res.late_deduction = r2(short * minRate);
        res.overtime_pay = r2(res.overtime_minutes * minRate * cfg.otRate);
        res.salary_due = r2(Math.max(0, salary - res.absence_deduction - res.late_deduction + res.overtime_pay));
      }
    }
    return res;
  }

  return { calc, config, empConfig, dayStats, monthDays, periodDays, periodLabel, weekOf, isWeek, cycleOf, weekday, toMin, PAID_LEAVE };
}));
