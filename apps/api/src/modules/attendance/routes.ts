import { createHash, randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { Hono } from "hono";
import QRCode from "qrcode";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, hasPermission, writeAudit } from "../../lib/auth";
import { auditCreateData, auditUpdateData } from "../../lib/audit-meta";
import { AttendanceStatus } from "../../generated/prisma/enums";

export const attendanceRoute = new Hono();

const periodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  name: z.string().trim().optional().nullable(),
  workdays: z
    .array(
      z.object({
        date: z.string().min(1),
        isWorkday: z.boolean().default(true),
        isHalfDay: z.boolean().default(false),
        description: z.string().trim().max(300).optional().nullable()
      })
    )
    .optional()
});

const scanSchema = z.object({
  token: z.string().min(10),
  employeeId: z.string().trim().optional().nullable(),
  employeeCode: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable()
});

const scanIntentSchema = z.enum(["CHECK_IN", "CHECK_OUT"]).optional();

const scanAuthSchema = z.object({
  token: z.string().min(10),
  intent: scanIntentSchema,
  deviceId: z.string().trim().min(8).max(120)
});

const workdayUpdateSchema = z.object({
  isWorkday: z.boolean().optional(),
  isHalfDay: z.boolean().optional(),
  description: z.string().trim().max(300).optional().nullable()
});

function isLocalHostname(hostname: string) {
  return ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(hostname);
}

function getLanIPv4() {
  const nets = networkInterfaces();
  const preferredPrefixes = ["192.168.", "10.", "172."];
  const candidates: string[] = [];

  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        candidates.push(entry.address);
      }
    }
  }

  return (
    candidates.find((address) =>
      preferredPrefixes.some((prefix) => address.startsWith(prefix)),
    ) ||
    candidates[0] ||
    null
  );
}

function resolveAttendanceApiBaseUrl(c: any) {
  const configured = process.env.PUBLIC_API_BASE_URL || process.env.LAN_API_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const requestUrl = new URL(c.req.url);
  const origin = c.req.header("origin");
  const forwardedHost = c.req.header("x-forwarded-host") || c.req.header("host");
  const forwardedProto = c.req.header("x-forwarded-proto") || requestUrl.protocol.replace(":", "");

  let host = forwardedHost || requestUrl.host;
  let protocol = forwardedProto || requestUrl.protocol.replace(":", "");
  const requestPort = requestUrl.port || (protocol === "https" ? "443" : "80");

  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (isLocalHostname(requestUrl.hostname) && !isLocalHostname(originUrl.hostname)) {
        host = requestUrl.port ? `${originUrl.hostname}:${requestUrl.port}` : originUrl.host;
        protocol = requestUrl.protocol.replace(":", "");
      }
    } catch {
      // Keep request-derived host if origin is not a valid URL.
    }
  }

  const hostWithoutPort = host.split(":")[0];
  if (isLocalHostname(hostWithoutPort)) {
    const lanIp = getLanIPv4();
    if (lanIp) {
      host = `${lanIp}:${requestPort}`;
    }
  }

  return `${protocol}://${host}`;
}

const recordSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().min(1),
  checkInAt: z.string().optional().nullable(),
  checkOutAt: z.string().optional().nullable(),
  status: z.nativeEnum(AttendanceStatus),
  workedMinutes: z.coerce.number().int().nonnegative().optional(),
  overtimeMinutes: z.coerce.number().int().nonnegative().optional(),
  lateMinutes: z.coerce.number().int().nonnegative().optional(),
  note: z.string().trim().max(500).optional().nullable()
});

const periodCloseSchema = z.object({
  isClosed: z.boolean()
});

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function canView(c: any) {
  const user = getAuthUser(c);
  return hasPermission(user, "attendance.view") || hasPermission(user, "attendance.manage");
}

function canManage(c: any) {
  return hasPermission(getAuthUser(c), "attendance.manage");
}

