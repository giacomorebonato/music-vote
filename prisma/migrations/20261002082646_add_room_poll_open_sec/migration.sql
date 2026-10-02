-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "stateDoc" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Room_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Room" ("bpm", "createdAt", "currentCode", "genre", "hostId", "id", "lengthSec", "pollIntervalSec", "stateDoc", "status") SELECT "bpm", "createdAt", "currentCode", "genre", "hostId", "id", "lengthSec", "pollIntervalSec", "stateDoc", "status" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
