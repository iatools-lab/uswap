-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "swapperId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_swapperId_fkey" FOREIGN KEY ("swapperId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
