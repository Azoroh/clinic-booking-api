# Clinic Booking API

A booking API for a clinic, plus a small web page that uses it. Patients see the open appointment slots, book one, and get a confirmation. Built for Task 1 of the Koya Cohort 4 assessment, covering all five levels.

## Live links

|               |                                                |
| ------------- | ---------------------------------------------- |
| API base URL  | `https://clinic-booking-api-a9sj.onrender.com` |
| Web page      | `https://clinic-booking-api-red.vercel.app/`   |
| Spec followed | koyaacademy.com/assessment-api                 |

The API key is shared through the assessment form and is not committed to this repo.

The API runs on a free Render instance, which sleeps after about 15 minutes without traffic. The first request after a quiet spell can take up to a minute. An uptime monitor pings `GET /health/db` every 5 minutes. That keeps the instance awake and gives the Supabase project regular activity so it does not pause. `GET /health` is the same check without the database query.

## Stack

- **API:** Node, Express 5, TypeScript
- **Database:** Postgres on Supabase
- **Web page:** React, Vite, TypeScript, plain CSS
- **Hosting:** Render (API), Vercel (web page)

## Levels at a glance

| Level | What it covers                          | How                                                                                        |
| ----- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1     | List slots, book one, look up a booking | `available` is calculated from bookings, never stored                                      |
| 2     | API key and validation                  | Middleware checks `X-API-Key`; input is trimmed and the email lowercased before validation |
| 3     | No double booking, cancellation         | A unique index in Postgres decides the winner; `DELETE /bookings/{id}` frees the slot      |
| 4     | Safe retries and paging                 | `Idempotency-Key` is stored with the booking; cursor pagination on a counter               |
| 5     | Spam protection                         | 5 attempts per email per minute, then `429` with `Retry-After`                             |

## Endpoints

| Method | Path               | Level  | Success | Errors                       |
| ------ | ------------------ | ------ | ------- | ---------------------------- |
| POST   | `/reset`           | 1      | 200     | 401                          |
| GET    | `/slots`           | 1      | 200     | 401                          |
| POST   | `/bookings`        | 1 to 5 | 201     | 400, 401, 404, 409, 422, 429 |
| GET    | `/bookings/{id}`   | 1      | 200     | 401, 404                     |
| GET    | `/bookings?email=` | 4      | 200     | 400, 401                     |
| DELETE | `/bookings/{id}`   | 3      | 200     | 401, 404, 409                |
| GET    | `/health`          | n/a    | 200     | none, no key needed          |
| GET    | `/health/db`       | n/a    | 200     | 503, no key needed           |

Every error response has the shape `{"error": "<message>"}`.

### How POST /bookings decides

The checks run in this order, and the first failure wins:

1. **API key:** missing or wrong gives 401.
2. **Rate limit** for the email (only when the request has an email to count against): over the limit gives 429.
3. **Body:** missing, empty or non-string fields, or an invalid email, gives 400.
4. **Idempotency key:** if the key was seen before, return the original booking (same body) or 422 (different body).
5. **Slot exists:** otherwise 404.
6. **Slot has not started:** otherwise 400.
7. **Insert:** if the slot already has a confirmed booking, 409.

The rate limit sits above validation because failed attempts count toward it. The idempotency lookup sits above the slot checks so a retry still gets its original answer even if the slot has started in the meantime.

## Design decisions

### No double booking

The database decides, not application code. The handler checks that the slot exists and then inserts, but two requests can pass that check at the same moment. A partial unique index on `bookings (slot_id) where status = 'confirmed'` makes the second insert fail, and the API turns that failure (Postgres error `23505`) into a 409. Cancelling sets the status to `cancelled`, which takes the booking out of the index and frees the slot.

`test/concurrency.mjs` fires 10 simultaneous requests at one slot. The result is always exactly one `201` and nine `409`.

### Retries

The `Idempotency-Key` is stored on the booking row and has its own unique index.

- Same key, same body: the original booking comes back with the same status code and id.
- Same key, different body: 422.
- Two identical requests at the same instant: one insert wins. The loser's duplicate-key error is caught, the winner's row is looked up by key, and both callers get the same booking.
- Only successful bookings store a key. A request that failed with a 400, 404 or 409 is not remembered, so retrying it with the same key runs it again.
- A replay returns the booking as it is now, so a booking cancelled in between replays with status `cancelled`.

Keys are global, not scoped to an email.

### Pagination

