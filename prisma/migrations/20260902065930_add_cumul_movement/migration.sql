-- CreateTable
CREATE TABLE "public"."cumul_movements" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "montant" BIGINT NOT NULL,
    "commentaire" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cumul_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cumul_movements_createdAt_idx" ON "public"."cumul_movements"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."cumul_movements" ADD CONSTRAINT "cumul_movement_created_by_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
