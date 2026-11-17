/*
  Warnings:

  - You are about to alter the column `stateDoc` on the `PatternVersion` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PatternVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "stateDoc" JSONB,
    "source" TEXT NOT NULL,
    "context" JSONB,
    "baseVersionId" TEXT,
    "status" TEXT NOT NULL,
    "appliedAt" DATETIME,
    CONSTRAINT "PatternVersion_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PatternVersion" ("appliedAt", "baseVersionId", "code", "context", "id", "roomId", "source", "stateDoc", "status") SELECT "appliedAt", "baseVersionId", "code", "context", "id", "roomId", "source", "stateDoc", "status" FROM "PatternVersion";
DROP TABLE "PatternVersion";
ALTER TABLE "new_PatternVersion" RENAME TO "PatternVersion";
CREATE TABLE "new_Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT NOT NULL,
    "bpm" INTEGER NOT NULL,
    "lengthSec" INTEGER NOT NULL,
    "pollIntervalSec" INTEGER NOT NULL,
    "pollOpenSec" INTEGER NOT NULL DEFAULT 45,
    "genre" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentCode" TEXT,
    "currentVersionId" TEXT,
    "grooveLocked" BOOLEAN NOT NULL DEFAULT false,
    "stateDoc" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "textEnabled" BOOLEAN NOT NULL DEFAULT true,
    "recordingsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "momentsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sampleApproval" BOOLEAN NOT NULL DEFAULT true,
    "endedAt" DATETIME,
    "lastMomentAt" DATETIME,
    CONSTRAINT "Room_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Room" ("bpm", "createdAt", "currentCode", "currentVersionId", "endedAt", "genre", "grooveLocked", "hostId", "id", "lastMomentAt", "lengthSec", "momentsEnabled", "pollIntervalSec", "pollOpenSec", "recordingsEnabled", "sampleApproval", "startedAt", "stateDoc", "status", "textEnabled") SELECT "bpm", "createdAt", "currentCode", "currentVersionId", "endedAt", "genre", "grooveLocked", "hostId", "id", "lastMomentAt", "lengthSec", "momentsEnabled", "pollIntervalSec", "pollOpenSec", "recordingsEnabled", "sampleApproval", "startedAt", "stateDoc", "status", "textEnabled" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
-- Existing rooms were created under the accidental false default; flip them.
UPDATE "Room" SET "recordingsEnabled" = 1;
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
