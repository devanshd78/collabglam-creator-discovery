-- Add fields already used by the application but missing from deployed migrations.
-- IF NOT EXISTS also supports local databases previously updated with prisma db push.
-- Existing accounts and briefs retain their data; new fields start unassigned/unset.
BEGIN;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "youtubeApiKeyId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_youtubeApiKeyId_key" ON "User"("youtubeApiKeyId");

ALTER TABLE "BrandBrief" ADD COLUMN IF NOT EXISTS "deadlineAt" TIMESTAMP(3);

COMMIT;
