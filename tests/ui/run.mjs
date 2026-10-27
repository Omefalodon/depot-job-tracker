import { chromium } from 'playwright';
import fs from 'fs';
const SITE = process.argv[2];
const fake = fs.readFileSync(new URL('./fake-supabase.js', import.meta.url), 'utf8');
// ---------- tiny in-memory server ----------
const users = { "george@test": { id: "u-george", pw: "pw-george-123" }, "maria@test": { id: "u-maria", pw: "pw-maria-123" }, "new@test": { id: "u-new", pw: "pw-new-1234" } };
const db = { profiles: [
  { id: "u-george", email: "george@test", full_name: "George", role: "admin", active: true },
  { id: "u-maria", email: "maria@test", full_name: "Maria", role: "office", active: true },
  { id: "u-new", email: "new@test", full_name: "", role: "office", active: false }],
  jobs: [], job_prices: [], day_notes: [], job_history: [], job_files: [], job_invoices: [], suggestions: [], suggestion_votes: [] };
const objects = {}; // storage bucket job-files: path -> {size, contentType}
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'text/plain', 'application/vnd.ms-outlook'];
const pk = { jobs: "id", job_prices: "job_id", day_notes: "day", profiles: "id", job_invoices: "job_id" };
const sessions = new Map(); const pages = [];
let seq = 0; const now = () => new Date(Date.now() + (seq++)).toISOString();
function role(uid) { const p = db.profiles.find(p => p.id === uid); return p && p.active ? p.role : null; }
function handle(page, st) {
  if (st.op === "login") { const u = users[st.email]; if (!u || u.pw !== st.password) return { error: { message: "Invalid login credentials" } }; sessions.set(page, u.id); return { user: { id: u.id, email: st.email }, error: null }; }
  if (st.op === "logout") { sessions.delete(page); return {}; }
  const uid = sessions.get(page), r = role(uid), T = db[st.table];
  if (!uid) return { data: null, error: { message: "not signed in" } };
  const pr = r === "admin" || r === "office";
  if (st.op === "upload") {
    if (!pr) return { data: null, error: { message: "new row violates row-level security policy" } };
    if (!db.jobs.some(j => j.id === st.path.split('/')[0])) return { data: null, error: { message: "no such job folder" } };
    if (!ALLOWED.includes(st.contentType)) return { data: null, error: { message: "mime type not supported" } };
    if (objects[st.path]) return { data: null, error: { message: "The resource already exists" } };
    objects[st.path] = { size: st.size, contentType: st.contentType }; return { data: { path: st.path }, error: null };
  }
  if (st.op === "remove") { if (pr) for (const k of st.paths) delete objects[k]; return { data: [], error: null }; }
  if (st.op === "sign") { if (!pr || !objects[st.path]) return { data: null, error: { message: "Object not found" } }; return { data: { signedUrl: "https://files.test/sign/" + st.path + (st.download ? "?download=" + encodeURIComponent(st.download) : "") }, error: null }; }
  const allowed = st.table === "profiles" ? true : (st.table === "job_prices" || st.table === "job_files" || st.table === "job_invoices") ? pr : !!r;
  let rows = T.filter(row => st.filters.every(([k, v]) => String(row[k]) === String(v)) && (st.ins || []).every(([k, arr]) => arr.map(String).includes(String(row[k]))));
  if (st.table === "profiles" && !r) rows = rows.filter(x => x.id === uid);
  if (!allowed) return st.op === "select" ? { data: [], error: null } : { data: null, error: { message: "permission denied" } };
  let out = rows; let changed = false;
  if (st.op === "insert") { out = []; for (const one of [].concat(st.row)) { const row = Object.assign({ id: "j" + (seq++) }, one, st.table === "job_files" ? { uploaded_at: now(), uploaded_by: uid } : st.table === "suggestions" ? Object.assign({ status: "new", admin_note: "" }, one, { created_at: now(), created_by: uid }) : st.table === "suggestion_votes" ? {} : { created_at: now(), updated_at: now(), created_by: uid, updated_by: uid }); T.push(row); out.push(row); } changed = true; }
  if (st.op === "upsert") { out = []; const k = pk[st.table]; for (const one of [].concat(st.row)) { let ex = T.find(x => x[k] === one[k]); if (ex) Object.assign(ex, one, { updated_at: now(), updated_by: uid }); else { ex = Object.assign({}, one, { updated_at: now(), updated_by: uid }); T.push(ex); } out.push(ex); } changed = true; }
  if (st.op === "update") { if (st.table === "profiles" && r !== "admin") { delete st.row.role; delete st.row.active; } rows.forEach(x => Object.assign(x, st.row, st.table === "profiles" ? {} : { updated_at: now(), updated_by: uid })); changed = rows.length > 0; }
  if (st.op === "delete") { for (const x of rows) T.splice(T.indexOf(x), 1); if (st.table === "jobs") for (const x of rows) { db.job_prices = db.job_prices.filter(p => p.job_id !== x.id); db.job_files = db.job_files.filter(f => f.job_id !== x.id); db.job_invoices = db.job_invoices.filter(f => f.job_id !== x.id); } changed = true; }
  if (changed && st.table !== "profiles") setTimeout(() => pages.forEach(p => p.evaluate(() => window.__rt && window.__rt()).catch(() => { })), 50);
  const data = JSON.parse(JSON.stringify(out));
  return { data: st.single ? (data[0] || null) : data, error: null };
}
const b = await chromium.launch();
async function open(name) {
  const ctx = await b.newContext({ viewport: { width: 1450, height: 900 } });
  await ctx.route('**/index.html', async r => { const res = await r.fetch(); const body = (await res.text()).replace(/ integrity="[^"]+"/, ''); r.fulfill({ response: res, body }); });
  await ctx.route('**/vendor/supabase-2.117.2.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: fake }));
  const wxDays = [...Array(16)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.toLocaleDateString('sv'); });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: { time: wxDays, weather_code: wxDays.map(() => 1), temperature_2m_max: wxDays.map(() => 22), temperature_2m_min: wxDays.map(() => 14), precipitation_probability_max: wxDays.map(() => 10), precipitation_sum: wxDays.map(() => 0), wind_speed_10m_max: wxDays.map(() => 12), wind_gusts_10m_max: wxDays.map(() => 20) } }) }));
  await ctx.addInitScript(() => { if (!localStorage.getItem('depotJobTracker.ui')) localStorage.setItem('depotJobTracker.ui', JSON.stringify({ view: 'week', weekStart: '2026-01-05', boardDate: '2026-01-05' })); });
  await ctx.route('https://files.test/**', r => r.fulfill({ status: 200, contentType: 'text/plain', headers: r.request().url().includes('download=') ? { 'content-disposition': 'attachment; filename="file.txt"' } : {}, body: 'file body' }));
  const p = await ctx.newPage(); pages.push(p); p._errs = [];
  p.on('pageerror', e => p._errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Forecast/.test(m.text())) p._errs.push(m.text()); });
  p.on('dialog', d => { p._lastDialog = d.message(); d.accept(p._promptAnswer || undefined); });
  await p.exposeBinding('__db', async ({ page }, s) => JSON.stringify(handle(page, JSON.parse(s))));
  await p.goto(SITE);
  return p;
}
const log = (...a) => console.log(...a);
const G = await open('george'), M = await open('maria'), N = await open('new');
// login screen + wrong password
await G.fill('#lg_email', 'george@test'); await G.fill('#lg_pw', 'nope'); await G.click('#lg_btn');
await G.waitForTimeout(200); log('wrong pw msg:', await G.textContent('#lg_err'));
await G.fill('#lg_pw', 'pw-george-123'); await G.click('#lg_btn'); await G.waitForSelector('#gate', { state: 'hidden' });
await M.fill('#lg_email', 'maria@test'); await M.fill('#lg_pw', 'pw-maria-123'); await M.click('#lg_btn'); await M.waitForSelector('#gate', { state: 'hidden' });
await N.fill('#lg_email', 'new@test'); await N.fill('#lg_pw', 'pw-new-1234'); await N.click('#lg_btn'); await N.waitForTimeout(400);
log('pending user sees:', (await N.textContent('#gateMsg')).slice(0, 70));
// Week opens on this week (not the remembered old one) and shows the forecast; a past week says why it has none
await G.click('nav [data-view=week]'); await G.waitForTimeout(500);
log('week opens on this week:', (await G.textContent('.wgrid .wh.today')) !== null, '| weather lines:', await G.locator('.wx').count());
await G.click('#wPrev'); await G.click('#wPrev'); log('past week note:', (await G.textContent('#main .toolbar')).match(/No forecast[^]*$/)?.[0]);
await G.click('#wToday'); await G.click('nav [data-view=board]'); log('today board date ok:', await G.inputValue('#bDate') === new Date().toLocaleDateString('sv'));
// self-test
await G.click('#btnMenu'); await G.click('[data-act=selftest]'); log('selftest:', G._lastDialog);
// George adds a job with a price
await G.click('#btnNew'); await G.fill('#f_client', 'Client One'); await G.fill('#f_shippingContainer', 'CSQU3054383');
await G.fill('#f_weight', '21000'); await G.fill('#f_pieces', '840'); await G.fill('#f_price', '350.50');
await G.fill('#f_date', new Date().toISOString().slice(0, 10)); await G.fill('#f_time', '09:00'); await G.fill('#f_project', 'Resin');
await G.click('#btnSave'); await G.waitForTimeout(500);
log('db jobs:', db.jobs.length, 'prices:', db.job_prices.map(p => p.price));
await M.waitForTimeout(800);
log('maria sees live:', await M.locator('#sideList .card').count(), (await M.textContent('#sideList')).includes('CSQU3054383'));
// attachments: George adds two files in the editor, one bad file is refused
await G.locator('#sideList .card').first().click();
await G.setInputFiles('#filePick', [{ name: 'Τιμολόγιο 1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') }, { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('png') }, { name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') }]);
await G.waitForTimeout(900);
log('files in db:', db.job_files.map(f => f.name).join(' | '), '| objects:', Object.keys(objects).length, '| ascii keys:', Object.keys(objects).every(k => /^[A-Za-z0-9_./-]+$/.test(k)));
log('editor lists:', await G.locator('#fileList .fi').count());
await G.locator('#drop').scrollIntoViewIfNeeded(); await G.screenshot({ path: new URL('./g-editor.png', import.meta.url).pathname });
const [pop] = await Promise.all([G.waitForEvent('popup'), G.locator('#fileList [data-open="0"]').click()]); await pop.waitForURL(/files\.test/); log('open in new tab:', pop.url().startsWith('https://files.test/sign/'), 'opener cut:', await pop.evaluate(() => window.opener === null)); await pop.close();
const [fdl] = await Promise.all([G.waitForEvent('download'), G.locator('#fileList [data-dl="1"]').click()]); log('download:', fdl.url().includes('download=photo.png'));
await G.click('#jobForm [data-close]'); await M.waitForTimeout(700);
log('maria card shows clip:', (await M.textContent('#sideList')).includes('📎 2'));
// drop a file straight onto a card on Maria's screen
await M.evaluate(() => { const c = document.querySelector('#sideList .card'); const dt = new DataTransfer(); dt.items.add(new File(['hello'], 'delivery note.txt', { type: 'text/plain' })); for (const t of ['dragover', 'drop']) c.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt })); });
await M.waitForTimeout(800); log('dropped on card:', db.job_files.length, db.job_files.at(-1).name, 'by', db.job_files.at(-1).uploaded_by);
// drop a file onto the open editor: the browser must be told "copy" (a "none" here was the bug George hit)
await M.locator('#sideList .card').first().click();
const eff = await M.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['scan'], 'scan.pdf', { type: 'application/pdf' })); let fx = 'unset'; Object.defineProperty(dt, 'dropEffect', { get: () => fx, set: v => { fx = v; } }); const z = document.querySelector('#drop'); z.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); const a = dt.dropEffect; const g = document.querySelector('#f_notes'); g.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); const b = dt.dropEffect; g.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); return a + '/' + b; });
await M.waitForTimeout(800); log('editor drop effect (box/field):', eff, '| dropped in editor:', db.job_files.at(-1).name, db.job_files.length);
await M.locator('#fileList [data-fdel="3"]').click(); await M.waitForTimeout(600); await M.click('#jobForm [data-close]');
// remove one
await M.locator('#sideList .card').first().click(); await M.locator('#fileList [data-fdel="2"]').click(); await M.waitForTimeout(600);
log('after remove:', db.job_files.length, Object.keys(objects).length); await M.click('#jobForm [data-close]');
// new job with a queued file
await G.click('#btnNew'); await G.fill('#f_client', 'Queued Co'); await G.setInputFiles('#filePick', [{ name: 'quote.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') }]);
log('queued before save:', await G.locator('#fileList .fi.pending').count(), db.job_files.length);
await G.click('#btnSave'); await G.waitForTimeout(900);
const qj = db.jobs.find(j => j.client === 'Queued Co'); log('queued uploaded:', db.job_files.filter(f => f.job_id === qj.id).length);
await G.locator('#sideList .card', { hasText: 'Queued Co' }).click(); await G.click('#btnDelete'); await G.waitForTimeout(600);
log('job deleted, its files gone:', db.job_files.filter(f => f.job_id === qj.id).length, Object.keys(objects).filter(k => k.startsWith(qj.id)).length);
// conflict: both open, Maria saves first
await G.locator('#sideList .card').first().click(); await M.locator('#sideList .card').first().click();
await M.fill('#f_client', 'Client One (Maria)'); await M.click('#btnSave'); await M.waitForTimeout(400);
await G.fill('#f_client', 'Client One (George)'); G._promptAnswer = undefined; await G.click('#btnSave'); await G.waitForTimeout(600);
log('conflict dialog:', (G._lastDialog || '').split('\n')[0], '| client now:', db.jobs[0].client);
// history / meta in editor
await M.waitForTimeout(500); await M.locator('#sideList .card').first().click(); log('meta:', (await M.textContent('#jobMeta')).slice(0, 90));
await M.click('#jobForm [data-close]');
// day note live
await G.click('nav [data-view=week]'); await M.click('nav [data-view=week]');
await G.locator('.daynote').nth(2).click(); await G.keyboard.type('Crane inspection'); await G.locator('main h2').first().click(); await G.waitForTimeout(1200);
log('note in db:', JSON.stringify(db.day_notes.map(n => n.note)), '| maria sees:', await M.locator('.daynote').nth(2).inputValue());
// drag on Maria's week -> saved
const slotsBefore = db.jobs[0].job_time;
await M.locator('.slot .card').first().dragTo(M.locator('.slot[data-time="14:00"]').nth(4), { force: true }); await M.waitForTimeout(600);
log('drag saved:', slotsBefore, '->', db.jobs[0].job_time, db.jobs[0].job_date);
// admin users screen: approve new user
await G.click('nav [data-view=users]'); await G.locator('tr[data-uid="u-new"] input[data-k=active]').check(); await G.waitForTimeout(400);
log('new user active:', db.profiles.find(p => p.id === 'u-new').active);
log('maria has Users tab:', await M.isVisible('#navUsers'));
// make Maria depot -> no price
db.profiles.find(p => p.id === 'u-maria').role = 'depot';
await M.reload(); await M.fill('#lg_email', 'maria@test'); await M.fill('#lg_pw', 'pw-maria-123'); await M.click('#lg_btn'); await M.waitForSelector('#gate', { state: 'hidden' }); await M.locator('#sideList .card').first().click();
log('depot sees attachments:', await M.isVisible('#drop'), '| clip on card:', (await M.textContent('#sideList')).includes('📎'));
const txt = await M.evaluate(() => document.body.innerText); log('depot price field hidden:', await M.isHidden('#f_price'), '| price value:', JSON.stringify(await M.inputValue('#f_price')), '| price on screen:', txt.includes('350'));
await M.click('#jobForm [data-close]');
// day sheet for the depot: print layout shows only the sheet, no prices
await G.click('nav [data-view=board]'); await G.evaluate(() => { window.print = () => { window.__printed = true; }; });
await G.fill('#bDate', db.jobs[0].job_date); await G.dispatchEvent('#bDate', 'change'); await G.click('#bPrint');
await G.emulateMedia({ media: 'print' });
const sheetTxt = await G.evaluate(() => document.body.innerText);
log('day sheet printed:', await G.evaluate(() => window.__printed), '| has container:', sheetTxt.includes('CSQU3054383'), '| price shown:', sheetTxt.includes('350'), '| app hidden:', !sheetTxt.includes('New job'));
await G.screenshot({ path: new URL('./g-daysheet.png', import.meta.url).pathname }); await G.emulateMedia({ media: 'screen' });
const [dsx] = await Promise.all([G.waitForEvent('download'), G.click('#bSheetX')]); await dsx.saveAs(new URL('./daysheet.xlsx', import.meta.url).pathname); log('day sheet excel:', dsx.suggestedFilename());
// Excel template -> filled like in Excel -> import with preview
await G.click('nav [data-view=all]');
const [tpl] = await Promise.all([G.waitForEvent('download'), G.click('#tplBtn')]); const tplPath = new URL('./tpl.xlsx', import.meta.url).pathname, filled = new URL('./tpl-filled.xlsx', import.meta.url).pathname;
await tpl.saveAs(tplPath); (await import('child_process')).execFileSync('python3', [new URL('./fill-template.py', import.meta.url).pathname, tplPath, filled]);
const jobsBefore = db.jobs.length;
await G.setInputFiles('#fileImport', filled); await G.waitForSelector('#impDlg[open]');
log('import preview:', (await G.textContent('#impBody p')).trim(), '| rows:', await G.locator('#impBody tbody tr').count(), '| button:', await G.textContent('#impGo'));
await G.click('#impGo'); await G.waitForTimeout(900);
const added = db.jobs.slice(jobsBefore);
log('imported:', added.length, added.map(j => [j.client, j.sender, j.receiver, j.project, j.job_date, j.job_time, j.status, j.weight].join('/')).join(' | '));
log('imported price/invoice:', db.job_prices.filter(p => added.some(j => j.id === p.job_id)).map(p => p.price), db.job_invoices.filter(p => added.some(j => j.id === p.job_id)).map(p => p.invoice_no));
// Invoicing: filters, click + shift-click, one number on several jobs
await G.click('nav [data-view=invoicing]');
log('invoicing shows (not invoiced):', await G.locator('tr.irow').count());
await G.locator('tr.irow').nth(0).click(); await G.locator('tr.irow').nth(2).click({ modifiers: ['Shift'] });
log('selected:', (await G.textContent('.invbar .n')));
await G.fill('#invNo', 'INV-2026-001'); await G.click('#invSet'); await G.waitForTimeout(700);
log('invoice rows:', db.job_invoices.map(i => i.invoice_no).join(','), '| left not invoiced:', await G.locator('tr.irow').count());
await G.selectOption('[data-f=invoiced]', 'yes'); await G.fill('[data-f=invoiceNo]', '2026-0'); await G.waitForTimeout(200);
log('filter invoiced + contains:', await G.locator('tr.irow').count(), '| focus kept:', await G.evaluate(() => document.activeElement.dataset.f));
await G.selectOption('[data-f=client]', 'Second'); log('filter client:', await G.locator('tr.irow').count());
await G.click('[data-fclear]'); await G.selectOption('[data-f=invoiced]', 'all');
await G.locator('tr.irow', { hasText: 'Second' }).click(); await G.click('#invClear'); await G.waitForTimeout(700);
log('after remove:', db.job_invoices.map(i => i.invoice_no).join(','));
await G.screenshot({ path: new URL('./g-invoicing.png', import.meta.url).pathname });
// editor shows the invoice number and the history line
await G.locator('tr.irow', { hasText: 'Ελληνική' }).locator('[data-open]').click();
log('editor invoice no:', await G.inputValue('#f_invoiceNo')); await G.click('#jobForm [data-close]');
log('depot has Invoicing tab:', await M.isVisible('nav [data-view=invoicing]'));
await G.click('nav [data-view=all]'); await G.selectOption('[data-f=project]', 'Bulk Project'); log('all jobs project filter:', await G.locator('tr.row').count()); await G.click('[data-fclear]');
// Plan loads: 2 per day on weekdays for a week
await G.click('nav [data-view=projects]'); await G.click('#planBtn');
await G.fill('#pl_project', 'Bulk Project'); await G.fill('#pl_perDay', '2'); await G.fill('#pl_from', '2026-11-02'); await G.fill('#pl_to', '2026-11-08');
log('plan summary:', await G.textContent('#pl_sum'));
const nPlanBefore = db.jobs.length; await G.click('#pl_go'); await G.waitForTimeout(800);
const planned = db.jobs.slice(nPlanBefore); log('planned:', planned.length, [...new Set(planned.map(j => j.job_date))].join(','), planned[0] && planned[0].client, planned[0] && planned[0].notes);
// Fill a planned load: open the slot, pick one of the project's jobs, it moves to that day
const slotJob = db.jobs.find(j => j.is_slot); const unitJob = db.jobs.find(j => !j.is_slot && j.project === slotJob.project && j.status !== 'done' && j.shipping_container);
await G.click('nav [data-view=week]'); await G.evaluate(d => { ui.weekStart = DJ.mondayOf(d); render(); }, slotJob.job_date); await G.waitForTimeout(200);
await G.locator('.card.planned').first().click();
log('slot editor:', await G.textContent('#dlgTitle'), '| client field hidden:', await G.isHidden('#f_client'), '| options:', await G.locator('#slotPick option').count());
await G.selectOption('#slotPick', unitJob.id); log('details shown:', (await G.textContent('#slotBox .det')).includes(unitJob.shipping_container));
const plannedBefore = db.jobs.filter(j => j.is_slot).length;
await G.click('#slotUse'); await G.waitForTimeout(900);
const moved = db.jobs.find(j => j.id === unitJob.id);
log('filled:', moved.job_date === slotJob.job_date, moved.status, '| slots left:', db.jobs.filter(j => j.is_slot).length, "of", plannedBefore, '| editor now on job:', await G.textContent('#dlgTitle'));
// Undo: the load won't happen that day, so put the container back in the project list
log('put-back button shown:', await G.isVisible('#btnUnslot'));
await G.click('#btnUnslot'); await G.waitForTimeout(900);
const back = db.jobs.find(j => j.id === unitJob.id);
log('put back:', back.job_date === null || back.job_date === '' ? 'no date' : back.job_date, back.status, '| slots now:', db.jobs.filter(j => j.is_slot).length, 'of', plannedBefore, '| new slot on day:', db.jobs.some(j => j.is_slot && j.job_date === slotJob.job_date && j.id !== slotJob.id && !j.notes.includes(' of ')), '| dialog open:', await G.isVisible('#dlg'));
// Week: drag from the side panel into a slot, and add a second job to a slot that already has one
await G.click('nav [data-view=week]'); await G.click('#wToday'); await G.waitForTimeout(200);
const sideJob = await G.locator('#sideList .card[draggable]').first().getAttribute('data-id');
const target = G.locator('.slot[data-time="11:00"]').nth(2); const tDay = await target.getAttribute('data-day');
await G.locator('#sideList .card[data-id="' + sideJob + '"]').dragTo(target, { force: true }); await G.waitForTimeout(600);
const sj = db.jobs.find(j => j.id === sideJob); log('side panel drag:', sj.job_date === tDay, sj.job_time);
const nB = db.jobs.length; await target.hover(); await target.locator('.addslot').click(); log('add in busy slot:', await G.inputValue('#f_date') === tDay, await G.inputValue('#f_time'));
await G.fill('#f_client', 'Second in slot'); await G.click('#btnSave'); await G.waitForTimeout(600);
log('two jobs in slot:', db.jobs.length === nB + 1, await G.locator('.slot[data-day="' + tDay + '"][data-time="11:00"] .card').count());
// Suggestions: depot Maria posts, George votes + sets status and reply, Maria votes once
await M.click('nav [data-view=suggestions]'); await M.fill('#sugText', 'Bigger buttons on the Today board'); await M.click('#sugPost'); await M.waitForTimeout(700);
await G.waitForTimeout(500); log('admin badge:', await G.textContent('#navSug'));
await G.click('#navSug .navbadge'); await G.locator('.sug [data-vote]').first().click(); await G.waitForTimeout(500);
await G.selectOption('.sug [data-status]', 'planned'); await G.waitForTimeout(500); await G.fill('.sug [data-note]', 'Next week'); await G.locator('.sug [data-note]').press('Tab'); await G.waitForTimeout(600);
await M.waitForTimeout(400); await M.locator('.sug [data-vote]').first().click(); await M.waitForTimeout(600);
log('suggestion:', JSON.stringify(db.suggestions.map(x => [x.body, x.status, x.admin_note])), '| votes:', db.suggestion_votes.length, '| maria sees reply:', (await M.textContent('.sug')).includes('Next week'), '| maria has status menu:', await M.locator('.sug [data-status]').count()); await G.screenshot({ path: new URL('./g-sug.png', import.meta.url).pathname });
// export as admin
await G.click('nav [data-view=projects]'); const [dl] = await Promise.all([G.waitForEvent('download'), G.click('#exportProj')]); await dl.saveAs(new URL('./out.xlsx', import.meta.url).pathname);
await G.screenshot({ path: new URL('./g-projects.png', import.meta.url).pathname }); await G.click('nav [data-view=week]'); await G.screenshot({ path: new URL('./g-week.png', import.meta.url).pathname });
// delete
await G.locator('#sideList .card').first().click(); await G.click('#btnDelete'); await G.waitForTimeout(500);
log('deleted, jobs:', db.jobs.length, 'prices:', db.job_prices.length, 'files:', db.job_files.length, 'objects:', Object.keys(objects).length);
// sign out
await G.click('#btnMenu'); await G.click('[data-act=signout]'); await G.waitForTimeout(300); log('after sign out gate visible:', await G.isVisible('#gate'));
for (const [n, p] of [['G', G], ['M', M], ['N', N]]) log(n, 'errors:', p._errs);
await b.close();