`GET /bookings` pages with a cursor on a database-generated `seq` counter. The API fetches `limit + 1` rows. If the extra row exists there is another page, and `next_cursor` is the `seq` of the last row returned. Otherwise `next_cursor` is `null`.

A counter is used instead of `created_at` because timestamps can tie, and their format includes a `+` that gets mangled in query strings.

Email matching ignores case because emails are trimmed and lowercased on the way in and on lookup, so plain equality works. `ilike` was avoided on purpose: `%` and `_` act as wildcards there, so a crafted email could list other people's bookings.

### Rate limiting

A sliding window per email: at most 5 attempts in any 60 seconds.

- Attempts are counted before validation, so failed requests and replays count too.
- The 6th attempt gets `429` with `Retry-After` set to the whole seconds until the oldest counted attempt leaves the window. Blocked attempts are not counted, so they do not extend the wait.
- The bucket key is the trimmed, lowercased email. `ADA@x.com` and `ada@x.com` share a bucket, and other emails are unaffected.
- Only `POST /bookings` is limited. `POST /reset` clears the counters.

### Dates

Slots are stored as `timestamptz` and returned as ISO 8601 UTC, like `2026-12-10T09:00:00Z`. The web page converts them to the visitor's local time.

### Availability

`available` on a slot is true when it has no confirmed booking. Because it is derived rather than stored, cancelling a booking frees the slot with no extra code.

## Assumptions

Places where the spec was silent or inconsistent, and what was decided:

- **Replays count toward the rate limit.** The spec says failed attempts count, and says nothing about replays.
- **Error text is free-form.** Every example error body in the spec reads "slot not found", even under 422 and 429, so it looks like placeholder text. Only status codes and the `{"error": string}` shape are treated as the contract.
- **Cancel response.** The `DELETE` example shows `"status": "confirmed"`, but the description says it sets `cancelled`. The description was followed, so the response shows `cancelled`.
- **Past slots.** `/reset` accepts them and `GET /slots` returns them ("every slot"). Booking one returns 400. The web page hides them.
- **Whitespace.** Name and email are trimmed. A name of only spaces counts as empty (400).
- **Cancelled bookings** still appear in `GET /bookings`, with status `cancelled`.
- **Reset** deletes bookings, replaces slots, and clears the rate-limit counters. Idempotency keys live on booking rows, so they go with the bookings.

## Known limitations

- **Rate-limit counters live in memory.** They reset when the server restarts and are not shared between instances. That is fine for one instance. Several instances would need a shared store such as Redis or a table.
- **`/reset` is not atomic.** It runs three separate queries, so a failure partway leaves partial state. It is safe to re-run. A Postgres function called through `rpc()` would make it a single transaction.
- **Cancel is a read followed by an update.** Two simultaneous cancels could both report success. A single `update ... where status = 'confirmed'` that checks how many rows changed would close that gap.
- **The API key ships inside the web bundle.** Anyone can read it in browser devtools. That is acceptable here because the key is part of the assessment. A real product would route calls through a server-side proxy or use per-user authentication.
- **CORS is open to all origins.** In production it would be limited to the web page's origin.
- **Cold starts** on the free hosting tier, as described above.
- **Testing is manual.** There are curl request bodies and one concurrency script, but no automated test suite.

## Web page

React with Vite and TypeScript, styled with one plain CSS file. It has three screens: the slot list, the booking form, and the confirmation. All API calls go through `web/src/api.ts`, which turns each response into something the UI can react to.

| Response                 | What the page does                                                              |
| ------------------------ | ------------------------------------------------------------------------------- |
| 201                      | Shows the confirmation                                                          |
| 400                      | Shows the API's message under the form, keeping what was typed                  |
| 404                      | Returns to the list with a notice and reloads the slots                         |
| 409                      | Returns to the list with a "someone just booked that slot" notice and reloads   |
| 429                      | Disables the button and counts down from `Retry-After`                          |
| Network failure or other | Shows an error message; if the list fails to load, a banner with a retry button |

Details worth knowing:

- The form uses React's `useActionState`. The submit button is disabled while a request is in flight.
- An `Idempotency-Key` is generated per distinct form body. Resubmitting unchanged values reuses the key, so a retry after a dropped connection cannot create a second booking. Editing a field produces a new key.
- Slots that have already started are hidden, and booked slots are shown greyed out.
- Times are shown in the visitor's local timezone.

## Running locally

