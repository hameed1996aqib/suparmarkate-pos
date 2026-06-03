import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import {
  getAuthUser,
  hashPassword,
  hasPermission,
  writeAudit
} from "../../lib/auth";
import {
  attachAuditUsers,
  auditCreateData,
  auditDeleteData,
  auditUpdateData
} from "../../lib/audit-meta";

export const employeesRoute = new Hono();

const employeeSchema = z.object({
  code: z.string().trim().max(50).optional().nullable(),
  fullName: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(50).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  position: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  monthlySalary: z.coerce.number().nonnegative().default(0),
  allowOvertime: z.boolean().optional(),
  overtimeHourlyRate: z.coerce.number().nonnegative().optional(),
  overtimeMaxHours: z.coerce.number().nonnegative().optional(),
  shiftStart: z.string().trim().default("08:00"),
  shiftEnd: z.string().trim().default("16:00"),
  isActive: z.boolean().optional(),
  createUser: z.boolean().optional(),
  username: z.string().trim().min(3).max(80).optional().nullable(),
  password: z.string().min(6).max(160).optional().nullable(),
  roleId: z.string().trim().optional().nullable(),
  userId: z.string().trim().optional().nullable()
});

function startOfDay(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function canView(c: any) {
  const user = getAuthUser(c);
  return hasPermission(user, "employees.view") || hasPermission(user, "employees.manage");
}

function canManage(c: any) {
  return hasPermission(getAuthUser(c), "employees.manage");
}

function serializeEmployee(employee: any) {
  return {
    ...employee,
    monthlySalary: Number(employee.monthlySalary || 0),
    overtimeHourlyRate: Number(employee.overtimeHourlyRate || 0),
    overtimeMaxHours: Number(employee.overtimeMaxHours || 0),
    shift: employee.shifts?.[0] || null
  };
}

employeesRoute.get("/", async (c) => {
  if (!canView(c)) return c.json({ message: "Permission denied" }, 403);

  const employees = await prisma.employee.findMany({
    where: { deletedAt: null },
    include: {
      user: {
        include: {
          role: {
            include: {
              permissions: true
            }
          }
        }
      },
      shifts: {
        where: { isActive: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
      }
    },
    orderBy: { createdAt: "desc" }
  });

  const enriched = await attachAuditUsers(employees);
  return c.json({ data: enriched.map(serializeEmployee) });
});

employeesRoute.get("/me", async (c) => {
  const authUser = getAuthUser(c);
  if (!authUser) return c.json({ message: "Authentication required" }, 401);

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
      },
      attendanceRecords: {
        orderBy: { date: "desc" },
        take: 90
      },
      payrollLines: {
        include: {
          run: {
            include: {
              period: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 12
      },
      payments: {
        where: { deletedAt: null },
        include: { currency: true, payrollRun: { include: { period: true } } },
        orderBy: { paidAt: "desc" },
        take: 20
      }
    }
  });

  if (!employee) {
    return c.json({ message: "This user is not linked to an active employee" }, 404);
  }

  const now = new Date();
  const currentPeriod = await prisma.attendancePeriod.findFirst({
    where: {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      deletedAt: null
    },
    include: { workdays: true }
  });
  const workdayIds = currentPeriod?.workdays.filter((day) => day.isWorkday).map((day) => day.id) || [];
  const monthRecords = workdayIds.length
    ? await prisma.attendanceRecord.findMany({
        where: {
          employeeId: employee.id,
          workdayId: { in: workdayIds }
        }
      })
    : [];
  const presentDays = monthRecords.filter((record) =>
    ["PRESENT", "LATE", "OVERTIME"].includes(record.status)
  ).length;
  const halfDays = monthRecords.filter((record) =>
    ["HALF_PRESENT", "MISSING_CHECKOUT"].includes(record.status)
  ).length;
  const overtimeMinutes = monthRecords.reduce((sum, record) => sum + Number(record.overtimeMinutes || 0), 0);
  const latestPayroll = employee.payrollLines[0] || null;
  const todayRecord = await prisma.attendanceRecord.findUnique({
    where: {
      employeeId_date: {
        employeeId: employee.id,
        date: startOfDay(now)
      }
    }
  });

  return c.json({
    data: {
      employee: serializeEmployee(employee),
      todayRecord,
      summary: {
        period: currentPeriod,
        presentDays,
        halfDays,
        absentDays: Math.max(0, workdayIds.length - presentDays - halfDays),
        overtimeHours: Math.round((overtimeMinutes / 60) * 100) / 100,
        monthlySalary: Number(employee.monthlySalary || 0),
        latestPayroll: latestPayroll
          ? {
              period: latestPayroll.run.period,
              grossPay: Number(latestPayroll.grossPay || 0),
              paidAmount: Number(latestPayroll.paidAmount || 0),
              remainingAmount: Number(latestPayroll.remainingAmount || 0)
            }
          : null
      }
    }
  });
});

employeesRoute.get("/:id", async (c) => {
  if (!canView(c)) return c.json({ message: "Permission denied" }, 403);

  const employee = await prisma.employee.findUnique({
    where: { id: c.req.param("id") },
    include: {
      user: { include: { role: { include: { permissions: true } } } },
      shifts: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
      attendanceRecords: { orderBy: { date: "desc" }, take: 60 },
      payments: { orderBy: { paidAt: "desc" }, take: 30 }
    }
  });

  if (!employee || employee.deletedAt) {
    return c.json({ message: "Employee not found" }, 404);
  }

  return c.json({ data: serializeEmployee(await attachAuditUsers(employee)) });
});

employeesRoute.post("/", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = employeeSchema.safeParse(body);

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  if (parsed.data.createUser && (!parsed.data.username || !parsed.data.password)) {
    return c.json({ message: "Username and password are required" }, 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    let userId = parsed.data.userId || null;

    if (userId) {
      const existingEmployee = await tx.employee.findFirst({
        where: { userId, deletedAt: null }
      });
      if (existingEmployee) throw new Error("User is already linked to an employee");
    }

    if (parsed.data.createUser) {
      const user = await tx.user.create({
        data: {
          username: parsed.data.username!,
          displayName: parsed.data.fullName,
          passwordHash: await hashPassword(parsed.data.password!),
          roleId: parsed.data.roleId || null,
          isActive: true,
          ...auditCreateData(authUser?.id)
        }
      });
      userId = user.id;
    }

    return tx.employee.create({
      data: {
        code: parsed.data.code || null,
        fullName: parsed.data.fullName,
        phone: parsed.data.phone || null,
        address: parsed.data.address || null,
        position: parsed.data.position || null,
        note: parsed.data.note || null,
        monthlySalary: parsed.data.monthlySalary,
        allowOvertime: parsed.data.allowOvertime ?? false,
        overtimeHourlyRate: parsed.data.overtimeHourlyRate ?? 0,
        overtimeMaxHours: parsed.data.overtimeMaxHours ?? 0,
        userId,
        isActive: parsed.data.isActive ?? true,
        ...auditCreateData(authUser?.id),
        shifts: {
          create: {
            name: "Default",
            startTime: parsed.data.shiftStart,
            endTime: parsed.data.shiftEnd,
            isDefault: true,
            isActive: true
          }
        }
      },
      include: {
        user: { include: { role: { include: { permissions: true } } } },
        shifts: true
      }
    });
  });

  await writeAudit(c, {
    action: "EMPLOYEE_CREATED",
    entityType: "Employee",
    entityId: result.id
  });

  return c.json({ data: serializeEmployee(await attachAuditUsers(result)) }, 201);
});