function startOfDay(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date = new Date()) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    return startOfDay(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return startOfDay(date);
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map((part) => Number(part || 0));
  return hours * 60 + minutes;
}

function dateAtTime(date: Date, time: string) {
  const next = startOfDay(date);
  const [hours, minutes] = time.split(":").map((part) => Number(part || 0));
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

async function findCurrentWorkday(date: Date) {
  return prisma.attendanceWorkday.findFirst({
    where: {
      date: startOfDay(date),
      period: { deletedAt: null }
    },
    include: { period: true }
  });
}

async function findEmployee(input: z.infer<typeof scanSchema>) {
  return prisma.employee.findFirst({
    where: {
      deletedAt: null,
      isActive: true,
      OR: [
        ...(input.employeeId ? [{ id: input.employeeId }] : []),
        ...(input.employeeCode ? [{ code: input.employeeCode }] : []),
        ...(input.phone ? [{ phone: input.phone }] : [])
      ]
    },
    include: {
      shifts: {
        where: { isActive: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
      }
    }
  });
}

function serializeRecord(record: any) {
  return {
    ...record,
    workedHours: Math.round((Number(record.workedMinutes || 0) / 60) * 100) / 100,
    overtimeHours: Math.round((Number(record.overtimeMinutes || 0) / 60) * 100) / 100
  };
}

function dateTimeOnDate(date: Date, time?: string | null) {
  if (!time) return null;
  if (time.includes("T")) {
    const parsed = new Date(time);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [hours, minutes] = time.split(":").map((part) => Number(part || 0));
  const next = startOfDay(date);
  next.setHours(hours || 0, minutes || 0, 0, 0);
  return next;
}

async function scanForEmployee(
  tokenValue: string,
  employee: any,
  intent?: "CHECK_IN" | "CHECK_OUT",
  device?: { deviceId: string; userId?: string | null }
) {
  const token = await prisma.attendanceQrToken.findUnique({
    where: { tokenHash: hashToken(tokenValue) }
  });

  if (!token || token.expiresAt <= new Date()) {
    return {
      error: { message: "QR token is invalid or expired", status: 400 }
    };
  }

  const today = startOfDay();
  const workday = await findCurrentWorkday(today);

  if (workday && !workday.isWorkday) {
    return {
      error: { message: "Today is not a workday", status: 400 }
    };
  }

  const shift = employee.shifts?.[0] || { startTime: "08:00", endTime: "16:00" };
  const now = new Date();
  const shiftStart = dateAtTime(today, shift.startTime);
  const shiftEnd = dateAtTime(today, shift.endTime);
  const allowedCheckoutUntil = new Date(
    shiftEnd.getTime() +
      (60 + (employee.allowOvertime ? Number(employee.overtimeMaxHours || 0) * 60 : 0)) * 60000
  );

  const result = await prisma.$transaction(async (tx) => {
    if (device?.deviceId) {
      const lock = await tx.attendanceDeviceLock.findUnique({
        where: {
          deviceId_date: {
            deviceId: device.deviceId,
            date: today
          }
        }
      });

      if (lock && lock.employeeId !== employee.id) {
        return {
          action: "DEVICE_LOCKED",
          message: "این موبایل امروز برای کارمند دیگری استفاده شده است",
          record: null
        };
      }

      if (lock) {
        await tx.attendanceDeviceLock.update({
          where: { id: lock.id },
          data: { lastScanAt: now }
        });
      } else {
        await tx.attendanceDeviceLock.create({
          data: {
            deviceId: device.deviceId,
            date: today,
            employeeId: employee.id,
            userId: device.userId || null,
            lastScanAt: now
          }
        });
      }
    }

    if (!token.usedAt) {
      await tx.attendanceQrToken.update({
        where: { id: token.id },
        data: { usedAt: now }
      });
    }

    const existing = await tx.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } }
    });

    if (intent === "CHECK_OUT" && !existing) {
      return {
        action: "CHECK_OUT_BLOCKED",
        message: "اول شروع کار را ثبت کنید",
        record: null
      };
    }

    if (!existing) {
      const lateMinutes = Math.max(0, minutesBetween(shiftStart, now));
      const record = await tx.attendanceRecord.create({
        data: {
          employeeId: employee.id,
          workdayId: workday?.id || null,
          date: today,
          checkInAt: now,
          status: lateMinutes > 0 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
          lateMinutes,
          qrTokenId: token.id
        },
        include: { employee: true, workday: true }
      });

      return {
        action: "CHECK_IN",
        message: "شروع کار ثبت شد",
        record
      };
    }

    if (intent === "CHECK_IN") {
      return {
        action: "ALREADY_CHECKED_IN",
        message: existing.checkOutAt
          ? "حاضری امروز قبلا تکمیل شده است"
          : "شروع کار امروز قبلا ثبت شده است",
        record: existing
      };
    }

    if (existing.checkOutAt) {
      return {
        action: "ALREADY_DONE",
        message: "حاضری امروز قبلا تکمیل شده است",
        record: existing
      };
    }

    if (now > allowedCheckoutUntil) {
      const record = await tx.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          status: AttendanceStatus.MISSING_CHECKOUT,
          qrTokenId: token.id
        },
        include: { employee: true, workday: true }
      });

      return {
        action: "CHECKOUT_EXPIRED",
        message: "زمان مجاز ختم کار گذشته است؛ برای اصلاح با مدیر تماس بگیرید",
        record
      };
    }

    const workedMinutes = existing.checkInAt ? minutesBetween(existing.checkInAt, now) : 0;
    const scheduledMinutes = minutesFromTime(shift.endTime) - minutesFromTime(shift.startTime);
    const overtimeMinutes = employee.allowOvertime
      ? Math.max(0, workedMinutes - scheduledMinutes)
      : 0;
    const status =
      overtimeMinutes > 0
        ? AttendanceStatus.OVERTIME
        : workedMinutes >= scheduledMinutes / 2
          ? AttendanceStatus.PRESENT
          : AttendanceStatus.HALF_PRESENT;

    const record = await tx.attendanceRecord.update({
      where: { id: existing.id },
      data: {
        checkOutAt: now,
        workedMinutes,
        overtimeMinutes,
        status,
        qrTokenId: token.id
      },
      include: { employee: true, workday: true }
    });

    return {
      action: "CHECK_OUT",
      message: "ختم کار ثبت شد",
      record
    };
  });

  return {
    data: {
      ...result,
      record: result.record ? serializeRecord(result.record) : null
    }
  };
}

