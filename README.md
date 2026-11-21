# CertiFlow: Pragati Skills Mission certificate platform

Training centres upload passed batches. District officers, the quality team and the state office approve them. Approved candidates get a PDF certificate (with QR code) on WhatsApp. Anyone can check a certificate without logging in.

---

## 1. Requirements note (what I understood, and what I decided)

The brief was short. These are the gaps I filled, and why.

| # | Question in the brief | My decision | Reason |
|---|---|---|---|
| D1 | "District decision needs more than one officer" | **2 different district officers** must approve (`DISTRICT_APPROVALS_REQUIRED`) | Simplest reading of "more than one" |
| D2 | "Big batches need extra scrutiny" | Batches with **50 or more** candidates also need the **quality team** (1 approval) between district and state (`QUALITY_THRESHOLD`) | Needs a number; it is configurable |
| D3 | "What happens to approvals when a batch is sent back and resent?" | The resubmission is a **new version** and **starts again at the district step**. Old approvals are kept in history but **do not count** | The candidate list changed, so earlier approvals were for different data. Counting them would let unreviewed data through |
| D4 | One officer sends back or rejects | **One officer is enough** to send back or reject (needs a written reason). **Reject is final.** **Send back** lets the centre fix it | Approving needs agreement; stopping a problem should be easy and safe |
| D5 | "Files sitting with an officer for days" | After `ESCALATION_MINUTES` (default 24h) at one step, the batch is **escalated once**: flagged, written to the audit log, and listed in the state office "Stuck" tab. Moving to the next step restarts the clock | Someone senior finds out without chasing |
| D6 | What is in the spreadsheet? | Columns `Name, Phone, Course, Score`. Phone must be a 10 digit Indian mobile (`+91` is stripped). Score 0-100 and at least the pass mark (40). No duplicate phones in the sheet | Needed something to validate against |
| D7 | Officer visibility | A district officer sees only batches of **their own district**. Quality and state see all submitted batches. Centres see only their own. Drafts are private to the centre | "A stranger must not see someone else's data" |
| D8 | Candidates never log in | The WhatsApp message contains a link with a **secret random token** to download the PDF. Verification is public but shows only a **masked name**, course, district and status (never a phone number) | Public check without leaking personal data |
| D9 | "Everyone sees changes as they happen" | The UI **polls every 4 seconds** | Simple and reliable. See limitations |
| D10 | Cancelling | Only the state office can cancel. Cancelled certificates show **NOT VALID** on the very next check, are not delivered and cannot be downloaded | Verification reads the database directly (no cache) |
| D11 | Same phone in two batches | One person gets **one valid certificate per course**, across ALL batches. Different course is allowed. Upload and submit give row errors ("Already holds a valid Welding certificate (PRG-...)", or "Already in batch X"). A cancelled certificate frees the person. A **database index** is the hard backstop | Avoid duplicate certificates and duplicate WhatsApp messages; course matters because one person can really do two courses |
| D12 | Failed WhatsApp after all retries | After 6 attempts (exponential backoff) the certificate is marked **FAILED**, audited, and shown in the batch page. The state office can press **Retry** | Nothing fails silently, and a human decides when to try again |
| D13 | Too many requests | Per IP address, per minute: login 20, public verification 120, logged-in API 600 (env `RATE_LIMIT_*`) | Slow down password guessing and floods; generous enough for normal use |

Roles: **CENTRE**, **DISTRICT_OFFICER**, **QUALITY**, **STATE**. Candidates and employers have no account.

---

## 2. Run it

Needs Docker with Compose. Host ports used: 8080 (UI), 4000 (API), 5433 (Postgres), 6379 (Redis).

```bash
cd certiflow
docker compose up --build
```

Open **http://localhost:8080**. Demo users (password for all: `password123`):

| Person | Role | District |
|---|---|---|
| Anika | Training centre | North |
| Rohan | Training centre | South |
| Dev, Meera, Kabir | District officers | North |
| Ishaan | District officer | South |
| Neha | Quality team | n/a |
| Farah | State office | n/a |

