// tick: runs every minute (pg_cron → pg_net). Raises alerts, resolves them when fixed, chases by push/email, sends "leave received" emails.
import { admin, nz, toMin, fmtT, label, longLabel, addDays, dow, esc, first, secrets, settings, sendEmail, wrap, push, staffWith, json } from "./lib.ts";
// Only shift and van changes need the driver to confirm; add-on/note-only changes go straight onto their portal.
function needsConfirm(i: any) { const a = i?.after || null, b = i?.before || null; if (!a?.driver || !b?.driver) return true;
  return ["driver", "trainee", "van", "start_at", "end_at", "bu_kind", "bu_block"].some(k => (a[k] ?? null) !== (b[k] ?? null)); }


const LEAVE_T: Record<string, string> = { annual: "Annual leave", sick: "Sick leave", unpaid: "Unpaid leave", bereave: "Bereavement leave", dayoff: "Day off request", other: "Other" };

Deno.serve(async (req) => {
  const sb = admin(); const sec = await secrets(sb);
  if (req.headers.get("x-cron-secret") !== sec.cron_secret) return json({ error: "nope" }, 401);
  const set = await settings(sb); const R = { sodGrace: 15, eodHours: 2, vchkDay: 4, vchkTime: "17:00", ...(set.rules || {}) }; const rem = set.reminders || {};
  const now = nz(); const t = now.date; const out: string[] = [];
  const [{ data: runs }, { data: people }, { data: shifts }, { data: rules }, { data: addons }, { data: open }, { data: items }, { data: acks }] = await Promise.all([
    sb.from("runs").select("*"), sb.from("people").select("*"), sb.from("shifts").select("*").gte("day", addDays(t, -6)).lte("day", addDays(t, 1)),
    sb.from("timing_rules").select("*").eq("active", true), sb.from("addons").select("*"), sb.from("alerts").select("*").is("resolved_at", null),
    sb.from("roster_change_items").select("*, roster_changes!inner(status)").eq("roster_changes.status", "sent").gte("day", t).lte("day", addDays(t, 1)), sb.from("change_acks").select("*"),
  ]);
  const runsBy = Object.fromEntries((runs || []).map(r => [r.code, r])); const ppl = Object.fromEntries((people || []).map(p => [p.id, p]));
  const todays = (shifts || []).filter(s => s.day === t && s.driver && s.run !== "BU");
  const ids = todays.map(s => s.id);
  const [{ data: sods }, { data: eods }] = ids.length ? await Promise.all([sb.from("sod").select("*").in("shift_id", ids), sb.from("eod").select("*").in("shift_id", ids)]) : [{ data: [] }, { data: [] }];
  const sodBy = Object.fromEntries((sods || []).map(s => [s.shift_id, s])), eodBy = Object.fromEntries((eods || []).map(e => [e.shift_id, e]));
  // pick-up totals logged today, by area (any driver's entry for that area counts)
  const { data: pus } = await sb.from("pickups").select("area").eq("day", t); const puAreas = new Set((pus || []).map((p: any) => p.area));
  const puAddons = (addons || []).filter((a: any) => a.pu_area);
  const win = (s: any) => { const w = runsBy[s.run]?.windows?.[["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dow(s.day)]]; return { st: toMin(s.start_at) ?? (w ? toMin(w[0][0]) : null), en: toMin(s.end_at) ?? (w ? toMin(w[0][1]) : null) }; };
  const isSort = (c: string) => /^SUP/.test(c);
  const alertsOpen = open || []; const newAlerts: any[] = []; const resolve: string[] = [];
  const raise = (a: any) => { if (alertsOpen.some(x => x.dedupe_key === a.dedupe_key)) return; newAlerts.push(a); };
  const inWindow = now.min >= (toMin(rem.from) ?? 420) && now.min <= (toMin(rem.to) ?? 1200);

  // per driver today
  const byDrv: Record<string, any[]> = {}; for (const s of todays) (byDrv[s.driver] ??= []).push(s);
  // off for the whole day (sick, annual leave…): don't chase their SOD / EODs, and clear anything already raised
  const { data: offRows } = await sb.from("leave_requests").select("driver").eq("status", "approved").eq("part", "full").lte("date_from", t).gte("date_to", t);
  const offToday = new Set((offRows || []).map((l: any) => l.driver));
  for (const a of alertsOpen) if (a.driver && offToday.has(a.driver) && /^(sod_late|eod_late)\|/.test(a.dedupe_key || "") && (a.dedupe_key || "").includes(`|${t}|`)) resolve.push(a.id);
  for (const [drv, list] of Object.entries(byDrv)) {
    if (offToday.has(drv)) continue;
    const segs = list.map(s => ({ s, ...win(s), sort: isSort(s.run) })).filter(x => x.st != null).sort((a, b) => a.st! - b.st!);
    segs.forEach((x, i) => { if (x.sort && (x.en == null || x.en <= x.st!)) { const nx = segs.slice(i + 1).find(y => !y.sort); x.en = nx ? Math.min(nx.st!, x.st! + 180) : x.st! + 90; } });
    if (!segs.length) continue;
    const start = Math.min(...segs.map(x => x.st!)); const end = Math.max(...segs.map(x => x.en ?? x.st!));
    const sod = segs.map(x => sodBy[x.s.id]).find(Boolean); const name = first(ppl[drv]?.name);
    const key = `sod_late|${t}|${drv}`;
    if (!sod && now.min > start + R.sodGrace && now.min < end + R.eodHours * 60) raise({ kind: "sod_late", driver: drv, shift_id: segs[0].s.id, title: `${name}: no SOD yet`, body: `Rostered ${fmtT(start)} (${segs.filter(x => !x.sort).map(x => x.s.run).join(", ") || "sort"}) · due by ${fmtT(start + R.sodGrace)}`, dedupe_key: key, _push: { to: [drv], title: "Your SOD is due", body: `Tap Start of day in the app. It was due by ${fmtT(start + R.sodGrace)}.` }, _email: "sod" });
    if (sod) for (const a of alertsOpen) if (a.dedupe_key === key) resolve.push(a.id);
    const runSegs = segs.filter(x => !x.sort);
    for (const x of segs.filter(s => !s.sort || (s.s.addons || []).length)) { const due = (x.en ?? x.st!) + R.eodHours * 60; const k = `eod_late|${t}|${drv}|${x.s.run}`; const e = eodBy[x.s.id];
      if (!x.sort && !e && now.min > due) raise({ kind: "eod_late", driver: drv, shift_id: x.s.id, title: `${name}: EOD for ${x.s.run} not in`, body: `Run finished ${fmtT(x.en)} · EOD was due by ${fmtT(due)}`, dedupe_key: k, _push: { to: [drv], title: `EOD for ${x.s.run} is overdue`, body: `It was due by ${fmtT(due)}. Tap EOD in the app.` }, _email: "eod" });
      if (e) for (const a of alertsOpen) if (a.dedupe_key === k) resolve.push(a.id);
      // pick-up totals: a run with a pick-up add-on (Lawrence, Owaka, Balclutha, South, Rural…) must have that area's totals logged.
      // Chase once the run's EOD is in (or the EOD is overdue); sort shifts after they finish. Clears itself when the totals go in.
      for (const ad of puAddons) { if (!(x.s.addons || []).includes(ad.id) || ppl[drv]?.role === "owner") continue;   // not Jeremy's own runs
        const kp = `pu_missing|${t}|${drv}|${ad.pu_area}`;
        if (puAreas.has(ad.pu_area)) { for (const a of alertsOpen) if (a.dedupe_key === kp) resolve.push(a.id); continue; }
        const ready = x.sort ? now.min > (x.en ?? x.st!) + 30 : (!!e || now.min > due);
        if (ready && now.min < 23 * 60 + 30) { raise({ kind: "pickup_missing", driver: drv, shift_id: x.s.id, title: `${name}: ${ad.pu_area} pick-up totals not in`, body: `${x.s.run} · enter them in the app under Pick-ups`, dedupe_key: kp, _push: { to: [drv], title: `${ad.pu_area} pick-up totals needed`, body: "Please enter today's pick-up counts in the app (Pick-ups), or 'None' if there weren't any." }, _msg: `Automatic reminder: your ${ad.pu_area} pick-up totals for today (${x.s.run}) aren't in yet. Please enter them in the app under Pick-ups, or tap None if there weren't any. Thanks!` }); }
      }
      // timing windows
      for (const r of rules || []) { const d = dow(t) + 1; if (!r.days.includes(d)) continue; const all = r.runs.includes("ALL"); if (!all && !r.runs.includes(x.s.run)) continue;
        // Milton meet: the D>B driver's chosen time (shifts.milton_at) replaces the rule's time on D>B and LAW, and puts the meet on LAW even if not ticked
        const meet = (r.addon === "milton" || r.addon === "tw_t10") && x.s.milton_at ? String(x.s.milton_at).slice(0, 5) : null;
        const ad = r.addon ? (addons || []).find(a => a.id === r.addon) : null; if (ad?.always && ad.runs.includes(x.s.run)) { /* standing task: every one of its runs */ } else if (ad && ad.runs.includes(x.s.run)) { if (!(x.s.addons || []).includes(r.addon) && !(meet && r.addon === "tw_t10")) continue; } else if (!all && r.runs.length > 1) continue;
        const done = !!(x.s.done?.[r.done_key || r.addon]) || (r.addon?.startsWith("tw_") && /game plan/i.test(r.name) && Object.keys(x.s.plan || {}).length > 0);
        const closes = toMin(meet ?? r.closes); if (closes == null) continue;
        const kd = `timing_due|${t}|${drv}|${r.id}`, km = `timing_missed|${t}|${drv}|${r.id}`;
        if (done || (meet && now.min < closes - 15)) { for (const a of alertsOpen) if (a.dedupe_key === kd || a.dedupe_key === km) resolve.push(a.id); if (done) continue; }   // a later Milton time clears an alert raised for the old one
        if (!done && now.min >= closes - 15 && now.min < closes) raise({ kind: "timing_due", driver: drv, shift_id: x.s.id, rule_id: r.id, title: `${name}: ${r.name} due by ${fmtT(closes)}`, body: `${x.s.run} · ${r.note || ""}`.trim(), dedupe_key: kd, _push: { to: [drv], title: `${r.name} by ${fmtT(closes)}`, body: `${r.note || "Tap Done in the app when it's sorted."}` } });
        if (!done && now.min >= closes && now.min < closes + 240) raise({ kind: "timing_missed", driver: drv, shift_id: x.s.id, rule_id: r.id, title: `${name}: ${r.name} not done by ${fmtT(closes)}`, body: `${x.s.run}`, dedupe_key: km, _push: { to: [drv], title: `${r.name} was due by ${fmtT(closes)}`, body: "If it's done, tap Done in the app. Otherwise let Jeremy know." }, _email: "timing", _rule: r });
      }
    }
    // sort running over its usual time: nudge the driver to tap Sort done (driver push only — staff aren't pinged)
    if (sod) { const SM: any = { S: 90, T: 90, DB: 60, RSB: { d: 45, Tue: 75, Thu: 75, Sat: 60 }, PCB: { d: 90, Tue: 120, Thu: 120 }, RAM: 0, TUA: 0, FLY: 0, ...(set.sortMin || {}) };
      const expOf = (c: string) => { const v = SM[c]; if (v == null) return null; if (typeof v === "number") return v; return v[["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dow(t)]] ?? v.d ?? null; };
      const stOf = (i: number) => i === 0 ? Date.parse(sod.sent_at) : (segs[i].s.sor_at ? Date.parse(segs[i].s.sor_at) : null);
      segs.forEach((x, i) => { const st = stOf(i); const k = `sort_over|${t}|${drv}|${x.s.id}`; let e: number | null = null, open = false;
        if (st != null) { const ended = !!x.s.eor_at || !!eodBy[x.s.id] || segs.some((_, j) => j > i && stOf(j) != null);
          if (x.sort) { e = x.en != null && x.en > x.st! ? x.en - x.st! : null; open = !ended; }
          else if (SM[x.s.run] !== 0 && !segs[i - 1]?.sort) { e = expOf(x.s.run); open = !ended && !x.s.deliver_at; } }
        const el = st != null ? (Date.now() - st) / 60000 : 0;
        if (open && e && el > e && el < e + 240) raise({ kind: "other", driver: drv, shift_id: x.s.id, title: `${name}: sort past ${e} min`, body: `${x.sort ? (runsBy[x.s.run]?.label || "Sort") : x.s.run} · Sort done not tapped yet`, dedupe_key: k, _quiet: true, _push: { to: [drv], title: "Sort done?", body: `You're past the usual ${e} min sort. Tap Sort done in the app to start your run.` } });
        if (!open) for (const a of alertsOpen) if (a.dedupe_key === k) resolve.push(a.id); });
    }
  }
  // roster changes not confirmed, run starting within the hour
  for (const i of items || []) { if (!needsConfirm(i)) continue; const st = toMin(i.after?.start_at) ?? (() => { const w = runsBy[i.run]?.windows?.[["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dow(i.day)]]; return w ? toMin(w[0][0]) : null; })(); if (st == null) continue;
    const minsTo = (i.day === t ? 0 : 1440) + st - now.min; if (minsTo > 90 || minsTo < -30) continue;
    for (const d of i.affects) { const a = (acks || []).find(x => x.item_id === i.id && x.driver === d); if (a?.confirmed_at || a?.dismissed_at) continue;
      raise({ kind: "change_unconfirmed", driver: d, title: `${first(ppl[d]?.name)} hasn't confirmed a roster change`, body: `${i.summary} · run starts ${fmtT(st)}`, dedupe_key: `change_unconfirmed|${i.id}|${d}`, _push: { to: [d], title: "Please confirm your roster change", body: i.summary } }); }
  }
  // vehicle checks: due Thursday by 17:00 for this week
  if (dow(t) + 1 >= R.vchkDay && (dow(t) + 1 > R.vchkDay || now.min >= (toMin(R.vchkTime) ?? 1020))) {
    const wk = addDays(t, -dow(t)); const { data: vans } = await sb.from("vans").select("*").eq("active", true); const { data: checks } = await sb.from("vehicle_checks").select("van").eq("week_start", wk);
    const weekShifts = (shifts || []).filter(s => s.day >= wk && s.van && !isSort(s.run));
    for (const v of vans || []) { if (v.plate === "OTHER" || (checks || []).some(c => c.van === v.plate)) continue; const uses = weekShifts.filter(s => s.van === v.plate); if (!uses.length && !v.responsible) continue;
      const cnt: Record<string, number> = {}; for (const s of uses) cnt[s.driver] = (cnt[s.driver] || 0) + 1; const drv = v.responsible || Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0]; if (!drv) continue;
      raise({ kind: "other", driver: drv, title: `${first(ppl[drv]?.name)}: weekly vehicle check for ${v.plate} not done`, body: `Due Thursday by ${fmtT(toMin(R.vchkTime))} · week of ${label(wk)}`, dedupe_key: `vchk|${wk}|${v.plate}`, _push: { to: [drv], title: `Vehicle check for ${v.plate}`, body: "The weekly check hasn't been sent yet. Open the app → Weekly vehicle check." } }); }
  }
  // leave: send "received" emails and alert the owner
  const { data: leave } = await sb.from("leave_requests").select("*").eq("status", "pending").is("acked_email_at", null);
  for (const l of leave || []) { const p = ppl[l.driver]; const days = Math.round((new Date(l.date_to).getTime() - new Date(l.date_from).getTime()) / 86400000) + 1; const dates = l.date_from === l.date_to ? longLabel(l.date_from) : `${longLabel(l.date_from)} to ${longLabel(l.date_to)}`; const part = l.part === "AM" ? " (morning off)" : l.part === "PM" ? " (afternoon off)" : "";
    if (p?.email) await sendEmail(sec, set, p.email, `Leave request received – ${l.date_from === l.date_to ? label(l.date_from) : `${label(l.date_from)} to ${label(l.date_to)}`} (not yet approved)`, wrap(`<p>Hi ${esc(first(p.name))},</p><p>We've received your leave request. Here are the details:</p><ul><li><b>Type:</b> ${esc(LEAVE_T[l.type] || l.type)}</li><li><b>Dates:</b> ${esc(dates)} (${part ? "half day" : `${days} day${days === 1 ? "" : "s"}`}${part})</li>${l.notes ? `<li><b>Your note:</b> ${esc(l.notes)}</li>` : ""}</ul><p><b>Please note: this request is not approved yet.</b> Jeremy will review it, and you'll get a separate email saying whether it's approved or declined. Please don't make any bookings until you have the approval email.</p><p>Thanks,<br>Jeremy<br>Taieri Post Limited</p>`));
    await sb.from("leave_requests").update({ acked_email_at: new Date().toISOString() }).eq("id", l.id);
    raise({ kind: "leave_request", driver: l.driver, title: `Leave request from ${first(p?.name)}`, body: `${LEAVE_T[l.type] || l.type} · ${dates}${part}`, dedupe_key: `leave|${l.id}`, _staffOnly: true, _area: "leave" }); out.push(`leave ack ${l.id}`);
  }

  // write alerts, push, email
  const staffAlerts = await staffWith(sb, "alerts"); const staffIds = staffAlerts.map(p => p.id);
  for (const a of newAlerts) { const { _push, _email, _rule, _staffOnly, _area, _msg, _quiet, ...row } = a; const { data: ins, error } = await sb.from("alerts").upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true }).select().maybeSingle(); if (error) { console.error(error); continue; } if (!ins) continue; out.push(row.dedupe_key);
    // fleet-only staff (alerts but no roster/scorecard, e.g. Stu) only hear about vehicle alerts
    const fleetAlert = String(row.dedupe_key || "").startsWith("vchk|");
    const staff = _area ? (await staffWith(sb, _area)).map(p => p.id) : staffAlerts.filter(p => fleetAlert || p.role === "owner" || (p.perms || []).some((x: string) => x === "roster" || x === "scorecard")).map(p => p.id);
    if (!_quiet) await push(sb, sec, set, [...new Set(staff)], { title: row.title, body: row.body, url: fleetAlert ? "/admin/#alerts" : "/admin/#live", tag: row.dedupe_key });
    if (_push && !_staffOnly) await push(sb, sec, set, _push.to, { title: _push.title, body: _push.body, url: "/", tag: row.dedupe_key });
    // also drop it in the driver's Messages, so it's there even without push notifications switched on
    if (_msg && row.driver) { const owner = Object.values(ppl).find((p: any) => p.role === "owner") as any; if (owner) { const { data: m } = await sb.from("messages").insert({ sender: owner.id, body: _msg, needs_confirm: false }).select("id").single(); if (m) await sb.from("message_recipients").insert({ message_id: m.id, person: row.driver }); } }
    if (_email && rem.enabled && inWindow) { const p = ppl[row.driver]; if (p?.email) { const what = _email === "sod" ? "SOD" : _email === "eod" ? `EOD for ${row.title.split(" for ")[1]?.split(" ")[0] || "your run"}` : (_rule?.name || "a timed task");
      await sendEmail(sec, set, p.email, `[TP SYSTEM EMAIL] Heads up: ${what} is overdue`, wrap(`<p>Hi ${esc(first(p.name))},</p><p>Quick one from the driver system (automatic, so nobody is chasing you personally).</p><p><b>${esc(row.title.replace(/^[^:]+: /, ""))}</b> — ${esc(row.body || "")}.</p><p>${_email === "timing" ? "If it's done, tap <b>Done</b> in the app. Otherwise let Jeremy know what's happening." : "If you can, pop it in now from the app: one tap for the SOD, or the EOD form for your run."}</p><p>Why it matters: every late or missing post counts against your Admin score. A post on time keeps you at 100%.</p><p>Thanks for keeping things tidy, it makes a real difference. 🙌</p>`), rem.cc || undefined); } }
  }
  if (resolve.length) await sb.from("alerts").update({ resolved_at: new Date().toISOString() }).in("id", [...new Set(resolve)]);
  return json({ ok: true, at: now.hhmm, raised: out, resolved: resolve.length });
});
