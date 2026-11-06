// Minimal stand-in for web/shared/core.js so the browser scoring engine (score.js) runs unchanged on the server.
const TZ = "Pacific/Auckland";
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtParts = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
export function nzNow(d = new Date()) { const p = {}; for (const x of fmtParts.formatToParts(d)) p[x.type] = x.value; return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute), sec: +p.second, dow: DAYS.indexOf(p.weekday), hhmm: `${p.hour}:${p.minute}`, dt: d }; }
export const today = () => nzNow().date;
export function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function dow(iso) { return (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7; }
export function label(iso, withYear = false) { const d = new Date(iso + "T12:00:00Z"); return `${DAYS[dow(iso)]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? " " + d.getUTCFullYear() : ""}`; }
export function toMin(t) { if (t == null || t === "") return null; const m = /^(\d{1,2}):(\d{2})/.exec(String(t)); return m ? (+m[1]) * 60 + (+m[2]) : null; }
export function fmtT(min) { if (min == null) return ""; let h = Math.floor(min / 60) % 24, m = min % 60; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, "0")}${ap}` : `${h}${ap}`; }
export function isSort(code) { return /^SUP/.test(code); }