The login page has a drop-down to switch between them quickly.

**Five minute demo script**

1. Log in as **Anika**. Create a batch. Upload `sample-data/batch_10_with_errors.xlsx`. See the exact row errors; nothing is saved.
2. Upload `sample-data/batch_60_valid_needs_quality.xlsx`. Click **Send for approval**.
3. Log in as **Dev** (approve), then **Meera** (approve). Batch moves to **quality**.
4. **Neha** approves. **Farah** approves. The worker issues 60 certificates and sends WhatsApp messages (some fail and retry; watch the delivery column).
5. As **Farah**, open **State tools** to see the fake WhatsApp inbox and audit log. Copy a certificate number, open **Verify a certificate** (no login) and see it is genuine. Cancel it, check again: not valid.
6. To see escalation fast: `ESCALATION_MINUTES=1 docker compose up -d` and leave a batch with an officer for 2 minutes.

### Scanning the QR code from a phone

`localhost` only means "this same computer", so a phone cannot open a QR that contains it. Start the stack with the helper script instead of plain `docker compose up`. It finds your computer's Wi-Fi/LAN address and stores it as `PUBLIC_URL`:

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\start-lan.ps1
```
```bash
# macOS / Linux
sh start-lan.sh
```

Then open the app and download PDFs as usual (even through `localhost`): the QR code and the printed link now contain `http://<your-LAN-IP>:8080/verify/...`. The phone must be on the **same Wi-Fi**. If the phone still cannot open it, allow port 8080 through the firewall (Windows, admin PowerShell): `New-NetFirewallRule -DisplayName CertiFlow8080 -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow`. Some guest/hotspot networks block device-to-device traffic ("client isolation"); then use the typing method below.

Rule in the code (`backend/src/http.ts`): if the app was opened through a real address, that address is used; if it was opened through `localhost`, `PUBLIC_URL` is used when it is a real address. Links inside WhatsApp messages always use `PUBLIC_URL`.

### How a reviewer verifies a certificate (three ways)

1. **No phone needed (easiest):** open **Verify a certificate** (top bar, no login), type the certificate number shown on the PDF or in the batch table, click Check.
2. **QR on the same computer:** works with plain `docker compose up` (the QR contains `localhost`), for example with a webcam or a QR tool on that computer.
3. **QR from a real phone:** start with `start-lan.ps1` / `start-lan.sh` (see above).

Staff can open any certificate PDF from the **PDF** button on the batch page.

Useful settings are in `.env.example` (copy to `.env`).

### Run the tests

The tests need Postgres. They use their own schema `certiflow_test`, so demo data is untouched. Postgres is reached on host port **5433**. Most tests mock the queue and call the worker logic directly. **4 tests use a real Redis** (`queue.integration.test.ts`, separate queue prefix, skipped with a warning if Redis is down), so start it too.

```bash
docker compose up -d postgres redis
cd backend
npm install
npx prisma generate
npm test
```

Or inside the running stack: `docker compose exec backend npm test`.

### Local development without Docker for the apps

```bash
docker compose up -d postgres redis
cd backend && npm install && npx prisma migrate deploy && npm run seed
npm run dev          # API on :4000
npm run worker       # in a second terminal
cd ../frontend && npm install && npm run dev   # UI on :5173
```

`npm run sample-data` in `backend/` regenerates the sample spreadsheets.

---

## 3. How it is put together

```
Browser (React) --/api--> nginx --> API (Express) --> PostgreSQL   (truth: all data, history, audit)
                                        |
                                        +--> Redis queue (BullMQ) <-- Worker(s)
                                                                        |-- issue certificates
                                                                        |-- send WhatsApp (fake provider)
                                                                        '-- every minute: escalate + sweep
```

