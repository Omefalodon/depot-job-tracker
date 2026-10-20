# Depot Job Tracker

A job tracker for HCT's depot: loading and transferring cargo between containers and trucks.
Up to 5 office users share one list of jobs, live.

- **App:** `index.html` (one page, plain HTML + JavaScript, no build step), served by GitHub Pages.
- **Data:** Supabase project `depot-job-tracker` (Frankfurt). The page only shows the data; every
  rule about who may read or change what is enforced by the database (Row Level Security).
- **Library:** `vendor/supabase-2.117.2.js` (supabase-js, copied into the repo and pinned with a
  Subresource Integrity hash, so nothing is loaded from a CDN).
- **Weather:** Open-Meteo, free, no key. Only the depot's coordinates are sent.

## Is it safe for this repo to be public?
Yes. The page contains the Supabase address and its **publishable** key, which are meant to be
public. They let a browser *ask*; the database decides. Without a login that an admin has switched
on, the database returns nothing (see `tests/rls-tests.sql`). No passwords, secret keys or job
data are in this repo. **Never commit the `service_role` / secret key.**

## Roles
| Role | Jobs, notes | Prices | Users screen |
|---|---|---|---|
| admin | read / write | read / write | yes |
| office | read / write | read / write | no |
| depot (future) | read / write | **hidden** | no |
| not approved yet | nothing | nothing | no |

New logins are created in the Supabase dashboard (Authentication › Users › Add user) and start
switched off; an admin switches them on in the app's **Users** screen.

## Database changes
Every change is a file in `supabase/migrations/` (applied in name order). Each job change is also
recorded in `job_history` by a trigger, so the editor can show who changed what.

## Tests
- **Self-test in the page:** ⋯ › Run self-test (logic: container check digit, dates, Excel writer…).
- **Database rules:** paste `tests/rls-tests.sql` into the Supabase SQL editor; every row must say
  `ok = true` (21 checks; nothing is left behind).
- **UI with two users:** `tests/ui/run.mjs` drives the page in Chromium with a stand-in for
  Supabase (`tests/ui/fake-supabase.js`): login, live updates between two users, edit conflicts,
  day notes, drag & drop, approving a user, hiding prices, Excel export, delete, sign out.
  ```
  npm i playwright          # once
  python3 -m http.server 8765 &
  node tests/ui/run.mjs http://127.0.0.1:8765/index.html
  ```
