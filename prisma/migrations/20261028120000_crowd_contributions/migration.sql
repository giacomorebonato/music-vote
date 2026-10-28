-- AlterTable
ALTER TABLE "Poll" ADD COLUMN "catalogVersion" INTEGER;
ALTER TABLE "Poll" ADD COLUMN "context" JSONB;
ALTER TABLE "Poll" ADD COLUMN "dimensionKey" TEXT;

-- AlterTable
ALTER TABLE "PatternVersion" ADD COLUMN "context" JSONB;

-- CreateTable
CREATE TABLE "Direction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "interpretation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "outcome" TEXT NOT NULL DEFAULT 'received',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Direction_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DirectionRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "directionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "interpretation" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DirectionRevision_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Direction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "use" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "reason" TEXT,
    "trimStart" REAL NOT NULL DEFAULT 0,
    "trimEnd" REAL NOT NULL DEFAULT 3,
    "duration" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" DATETIME,
    "expiresAt" DATETIME,
    CONSTRAINT "Recording_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Moment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" DATETIME,
    CONSTRAINT "Moment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Additive room columns preserve all existing rows and relationships.
ALTER TABLE "Room" ADD COLUMN "textEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Room" ADD COLUMN "recordingsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Room" ADD COLUMN "momentsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Room" ADD COLUMN "sampleApproval" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Room" ADD COLUMN "lastMomentAt" DATETIME;
ALTER TABLE "Room" ADD COLUMN "endedAt" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "Direction_roomId_sessionToken_key" ON "Direction"("roomId", "sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "DirectionRevision_directionId_revision_key" ON "DirectionRevision"("directionId", "revision");

-- CreateIndex
CREATE INDEX "Recording_roomId_status_createdAt_idx" ON "Recording"("roomId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recording_roomId_sessionToken_requestId_key" ON "Recording"("roomId", "sessionToken", "requestId");

-- CreateIndex
CREATE INDEX "Moment_roomId_status_createdAt_idx" ON "Moment"("roomId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Poll_roomId_dimensionKey_key" ON "Poll"("roomId", "dimensionKey");

