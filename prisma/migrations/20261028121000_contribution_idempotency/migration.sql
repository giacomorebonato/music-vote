ALTER TABLE "DirectionRevision" ADD COLUMN "requestId" TEXT;
ALTER TABLE "Moment" ADD COLUMN "requestId" TEXT;
CREATE UNIQUE INDEX "DirectionRevision_requestId_key" ON "DirectionRevision"("requestId");
CREATE UNIQUE INDEX "Moment_requestId_key" ON "Moment"("requestId");