attendanceRoute.get("/periods", async (c) => {
  if (!canView(c)) return c.json({ message: "Permission denied" }, 403);

  const periods = await prisma.attendancePeriod.findMany({
    where: { deletedAt: null },
    include: { workdays: { orderBy: { date: "asc" } } },
    orderBy: [{ year: "desc" }, { month: "desc" }]
  });

  return c.json({ data: periods });
});

attendanceRoute.post("/periods", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = periodSchema.safeParse(body);

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const period = await prisma.$transaction(async (tx) => {
    const created = await tx.attendancePeriod.upsert({
      where: { year_month: { year: parsed.data.year, month: parsed.data.month } },
      update: {
        name: parsed.data.name || `${parsed.data.year}-${parsed.data.month}`,
        ...auditUpdateData(authUser?.id)
      },
      create: {
        year: parsed.data.year,
        month: parsed.data.month,
        name: parsed.data.name || `${parsed.data.year}-${parsed.data.month}`,
        ...auditCreateData(authUser?.id)
      }
    });

    if (parsed.data.workdays) {
      for (const day of parsed.data.workdays) {
        const date = parseDate(day.date);
        if (!date) continue;
        await tx.attendanceWorkday.upsert({
          where: { periodId_date: { periodId: created.id, date } },
          update: {
            isWorkday: day.isWorkday,
            isHalfDay: day.isHalfDay,
            description: day.description ?? null
          },
          create: {
            periodId: created.id,
            date,
            isWorkday: day.isWorkday,
            isHalfDay: day.isHalfDay,
            description: day.description ?? null
          }
        });
      }
    }

    return tx.attendancePeriod.findUniqueOrThrow({
      where: { id: created.id },
      include: { workdays: { orderBy: { date: "asc" } } }
    });
  });

  await writeAudit(c, {
    action: "ATTENDANCE_PERIOD_SAVED",
    entityType: "AttendancePeriod",
    entityId: period.id
  });

  return c.json({ data: period });
});

