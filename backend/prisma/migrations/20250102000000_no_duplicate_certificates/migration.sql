-- A person (phone) can hold only ONE valid certificate per course, across all batches.
-- 1. add the columns (nullable first so existing rows can be backfilled)
ALTER TABLE "Certificate" ADD COLUMN "phone" TEXT, ADD COLUMN "course" TEXT;

UPDATE "Certificate" c
SET "phone" = ca."phone", "course" = ca."course"
FROM "Candidate" ca
WHERE ca."id" = c."candidateId";

ALTER TABLE "Certificate" ALTER COLUMN "phone" SET NOT NULL, ALTER COLUMN "course" SET NOT NULL;

-- 2. the database-level guarantee. PARTIAL: a cancelled certificate does not block a new one.
CREATE UNIQUE INDEX "Certificate_phone_course_issued_key"
  ON "Certificate" ("phone", lower("course"))  -- case-insensitive, same as the app check
  WHERE "status" = 'ISSUED';
