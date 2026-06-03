CREATE TABLE "AttendanceDeviceLock" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "employeeId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScanAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDeviceLock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendanceDeviceLock_deviceId_date_key" ON "AttendanceDeviceLock"("deviceId", "date");
CREATE INDEX "AttendanceDeviceLock_employeeId_idx" ON "AttendanceDeviceLock"("employeeId");
CREATE INDEX "AttendanceDeviceLock_date_idx" ON "AttendanceDeviceLock"("date");

ALTER TABLE "AttendanceDeviceLock" ADD CONSTRAINT "AttendanceDeviceLock_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