employeesRoute.patch("/:id", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = employeeSchema.partial().safeParse(body);

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const result = await prisma.$transaction(async (tx) => {
    let userId = parsed.data.userId;

    if (userId) {
      const existingEmployee = await tx.employee.findFirst({
        where: { userId, deletedAt: null, NOT: { id } }
      });
      if (existingEmployee) throw new Error("User is already linked to an employee");
    }

    if (parsed.data.createUser) {
      if (!parsed.data.username || !parsed.data.password) {
        throw new Error("Username and password are required");
      }
      const user = await tx.user.create({
        data: {
          username: parsed.data.username,
          displayName: parsed.data.fullName || parsed.data.username,
          passwordHash: await hashPassword(parsed.data.password),
          roleId: parsed.data.roleId || null,
          isActive: true,
          ...auditCreateData(authUser?.id)
        }
      });
      userId = user.id;
    }

    const employee = await tx.employee.update({
      where: { id },
      data: {
        code: parsed.data.code,
        fullName: parsed.data.fullName,
        phone: parsed.data.phone,
        address: parsed.data.address,
        position: parsed.data.position,
        note: parsed.data.note,
        monthlySalary: parsed.data.monthlySalary,
        allowOvertime: parsed.data.allowOvertime,
        overtimeHourlyRate: parsed.data.overtimeHourlyRate,
        overtimeMaxHours: parsed.data.overtimeMaxHours,
        userId: userId === undefined ? undefined : userId || null,
        isActive: parsed.data.isActive,
        ...auditUpdateData(authUser?.id)
      }
    });

    if (parsed.data.shiftStart || parsed.data.shiftEnd) {
      const existingShift = await tx.employeeShift.findFirst({
        where: { employeeId: id, isDefault: true, isActive: true }
      });
      if (existingShift) {
        await tx.employeeShift.update({
          where: { id: existingShift.id },
          data: {
            startTime: parsed.data.shiftStart || existingShift.startTime,
            endTime: parsed.data.shiftEnd || existingShift.endTime
          }
        });
      }
    }

    return tx.employee.findUniqueOrThrow({
      where: { id: employee.id },
      include: {
        user: { include: { role: { include: { permissions: true } } } },
        shifts: { where: { isActive: true } }
      }
    });
  });

  await writeAudit(c, {
    action: "EMPLOYEE_UPDATED",
    entityType: "Employee",
    entityId: result.id
  });

  return c.json({ data: serializeEmployee(await attachAuditUsers(result)) });
});

employeesRoute.delete("/:id", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const [attendanceRecords, payrollLines, payments] = await Promise.all([
    prisma.attendanceRecord.count({ where: { employeeId: id } }),
    prisma.payrollLine.count({ where: { employeeId: id } }),
    prisma.employeePayment.count({ where: { employeeId: id } })
  ]);

  if (attendanceRecords + payrollLines + payments > 0) {
    return c.json(
      {
        message:
          "این کارمند در حاضری، معاش یا پرداخت‌ها استفاده شده است و قابل حذف نیست. اگر لازم است، او را غیرفعال کنید.",
        usage: {
          attendanceRecords,
          payrollLines,
          payments
        }
      },
      400
    );
  }

  const employee = await prisma.employee.update({
    where: { id },
    data: auditDeleteData(authUser?.id),
    include: {
      user: true,
      shifts: true
    }
  });

  await writeAudit(c, {
    action: "EMPLOYEE_DISABLED",
    entityType: "Employee",
    entityId: employee.id
  });

  return c.json({ message: "Employee disabled", data: serializeEmployee(employee) });
});
