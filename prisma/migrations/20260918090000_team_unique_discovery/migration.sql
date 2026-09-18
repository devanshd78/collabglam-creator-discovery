-- Reserve creators when they are first returned by discovery so later team searches
-- do not surface the same channel to another member.
CREATE TABLE "DiscoveryAssignment" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "briefId" TEXT,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscoveryAssignment_channelId_key" ON "DiscoveryAssignment"("channelId");
CREATE INDEX "DiscoveryAssignment_userId_createdAt_idx" ON "DiscoveryAssignment"("userId", "createdAt");
CREATE INDEX "DiscoveryAssignment_briefId_idx" ON "DiscoveryAssignment"("briefId");
CREATE INDEX "DiscoveryAssignment_runId_idx" ON "DiscoveryAssignment"("runId");

ALTER TABLE "DiscoveryAssignment" ADD CONSTRAINT "DiscoveryAssignment_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiscoveryAssignment" ADD CONSTRAINT "DiscoveryAssignment_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "SearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveryAssignment" ADD CONSTRAINT "DiscoveryAssignment_briefId_fkey"
FOREIGN KEY ("briefId") REFERENCES "BrandBrief"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve uniqueness for existing installations too: reserve channels that were already returned
-- by historical SearchRun JSON, assigning each channel to the earliest run that surfaced it.
WITH historical AS (
    SELECT
        sr."id" AS "runId",
        sr."userId" AS "userId",
        sr."briefId" AS "briefId",
        sr."kind" AS "kind",
        sr."createdAt" AS "createdAt",
        item->>'channelId' AS "channelId",
        ROW_NUMBER() OVER (
            PARTITION BY item->>'channelId'
            ORDER BY sr."createdAt" ASC, sr."id" ASC
        ) AS rn
    FROM "SearchRun" sr
    CROSS JOIN LATERAL jsonb_array_elements(sr."results") AS item
    WHERE item ? 'channelId' AND COALESCE(item->>'channelId', '') <> ''
)
INSERT INTO "DiscoveryAssignment" ("id", "channelId", "userId", "runId", "briefId", "kind", "createdAt")
SELECT
    'backfill_' || md5("runId" || ':' || "channelId"),
    "channelId",
    "userId",
    "runId",
    "briefId",
    "kind",
    "createdAt"
FROM historical
WHERE rn = 1
ON CONFLICT ("channelId") DO NOTHING;
