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
  jobs: [], job_prices: [], day_notes: [], job_history: [] };
const pk = { jobs: "id", job_prices: "job_id", day_notes: "day", profiles: "id" };
const sessions = new Map(); const pages = [];
let seq = 0; const now = () => new Date(Date.now() + (seq++)).toISOString();
function role(uid) { const p = db.profiles.find(p => p.id === uid); return p && p.active ? p.role : null; }
function handle(page, st) {
  if (st.op === "login") { const u = users[st.email]; if (!u || u.pw !== st.password) return { error: { message: "Invalid login credentials" } }; sessions.set(page, u.id); return { user: { id: u.id, email: st.email }, error: null }; }
  if (st.op === "logout") { sessions.delete(page); return {}; }
  const uid = sessions.get(page), r = role(uid), T = db[st.table];
  if (!uid) return { data: null, error: { message: "not signed in" } };
  const allowed = st.table === "profiles" ? true : st.table === "job_prices" ? (r === "admin" || r === "office") : !!r;
  let rows = T.filter(row => st.filters.every(([k, v]) => String(row[k]) === String(v)));
  if (st.table === "profiles" && !r) rows = rows.filter(x => x.id === uid);
  if (!allowed) return st.op === "select" ? { data: [], error: null } : { data: null, error: { message: "permission denied" } };
  let out = rows; let changed = false;
  if (st.op === "insert") { const row = Object.assign({ id: "j" + (seq++) }, st.row, { created_at: now(), updated_at: now(), created_by: uid, updated_by: uid }); T.push(row); out = [row]; changed = true; }
  if (st.op === "upsert") { const k = pk[st.table]; let ex = T.find(x => x[k] === st.row[k]); if (ex) Object.assign(ex, st.row, { updated_at: now(), updated_by: uid }); else { ex = Object.assign({}, st.row, { updated_at: now(), updated_by: uid }); T.push(ex); } out = [ex]; changed = true; }
  if (st.op === "update") { if (st.table === "profiles" && r !== "admin") { delete st.row.role; delete st.row.active; } rows.forEach(x => Object.assign(x, st.row, st.table === "profiles" ? {} : { updated_at: now(), updated_by: uid })); changed = rows.length > 0; }
  if (st.op === "delete") { for (const x of rows) T.splice(T.indexOf(x), 1); if (st.table === "jobs") for (const x of rows) db.job_prices = db.job_prices.filter(p => p.job_id !== x.id); changed = true; }
  if (changed && st.table !== "profiles") setTimeout(() => pages.forEach(p => p.evaluate(() => window.__rt && window.__rt()).catch(() => { })), 50);
  const data = JSON.parse(JSON.stringify(out));
  return { data: st.single ? (data[0] || null) : data, error: null };
}
const b = await chromium.launch();
async function open(name) {
  const ctx = await b.newContext({ viewport: { width: 1450, height: 900 } });
  await ctx.route('**/index.html', async r => { const res = await r.fetch(); const body = (await res.text()).replace(/ integrity="[^"]+"/, ''); r.fulfill({ response: res, body }); });
  await ctx.route('**/vendor/supabase-2.117.2.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: fake }));
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 503, body: '' }));
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
const txt = await M.evaluate(() => document.body.innerText); log('depot price field hidden:', await M.isHidden('#f_price'), '| price value:', JSON.stringify(await M.inputValue('#f_price')), '| price on screen:', txt.includes('350'));
await M.click('#jobForm [data-close]');
// export as admin
await G.click('nav [data-view=projects]'); const [dl] = await Promise.all([G.waitForEvent('download'), G.click('#exportProj')]); await dl.saveAs(new URL('./out.xlsx', import.meta.url).pathname);
await G.screenshot({ path: new URL('./g-projects.png', import.meta.url).pathname }); await G.click('nav [data-view=week]'); await G.screenshot({ path: new URL('./g-week.png', import.meta.url).pathname });
// delete
await G.locator('#sideList .card').first().click(); await G.click('#btnDelete'); await G.waitForTimeout(500);
log('deleted, jobs:', db.jobs.length, 'prices:', db.job_prices.length);
// sign out
await G.click('#btnMenu'); await G.click('[data-act=signout]'); await G.waitForTimeout(300); log('after sign out gate visible:', await G.isVisible('#gate'));
for (const [n, p] of [['G', G], ['M', M], ['N', N]]) log(n, 'errors:', p._errs);
await b.close();