* **API** (`backend/src`): login, batches, approvals, public verification. It does **only quick work**. Anything slow is handed to the queue.
* **Worker** (`src/worker.ts`): same code base, run as a separate container. Issues certificates, delivers WhatsApp messages with retries, runs the one-minute maintenance job.
* **PostgreSQL** is the single source of truth. Redis only holds *jobs*; losing Redis loses no data (see "Sweeper").
* **Frontend**: React + Vite, plain CSS, polling.

### Code map

```
backend/prisma/schema.prisma        data model + unique constraints (the safety net)
backend/prisma/migrations/          SQL migrations
backend/src/routes/                 thin HTTP layer: auth, batches, certificates (state tools), public
backend/src/services/
  batchService.ts                   create batch, upload, submit (versions)
  approvalService.ts                THE workflow: locks, stages, idempotency
  excel.ts                          parse + validate spreadsheet
  certificateService.ts             issue (idempotent), cancel, verify, PDF + QR
  deliveryService.ts                one WhatsApp attempt, timeout, mark failed
  escalationService.ts              flag stale batches
  access.ts                         who can see which batch (one function)
  audit.ts                          writes audit rows inside the same transaction
backend/src/providers/fakeWhatsapp.ts   success / fail / timeout simulation
backend/src/jobs/sweeper.ts         re-enqueue anything the DB says is unfinished
backend/src/queue.ts, worker.ts     BullMQ queues and workers
backend/tests/                      automated tests
frontend/src/                       pages: Login, Dashboard, BatchDetail, StateTools, Verify
```

### Key technical decisions and why

**1. Row lock for approvals (Moment 2).**
`decide()` runs in one transaction and starts with `SELECT ... FOR UPDATE` on the batch row. A second officer deciding at the same moment *waits* for the first to commit, then re-reads the batch and re-checks everything. So two simultaneous approvals run one after the other, and the stage advances exactly once. Backup safety nets: the `Approval` table has `UNIQUE(batchId, version, stage, officerId)`, and the "advance" step happens only when the approval count reaches the threshold inside that locked section.

**2. Idempotency everywhere (Moment 3).**
* Same officer clicking twice: the second call finds the existing approval and returns it (`duplicate: true`).
* `Certificate.candidateId` is `UNIQUE`: a candidate can never have two certificates, even if the issuing job runs twice or on two workers at the same time. Certificate numbers are `UNIQUE` too (random, with retry on the near-impossible collision).
* BullMQ `jobId` (`issue-<batch>`, `deliver-<certificate>`): adding the same job twice is ignored.
* WhatsApp: every send uses the certificate id as an **idempotency key**. The fake provider stores delivered messages under a unique key, so retrying a send that already went through (the "timeout but actually delivered" case) does not send a second message.

**3. Why the sweeper exists.**
After the approval commits, the API adds a job to Redis. If the API crashes between those two steps, or Redis loses its data, the job would be lost. So the worker runs a **sweeper** every minute: it finds `APPROVED` batches with no certificates yet, and `PENDING` certificates older than 2 minutes, and enqueues them again (harmless because of idempotency). The database is the truth; the queue is only a delivery mechanism.

**4. Retries and failure.**
Delivery jobs retry up to 6 times with exponential backoff (1s, 2s, 4s...). Each call has a 2 second timeout. After the last failure the certificate is marked `FAILED` and the state office sees a **Retry** button.

**5. Versions and history.**
Each submission stores a frozen copy of the candidate list in `BatchVersion`. `Approval` rows are never updated or deleted and carry the version number. Only approvals for the *current* version count.

**6. Audit log.**
`AuditLog` rows are written *inside the same transaction* as the change, so a change and its record exist together or not at all. Each row stores who (or "system"), what, which entity, and when.

**7. Security.**
Passwords hashed with bcrypt. JWT only carries the user id; the **role is loaded from the database on every request**, so a forged or stale token cannot raise privileges. Route role checks plus data scoping (`access.ts`). Ids must be UUIDs. All bodies validated with zod. Upload limited to 2 MB, `.xlsx` only, max 1000 rows. Rate limits on login and public endpoints. `helmet` headers. Download tokens are random 192-bit and compared in constant time. Wrong token and unknown certificate give the same 404.