You need Node 22 or newer and a Supabase project.

**1. Install**

```bash
npm install
cd web
npm install
```

`web/.npmrc` sets `legacy-peer-deps=true` because the Vite template's TypeScript version and `typescript-eslint`'s allowed range disagree.

**2. Create the database**

Run this in the Supabase SQL editor:

```sql
create table slots (
  id text primary key,
  provider text not null,
  start_time timestamptz not null,
  end_time timestamptz not null
);

create table bookings (
  id text primary key default gen_random_uuid()::text,
  slot_id text not null references slots (id),
  name text not null,
  email text not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  idempotency_key text unique,
  seq bigint generated always as identity
);

-- the rule that prevents double booking
create unique index unique_confirmed_booking
  on bookings (slot_id) where status = 'confirmed';

-- fast paging for GET /bookings
create index bookings_email_seq_idx on bookings (email, seq);

alter table slots enable row level security;
alter table bookings enable row level security;
```

Row-level security is on with no policies. The server uses the secret key, which bypasses it, so the public (anon) key cannot touch these tables.

**3. Set environment variables**

Root `.env`:

| Variable       | Purpose                                                         |
| -------------- | --------------------------------------------------------------- |
| `SUPABASE_URL` | Your Supabase project URL                                       |
| `SUPABASE_KEY` | The Supabase **secret** key. Server only, never in the web page |
| `API_KEY`      | The value clients must send in `X-API-Key`                      |
| `PORT`         | Optional, defaults to 3000                                      |

`web/.env`:

| Variable       | Purpose                                           |
| -------------- | ------------------------------------------------- |
| `VITE_API_URL` | Base URL of the API, e.g. `http://localhost:3000` |
| `VITE_API_KEY` | The same value as `API_KEY`                       |

**4. Start both**

```bash
# API, from the repo root
npm run dev

# web page, in a second terminal
cd web
npm run dev
```

The API listens on port 3000 and the web page on 5173.

## Trying it out

The request bodies in `test/` match the sample slots in `test/reset.json`: three future slots, one past slot, two providers.

```bash
BASE=http://localhost:3000
KEY=your-api-key

# start fresh
curl -X POST "$BASE/reset" -H "Content-Type: application/json" -H "X-API-Key: $KEY" -d @test/reset.json

# list slots
curl "$BASE/slots" -H "X-API-Key: $KEY"

# book one, with an idempotency key
curl -i -X POST "$BASE/bookings" -H "Content-Type: application/json" -H "X-API-Key: $KEY" -H "Idempotency-Key: demo-1" -d @test/booking.json

# race ten requests for one slot (run /reset first)
API_KEY=$KEY node test/concurrency.mjs
```

On Windows PowerShell, use `curl.exe` and quote the file argument as `'@test/reset.json'`.

What to expect:

| Test                                     | Result                                                           |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `test/concurrency.mjs` after a reset     | one `201`, nine `409`                                            |
| Six bookings in a row for the same email | `201`, `409`, `409`, `409`, `409`, then `429` with `Retry-After` |
| Same `Idempotency-Key` and body twice    | two `201`s with the same booking id                              |
| Same `Idempotency-Key`, different body   | `422`                                                            |
| Any request without `X-API-Key`          | `401`                                                            |

## Deployment

**API on Render** (Web Service, repo root as the root directory)

- Build command: `npm install --include=dev && npm run build`
- Start command: `npm start`
- Environment variables: `SUPABASE_URL`, `SUPABASE_KEY`, `API_KEY`, `NODE_VERSION=22`

**Web page on Vercel** (root directory set to `web`)

- Environment variables: `VITE_API_URL` (the Render URL) and `VITE_API_KEY`
- Vite bakes these in at build time, so they must be set before the build runs. Changing them later needs a redeploy.

## Project layout

```
.
├── src/
│   ├── index.ts          routes, validation, rate limiting
│   └── supabase.ts       Supabase client
├── test/
│   ├── reset.json        sample slots
│   ├── booking*.json     request bodies used with curl
│   └── concurrency.mjs   fires 10 simultaneous bookings at one slot
├── web/
│   └── src/
│       ├── api.ts        every call to the API, in one place
│       ├── App.tsx       page state and screen switching
│       ├── SlotList.tsx
│       ├── BookingForm.tsx
│       ├── Confirmation.tsx
│       └── format.ts     date formatting
├── package.json
└── tsconfig.json
```
