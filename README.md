# CertiFlow

Certificate platform for the (fictional) Pragati Skills Mission.

Training centres upload passed batches. District officers, the quality team and the state office approve them. Every candidate then gets a PDF certificate with a QR code on WhatsApp. Anyone can check a certificate is genuine without logging in.

**Stack:** React + Vite, Node.js + Express + TypeScript, PostgreSQL + Prisma, Redis + BullMQ, Docker Compose.

---

## 1. Requirements note

The brief left some things open. These are my decisions and why.

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | "More than one officer" at district | **2 different district officers** must approve | Simplest meaning of "more than one" |
| 2 | "Big batches need extra scrutiny" | **50 or more** candidates also need the **quality team** (1 approval) | Needed a number; it is a setting |
| 3 | What happens to approvals when a batch is sent back and resent? | The resend is a **new version** and starts again at district. Old approvals stay in history but **do not count** | The candidate list changed, so old approvals were for different data |
| 4 | Reject or send back | **One officer is enough**, with a written reason. Reject is final. Send back lets the centre fix it | Approving needs agreement; stopping a problem should be easy |
| 5 | "Files sitting with an officer for days" | After 24 hours at one step the batch is **escalated once**: flagged, audited, shown in the state office "Stuck" list | Someone senior finds out without chasing |
| 6 | Spreadsheet format | Columns `Name, Phone, Course, Score`. Phone is a 10 digit Indian mobile. Score 0-100 and at least 40 | Needed rules to validate against |
| 7 | Who sees what | Officers see only **their district**. Quality and state see all submitted batches. A centre sees only its own. Drafts are private | Nobody sees someone else's data |
| 8 | Candidates never log in | WhatsApp message has a link with a **secret token** to download the PDF. Public verify shows only a **masked name**, course, district, status | Check without leaking personal data |
| 9 | "Changes without refreshing" | The page **polls every 4 seconds** | Simple and reliable (see limitations) |
| 10 | Cancelling | Only the state office. The next verify says **NOT VALID**. Not delivered, not downloadable | Verify reads the database directly, no cache |
| 11 | Same person in two batches | **One valid certificate per person per course**, across all batches. A different course is allowed. A cancelled certificate frees the person | Avoids duplicate certificates and messages |
| 12 | WhatsApp keeps failing | After 6 tries (growing delay) the certificate is marked **FAILED** and the state office can press **Retry** | Nothing fails silently |
| 13 | Too many requests | Per IP per minute: login 20, public 120, logged-in API 600 | Slows password guessing and floods |

Roles: `CENTRE`, `DISTRICT_OFFICER`, `QUALITY`, `STATE`. Candidates and employers have no account.

---

## 2. Run it

Needs Docker with Compose.

```bash
cd certiflow
docker compose up --build
```

Open **http://localhost:8080**. Ports used: 8080 (UI), 4000 (API), 5433 (Postgres), 6379 (Redis).

**Demo users** (password for all: `password123`; the login page has a drop-down):

| Person | Role | District |
|---|---|---|
| Anika, Rohan | Training centre | North, South |
| Dev, Meera, Kabir | District officers | North |
| Ishaan | District officer | South |
| Neha | Quality team | |
| Farah | State office | |

**Your spreadsheet (.xlsx)**

The system starts empty: there is no sample data. Use your own Excel file. The first row must be these column names, one candidate per row:

| Name | Phone | Course | Score |
|---|---|---|---|
| Asha Sharma | 9876543210 | Electrician | 72 |

* Phone: 10 digit Indian mobile number (`+91` is accepted and removed).
* Score: 0 to 100, at least 40 (the pass mark).
* The same phone cannot repeat in one sheet. A person who already holds a valid certificate for the same course, or is already in another batch under review, is rejected with the exact row.

**Try it in 5 minutes**

1. Log in as **Anika**, create a batch, upload your Excel file. If a row is wrong you see the exact rows and nothing is saved.
2. Click **Send for approval**.
3. **Dev** approves, **Meera** approves. If the batch has 50 or more people it moves to quality: **Neha** approves. Then **Farah** approves.
4. The worker creates the certificates and sends WhatsApp messages. Some fail and retry; watch the WhatsApp column.
5. As **Farah**, open **State tools** to see the fake WhatsApp inbox and the audit log.
6. Open **Verify a certificate** (top bar, no login), type a certificate number: genuine. Cancel it as Farah and check again: not valid.

Uploading the same people again for the same course after their batch is approved is refused on purpose (one valid certificate per person per course). Use different people or a different course, or cancel their certificates first.