**8. Verification is never cached.**
It reads the database on every call and sends `Cache-Control: no-store`, so a cancellation is visible immediately.

**9. Redis + BullMQ.**
BullMQ gives retries, backoff, delays and repeatable jobs without extra code. I chose it over a message broker like RabbitMQ because it is one less service and everything the project needs is a job queue.

**10. Kept simple on purpose.**
Express routes call services; services use Prisma. No dependency injection framework, no event bus library. The "events" are queue jobs.

### Automated tests (`backend/tests`)

| File | Proves |
|---|---|
| `upload.test.ts` | Moment 1: bad rows reported exactly, nothing half-saved, old data kept; row validation rules |
| `approval.test.ts` | Moment 2: concurrent approvals advance once; double-click; stages incl. quality; Moment 6: send back, resubmit, versions; wrong role/district refused; decisions traceable |
| `certificate.test.ts` | Moment 3: 60 candidates, flaky provider, exactly one message each; no duplicate certificates or numbers; Moment 4: cancel then verify is invalid; no data leaks; download token |
| `escalation.test.ts` | Moment 5: escalation once, audit, state-only visibility, clock restarts |
| `security.test.ts` | Auth, forged/expired tokens, role from DB, data scoping, input validation |
| `staffPdf.test.ts` | Staff PDF access rules; QR address built from the caller's host |
| `duplicates.test.ts` | D11: no second certificate for the same person and course across batches; cancel frees; database backstop |
| `sweeper.test.ts` | Lost jobs are re-queued; fresh, sent, cancelled and failed items are left alone |
| `deliveryFailure.test.ts` | FAILED only after the last attempt, audited once, state-office Retry |
| `rateLimit.test.ts` | 429 on login, public and logged-in API; normal use unaffected |
| `qrAddress.test.ts` | The QR code never contains `localhost` when a real LAN address is configured |
| `queue.integration.test.ts` | REAL BullMQ + Redis: end to end delivery with flaky WhatsApp, repeated jobs, FAILED then Retry, sweeper rescue |

**76 tests, all passing.**

Production plan (architecture, scaling for results day, failure handling, storage, monitoring, cost): [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## 4. Known limitations (honest list)

* **Live updates use polling** (4 seconds), not WebSockets/SSE. Fine for this scale; next step would be Server-Sent Events fed by Redis pub/sub.
* **Escalation only flags and lists.** It does not email or message anyone; there is no notification channel.
* **Certificate PDFs are rendered on demand**, not stored. At 30,000 per hour that would need caching in object storage (S3) with signed URLs. Also the WhatsApp message carries a link, not the PDF attachment.
* **Fake WhatsApp provider lives in the same process and database.** A real provider needs webhooks for delivery receipts.
* **One shared demo password**, no password reset, no MFA, no account management UI. Users are seeded.
* **Two batches with the same person submitted at nearly the same moment:** the submit-time check cannot see an uncommitted batch. The database index still refuses the second certificate and an audit row `CERTIFICATE_SKIPPED_DUPLICATE` is written, but the second centre only finds out from the audit log.
* **Rate limits are counted in memory per API instance.** With several API containers each counts separately. A Redis-backed store would fix it.
* **No pagination** on lists (batches, candidates). Candidate lists are capped by the 1000 row limit.
* **Approval requirement is global**, not configurable per district.
* **Backend runs with `tsx`** (no compile step) for simplicity. A production image should compile to JavaScript.
* **Frontend has no automated tests.** Backend tests cover the rules. Two worker containers at once are safe by design (idempotency + unique constraints) but the tests start only one set of workers.
* **Not tested at load.** Row locking is per batch, so different batches never block each other, but I did not run a load test.
