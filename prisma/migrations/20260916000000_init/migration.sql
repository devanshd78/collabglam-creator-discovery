-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandBrief" (
    "id" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "website" TEXT,
    "market" TEXT,
    "minSubscribers" INTEGER,
    "maxSubscribers" INTEGER,
    "targetCreators" INTEGER,
    "notes" TEXT,
    "briefDate" DATE NOT NULL,
    "status" "BriefStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "briefId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channelUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "country" TEXT,
    "subscriberCount" INTEGER NOT NULL DEFAULT 0,
    "averageViews" INTEGER,
    "medianViews" INTEGER,
    "engagementRate" DOUBLE PRECISION,
    "email" TEXT,
    "emailSource" TEXT,
    "emailSourceUrl" TEXT,
    "otherEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "platformLinks" JSONB NOT NULL DEFAULT '{}',
    "websiteLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mainContent" TEXT,
    "matchScore" INTEGER,
    "tier" TEXT,
    "relevantVideos" INTEGER,
    "analyzedVideos" INTEGER,
    "lastUploadAt" TIMESTAMP(3),
    "whyFit" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "concerns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceTitle" TEXT,
    "evidenceUrl" TEXT,
    "foundVia" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL,
    "claimedById" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "briefId" TEXT,
    "runId" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "briefId" TEXT,
    "kind" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "emailsFound" INTEGER NOT NULL DEFAULT 0,
    "hiddenAsClaimed" INTEGER NOT NULL DEFAULT 0,
    "unitsUsed" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YoutubeApiUsage" (
    "date" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "YoutubeApiUsage_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "BrandBrief_briefDate_idx" ON "BrandBrief"("briefDate");

-- CreateIndex
CREATE INDEX "CreatorList_ownerId_idx" ON "CreatorList"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_channelId_key" ON "Creator"("channelId");

-- CreateIndex
CREATE INDEX "Creator_claimedById_claimedAt_idx" ON "Creator"("claimedById", "claimedAt");

-- CreateIndex
CREATE INDEX "Creator_listId_idx" ON "Creator"("listId");

-- CreateIndex
CREATE INDEX "Creator_briefId_idx" ON "Creator"("briefId");

-- CreateIndex
CREATE INDEX "SearchRun_userId_createdAt_idx" ON "SearchRun"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "BrandBrief" ADD CONSTRAINT "BrandBrief_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorList" ADD CONSTRAINT "CreatorList_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorList" ADD CONSTRAINT "CreatorList_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "BrandBrief"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_listId_fkey" FOREIGN KEY ("listId") REFERENCES "CreatorList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "BrandBrief"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRun" ADD CONSTRAINT "SearchRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRun" ADD CONSTRAINT "SearchRun_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "BrandBrief"("id") ON DELETE SET NULL ON UPDATE CASCADE;

