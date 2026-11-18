-- CreateEnum
CREATE TYPE "IncidentSource" AS ENUM ('SENTRY', 'CI', 'MANUAL');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "Developer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "slackUserId" TEXT,
    "email" TEXT,
    "hiredAt" TIMESTAMP(3) NOT NULL,
    "fatigueLevel" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Developer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "source" "IncidentSource" NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "repository" TEXT,
    "commitSha" TEXT,
    "url" TEXT,
    "originalAuthor" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blame" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "scapegoatId" TEXT NOT NULL,
    "alibi" TEXT NOT NULL,
    "probability" DOUBLE PRECISION,
    "aiFallback" BOOLEAN NOT NULL DEFAULT false,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Blame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Developer_handle_key" ON "Developer"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Developer_slackUserId_key" ON "Developer"("slackUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Developer_email_key" ON "Developer"("email");

-- CreateIndex
CREATE INDEX "Incident_createdAt_idx" ON "Incident"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_source_externalId_key" ON "Incident"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Blame_incidentId_key" ON "Blame"("incidentId");

-- CreateIndex
CREATE INDEX "Blame_scapegoatId_idx" ON "Blame"("scapegoatId");

-- CreateIndex
CREATE INDEX "Blame_createdAt_idx" ON "Blame"("createdAt");

-- AddForeignKey
ALTER TABLE "Blame" ADD CONSTRAINT "Blame_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blame" ADD CONSTRAINT "Blame_scapegoatId_fkey" FOREIGN KEY ("scapegoatId") REFERENCES "Developer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