attendanceRoute.patch("/workdays/:id", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = workdayUpdateSchema.safeParse(body);

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const workday = await prisma.attendanceWorkday.update({
    where: { id: c.req.param("id") },
    data: {
      isWorkday: parsed.data.isWorkday,
      isHalfDay: parsed.data.isHalfDay,
      description: parsed.data.description
    },
    include: { period: true }
  });

  await writeAudit(c, {
    action: "ATTENDANCE_WORKDAY_UPDATED",
    entityType: "AttendanceWorkday",
    entityId: workday.id
  });

  return c.json({ data: workday });
});

attendanceRoute.patch("/periods/:id/close", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = periodCloseSchema.safeParse(body);

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const period = await prisma.attendancePeriod.update({
    where: { id: c.req.param("id") },
    data: {
      isClosed: parsed.data.isClosed,
      ...auditUpdateData(authUser?.id)
    },
    include: { workdays: { orderBy: { date: "asc" } } }
  });

  await writeAudit(c, {
    action: parsed.data.isClosed ? "ATTENDANCE_PERIOD_CLOSED" : "ATTENDANCE_PERIOD_REOPENED",
    entityType: "AttendancePeriod",
    entityId: period.id
  });

  return c.json({ data: period });
});

attendanceRoute.get("/reports/monthly", async (c) => {
  if (!canView(c)) return c.json({ message: "Permission denied" }, 403);

  const periodId = c.req.query("periodId");
  if (!periodId) return c.json({ message: "periodId is required" }, 400);

  const period = await prisma.attendancePeriod.findUnique({
    where: { id: periodId },
    include: { workdays: { orderBy: { date: "asc" } } }
  });
  if (!period || period.deletedAt) return c.json({ message: "Attendance period not found" }, 404);

  const workdays = period.workdays.filter((day) => day.isWorkday);
  const records = await prisma.attendanceRecord.findMany({
    where: { workdayId: { in: workdays.map((day) => day.id) } },
    include: { employee: true }
  });
  const employees = await prisma.employee.findMany({
    where: { deletedAt: null },
    orderBy: { fullName: "asc" }
  });

  const rows = employees.map((employee) => {
    const employeeRecords = records.filter((record) => record.employeeId === employee.id);
    const presentStatuses: AttendanceStatus[] = [
      AttendanceStatus.PRESENT,
      AttendanceStatus.LATE,
      AttendanceStatus.OVERTIME
    ];
    const halfStatuses: AttendanceStatus[] = [
      AttendanceStatus.HALF_PRESENT,
      AttendanceStatus.MISSING_CHECKOUT
    ];
    const presentDays = employeeRecords.filter((record) =>
      presentStatuses.includes(record.status)
    ).length;
    const halfDays = employeeRecords.filter((record) =>
      halfStatuses.includes(record.status)
    ).length;
    const absentDays = Math.max(0, workdays.length - presentDays - halfDays);
    const lateMinutes = employeeRecords.reduce((sum, record) => sum + Number(record.lateMinutes || 0), 0);
    const overtimeMinutes = employeeRecords.reduce((sum, record) => sum + Number(record.overtimeMinutes || 0), 0);
    const workedMinutes = employeeRecords.reduce((sum, record) => sum + Number(record.workedMinutes || 0), 0);

    return {
      employee,
      presentDays,
      halfDays,
      absentDays,
      lateMinutes,
      overtimeMinutes,
      workedMinutes,
      records: employeeRecords.map(serializeRecord)
    };
  });

  return c.json({
    data: {
      period,
      summary: {
        employeeCount: employees.length,
        workdayCount: workdays.length,
        presentDays: rows.reduce((sum, row) => sum + row.presentDays, 0),
        halfDays: rows.reduce((sum, row) => sum + row.halfDays, 0),
        absentDays: rows.reduce((sum, row) => sum + row.absentDays, 0),
        overtimeHours: Math.round((rows.reduce((sum, row) => sum + row.overtimeMinutes, 0) / 60) * 100) / 100,
        lateHours: Math.round((rows.reduce((sum, row) => sum + row.lateMinutes, 0) / 60) * 100) / 100
      },
      rows
    }
  });
});