To start fresh: `docker compose down -v`.

**Scanning the QR code from a phone.** A QR containing `localhost` cannot open on a phone. Start with the helper script so the QR uses your computer's network address, and keep the phone on the same Wi-Fi:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-lan.ps1     # Windows
```
```bash
sh start-lan.sh                                              # macOS / Linux
```

If the phone still cannot open it, allow port 8080 in the firewall, or just type the certificate number on the **Verify** page.

**Run the tests** (76 tests):

```bash
docker compose up -d postgres redis
cd backend
npm install
npx prisma generate
npm test
```

Tests use their own schema, so demo data is safe. Four tests use a real Redis (skipped with a warning if Redis is not running).

Settings you can change are in `.env.example`.

---

## 3. How it works

```
Browser --> nginx --> API (Express) --> PostgreSQL   all data, history, audit
                          |
                          +--> Redis (BullMQ) <-- Worker
                                                   issue certificates, send WhatsApp,
                                                   every minute: escalate + sweep
```

* **API** does quick work only. Slow work is put on a queue.
* **Worker** is the same code in a second container. Run more copies to scale.
* **PostgreSQL** is the single source of truth. Redis only holds jobs.

```
backend/prisma/schema.prisma      tables and unique constraints
backend/src/services/             the rules (approvals, certificates, delivery, escalation, duplicates)
backend/src/routes/               thin HTTP layer
backend/src/jobs/                 worker jobs and the sweeper
backend/src/providers/            fake WhatsApp
backend/tests/                    automated tests
frontend/src/                     React pages
```

### Key decisions

1. **Approvals use a row lock.** `decide()` runs in one transaction that starts with `SELECT ... FOR UPDATE` on the batch. Two officers at the same moment run one after the other, so the batch moves forward once. A unique key on (batch, version, step, officer) is the backup.
2. **Everything can safely run twice.** A certificate is unique per candidate, certificate numbers are unique, queue jobs have fixed ids, and every WhatsApp send carries the certificate id as an idempotency key. A retry of a message that already got through is ignored.
3. **The sweeper.** If the API crashes after saving but before queueing, or Redis loses its data, a job could be lost. Every minute the worker finds approved batches without certificates and old pending certificates in the database and queues them again.
4. **One certificate per person per course.** Checked at upload and again at submit, with a database index as the final guard.
5. **Audit rows are written in the same transaction as the change.** A change and its record exist together or not at all.
6. **Security.** The user's role is read from the database on every request, not from the token. Every query is scoped by role. Inputs are validated, uploads are limited, download tokens are random and compared in constant time.
7. **BullMQ over a broker like RabbitMQ.** One less service, and a job queue is all this project needs.

---

## 4. Tests

| File | Proves |
|---|---|
| `upload.test.ts` | Bad rows are reported exactly and nothing is half-saved |
| `approval.test.ts` | Simultaneous approvals move once; send back and resubmit; wrong person refused |
| `certificate.test.ts` | One message per candidate with flaky WhatsApp; cancel then verify; no data leaks |
| `escalation.test.ts` | Stuck batch escalated once and visible to the state office |
| `security.test.ts` | Forged tokens, roles, data scoping, bad input |
| `duplicates.test.ts` | One certificate per person per course across batches |
| `sweeper.test.ts` | Lost jobs are queued again |
| `deliveryFailure.test.ts` | FAILED after the last try, and Retry |
| `rateLimit.test.ts` | Too many requests get 429 |
| `queue.integration.test.ts` | Real BullMQ and Redis, end to end |
| `staffPdf.test.ts`, `qrAddress.test.ts` | PDF access rules and the QR address |

---

## 5. Known limitations

* **Polling every 4 seconds**, not live push. Server-sent events would be next.
* **Escalation only flags.** Nobody is emailed or messaged.
* **PDFs are made on demand**, not stored. The WhatsApp message carries a link, not the file.
* **The WhatsApp provider is a fake** inside the same system. A real one needs webhooks.
* **One shared demo password.** No password reset or user management screen.
* **Rate limits are counted in memory** per API instance.
* **No pagination** on lists.
* **Two batches of the same person submitted at nearly the same moment:** the database still blocks the second certificate and writes an audit row, but the second centre is not told at submit time.
* **Runs with `tsx`** (no compile step). No frontend tests. No load test.

Production plan (architecture, scaling for results day, failure handling, storage, monitoring, cost): [DEPLOYMENT.md](DEPLOYMENT.md).