attendanceRoute.get("/records", async (c) => {
  if (!canView(c)) return c.json({ message: "Permission denied" }, 403);

  const date = parseDate(c.req.query("date") || new Date().toISOString()) || startOfDay();
  const records = await prisma.attendanceRecord.findMany({
    where: {
      date: {
        gte: date,
        lte: endOfDay(date)
      }
    },
    include: {
      employee: true,
      workday: true
    },
    orderBy: { createdAt: "desc" }
  });

  return c.json({ data: records.map(serializeRecord) });
});

attendanceRoute.post("/records", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = recordSchema.safeParse(body);

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const date = parseDate(parsed.data.date);
  if (!date) return c.json({ message: "Invalid date" }, 400);

  const employee = await prisma.employee.findUnique({
    where: { id: parsed.data.employeeId }
  });
  if (!employee || employee.deletedAt) {
    return c.json({ message: "Employee not found" }, 404);
  }

  const workday = await findCurrentWorkday(date);
  const checkInAt = dateTimeOnDate(date, parsed.data.checkInAt);
  const checkOutAt = dateTimeOnDate(date, parsed.data.checkOutAt);
  const workedMinutes =
    parsed.data.workedMinutes ??
    (checkInAt && checkOutAt ? minutesBetween(checkInAt, checkOutAt) : 0);

  const record = await prisma.attendanceRecord.upsert({
    where: {
      employeeId_date: {
        employeeId: parsed.data.employeeId,
        date
      }
    },
    update: {
      workdayId: workday?.id || null,
      checkInAt,
      checkOutAt,
      status: parsed.data.status,
      workedMinutes,
      overtimeMinutes: parsed.data.overtimeMinutes ?? 0,
      lateMinutes: parsed.data.lateMinutes ?? 0,
      note: parsed.data.note ?? null,
      updatedByUserId: authUser?.id ?? null
    },
    create: {
      employeeId: parsed.data.employeeId,
      workdayId: workday?.id || null,
      date,
      checkInAt,
      checkOutAt,
      status: parsed.data.status,
      workedMinutes,
      overtimeMinutes: parsed.data.overtimeMinutes ?? 0,
      lateMinutes: parsed.data.lateMinutes ?? 0,
      note: parsed.data.note ?? null,
      createdByUserId: authUser?.id ?? null,
      updatedByUserId: authUser?.id ?? null
    },
    include: {
      employee: true,
      workday: true
    }
  });

  await writeAudit(c, {
    action: "ATTENDANCE_RECORD_MANUAL_UPSERT",
    entityType: "AttendanceRecord",
    entityId: record.id
  });

  return c.json({ data: serializeRecord(record) });
});

attendanceRoute.patch("/records/:id", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const authUser = getAuthUser(c);
  const existing = await prisma.attendanceRecord.findUnique({
    where: { id: c.req.param("id") }
  });
  if (!existing) return c.json({ message: "Attendance record not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = recordSchema.partial().safeParse(body);

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const date = parsed.data.date ? parseDate(parsed.data.date) : existing.date;
  if (!date) return c.json({ message: "Invalid date" }, 400);

  const checkInAt =
    parsed.data.checkInAt === undefined
      ? existing.checkInAt
      : dateTimeOnDate(date, parsed.data.checkInAt);
  const checkOutAt =
    parsed.data.checkOutAt === undefined
      ? existing.checkOutAt
      : dateTimeOnDate(date, parsed.data.checkOutAt);
  const workedMinutes =
    parsed.data.workedMinutes ??
    (checkInAt && checkOutAt ? minutesBetween(checkInAt, checkOutAt) : existing.workedMinutes);

  const record = await prisma.attendanceRecord.update({
    where: { id: existing.id },
    data: {
      checkInAt,
      checkOutAt,
      status: parsed.data.status ?? AttendanceStatus.MANUAL_ADJUSTED,
      workedMinutes,
      overtimeMinutes: parsed.data.overtimeMinutes ?? existing.overtimeMinutes,
      lateMinutes: parsed.data.lateMinutes ?? existing.lateMinutes,
      note: parsed.data.note,
      updatedByUserId: authUser?.id ?? null
    },
    include: {
      employee: true,
      workday: true
    }
  });

  await writeAudit(c, {
    action: "ATTENDANCE_RECORD_UPDATED",
    entityType: "AttendanceRecord",
    entityId: record.id
  });

  return c.json({ data: serializeRecord(record) });
});

attendanceRoute.post("/qr-token", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const authUser = getAuthUser(c);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 60_000);
  const row = await prisma.attendanceQrToken.create({
    data: {
      tokenHash: hashToken(token),
      expiresAt,
      createdByUserId: authUser?.id ?? null
    }
  });

  const frontendUrl = `${c.req.header("origin") || ""}/attendance-scan?token=${encodeURIComponent(token)}`;
  const apiBaseUrl = resolveAttendanceApiBaseUrl(c);
  const qrPayload = JSON.stringify({
    type: "BELAL_ATTENDANCE",
    token,
    apiBaseUrl
  });
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    margin: 1,
    width: 280
  });

  return c.json({
    data: {
      id: row.id,
      token,
      expiresAt,
      url: frontendUrl,
      apiBaseUrl,
      qrDataUrl
    }
  });
});

attendanceRoute.post("/scan", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = scanSchema.safeParse(body);

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  if (!parsed.data.employeeId && !parsed.data.employeeCode && !parsed.data.phone) {
    return c.json({ message: "Employee code, phone or id is required" }, 400);
  }

  const employee = await findEmployee(parsed.data);

  if (!employee) return c.json({ message: "Employee not found" }, 404);

  const result = await scanForEmployee(parsed.data.token, employee);
  if (result.error) return c.json({ message: result.error.message }, result.error.status as any);
  return c.json({ data: result.data });
});

attendanceRoute.post("/scan-auth", async (c) => {
  const authUser = getAuthUser(c);
  if (!authUser) return c.json({ message: "Authentication required" }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = scanAuthSchema.safeParse(body);
  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const employee = await prisma.employee.findFirst({
    where: {
      userId: authUser.id,
      deletedAt: null,
      isActive: true
    },
    include: {
      shifts: {
        where: { isActive: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
      }
    }
  });

  if (!employee) {
    return c.json({ message: "This user is not linked to an active employee" }, 403);
  }

  const result = await scanForEmployee(parsed.data.token, employee, parsed.data.intent, {
    deviceId: parsed.data.deviceId,
    userId: authUser.id
  });
  if (result.error) return c.json({ message: result.error.message }, result.error.status as any);
  return c.json({ data: result.data });
});

attendanceRoute.post("/close-missing", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const date = parseDate(c.req.query("date") || new Date().toISOString()) || startOfDay();
  const updated = await prisma.attendanceRecord.updateMany({
    where: {
      date,
      checkInAt: { not: null },
      checkOutAt: null
    },
    data: {
      status: AttendanceStatus.MISSING_CHECKOUT,
      workedMinutes: 0,
      overtimeMinutes: 0
    }
  });

  return c.json({ data: updated });
});
