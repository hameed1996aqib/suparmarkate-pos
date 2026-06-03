import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, hasPermission, writeAudit } from "../../lib/auth";
import { auditCreateData } from "../../lib/audit-meta";
import { resolveCurrencySnapshot, snapshotBaseFields, toBaseAmount } from "../../lib/currency-rates";
import { createPostedJournal, treasuryAccountCode } from "../../lib/journal";
import { getRequestPosDevice } from "../../lib/pos-device";
import {
  AttendanceStatus,
  MoneyDirection,
  MoneyTransactionType,
  PayrollRunStatus
} from "../../generated/prisma/enums";

export const payrollRoute = new Hono();

const runSchema = z.object({
  periodId: z.string().min(1),
  note: z.string().trim().max(500).optional().nullable()
});

const accountTypeSchema = z.enum(["CASH", "BANK"]);

const paymentSchema = z.object({
  employeeId: z.string().min(1),
  payrollRunId: z.string().optional().nullable(),
  payrollLineId: z.string().optional().nullable(),
  currencyId: z.string().min(1),
  accountType: accountTypeSchema,
  accountId: z.string().min(1),
  amount: z.coerce.number().positive(),
  note: z.string().trim().max(500).optional().nullable()
});

const runStatusSchema = z.object({
  status: z.enum(["DRAFT", "REVIEWED", "PAID", "CANCELLED"])
});

function canView(c: any) {
  const user = getAuthUser(c);
  return hasPermission(user, "payroll.view") || hasPermission(user, "payroll.manage");
}

function canManage(c: any) {
  return hasPermission(getAuthUser(c), "payroll.manage");
}

function toNumber(value: unknown) {
  return Number(value || 0);
}

function round2(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function getTreasuryAccount(type: "CASH" | "BANK", id: string) {
  if (type === "CASH") {
    const account = await prisma.cashRegisterAccount.findUnique({
      where: { id },
      include: { cashRegister: true, currency: true }
    });
    return account
      ? { id: account.id, type, currencyId: account.currencyId, balance: toNumber(account.balance) }
      : null;
  }

  const account = await prisma.bankAccount.findUnique({
    where: { id },
    include: { currency: true }
  });
  return account
    ? { id: account.id, type, currencyId: account.currencyId, balance: toNumber(account.balance) }
    : null;
}

function serializeRun(run: any) {
  return {
    ...run,
    totalBaseSalary: toNumber(run.totalBaseSalary),
    totalOvertime: toNumber(run.totalOvertime),
    totalEarned: toNumber(run.totalEarned),
    totalPaid: toNumber(run.totalPaid),
    totalRemaining: toNumber(run.totalRemaining),
    lines: run.lines?.map((line: any) => ({
      ...line,
      presentDays: toNumber(line.presentDays),
      halfDays: toNumber(line.halfDays),
      absentDays: toNumber(line.absentDays),
      overtimeHours: toNumber(line.overtimeHours),
      baseSalary: toNumber(line.baseSalary),
      overtimeAmount: toNumber(line.overtimeAmount),
      grossPay: toNumber(line.grossPay),
      paidAmount: toNumber(line.paidAmount),
      remainingAmount: toNumber(line.remainingAmount)
    }))
  };
}

payrollRoute.get("/runs", async (c) => {
  if (!canView(c)) return c.json({ message: "Permission denied" }, 403);

  const runs = await prisma.payrollRun.findMany({
    where: { deletedAt: null },
    include: {
      period: true,
      lines: {
        include: { employee: true },
        orderBy: { employee: { fullName: "asc" } }
      },
      payments: {
        include: { employee: true, currency: true },
        orderBy: { paidAt: "desc" }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return c.json({ data: runs.map(serializeRun) });
});

payrollRoute.post("/runs", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = runSchema.safeParse(body);

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const period = await prisma.attendancePeriod.findUnique({
    where: { id: parsed.data.periodId },
    include: { workdays: true }
  });

  if (!period || period.deletedAt) {
    return c.json({ message: "Attendance period not found" }, 404);
  }

  const existingRun = await prisma.payrollRun.findFirst({
    where: {
      periodId: period.id,
      deletedAt: null,
      status: { not: PayrollRunStatus.CANCELLED }
    },
    include: { lines: { select: { employeeId: true } } }
  });

  const workdays = period.workdays.filter((day) => day.isWorkday);
  const workingDays = workdays.reduce((sum, day) => sum + (day.isHalfDay ? 0.5 : 1), 0);

  if (workingDays <= 0) {
    return c.json({ message: "Period has no workdays" }, 400);
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const accruedWorkdays = period.isClosed
    ? workdays
    : workdays.filter((day) => day.date <= today);
  const existingEmployeeIds = existingRun?.lines.map((line) => line.employeeId) ?? [];
  const employees = await prisma.employee.findMany({
    where: {
      OR: [
        { deletedAt: null, isActive: true },
        ...(existingEmployeeIds.length > 0 ? [{ id: { in: existingEmployeeIds } }] : [])
      ]
    },
    include: {
      attendanceRecords: {
        where: { workdayId: { in: accruedWorkdays.map((day) => day.id) } }
      }
    },
    orderBy: { fullName: "asc" }
  });

  const result = await prisma.$transaction(async (tx) => {
    const run = existingRun
      ? await tx.payrollRun.update({
          where: { id: existingRun.id },
          data: {
            note: parsed.data.note ?? existingRun.note,
            updatedByUserId: authUser?.id ?? null
          }
        })
      : await tx.payrollRun.create({
          data: {
            periodId: period.id,
            status: PayrollRunStatus.DRAFT,
            note: parsed.data.note ?? null,
            ...auditCreateData(authUser?.id)
          }
        });
    const paymentTotals = await tx.employeePayment.groupBy({
      by: ["employeeId"],
      where: { payrollRunId: run.id, deletedAt: null },
      _sum: { amount: true }
    });
    const paidByEmployee = new Map(
      paymentTotals.map((payment) => [payment.employeeId, toNumber(payment._sum.amount)])
    );

    let totalBaseSalary = 0;
    let totalOvertime = 0;
    let totalEarned = 0;
    let totalPaid = 0;
    let totalRemaining = 0;

    for (const employee of employees) {
      let presentDays = 0;
      let halfDays = 0;
      let overtimeMinutes = 0;

      for (const day of accruedWorkdays) {
        const record = employee.attendanceRecords.find((item) => item.workdayId === day.id);

        if (!record) continue;

        if (
          record.status === AttendanceStatus.PRESENT ||
          record.status === AttendanceStatus.LATE ||
          record.status === AttendanceStatus.OVERTIME
        ) {
          presentDays += day.isHalfDay ? 0.5 : 1;
        } else if (
          record.status === AttendanceStatus.HALF_PRESENT ||
          record.status === AttendanceStatus.MISSING_CHECKOUT
        ) {
          halfDays += day.isHalfDay ? 0.25 : 0.5;
        }

        overtimeMinutes += Number(record.overtimeMinutes || 0);
      }

      const accruedWorkingDays = accruedWorkdays.reduce(
        (sum, day) => sum + (day.isHalfDay ? 0.5 : 1),
        0
      );
      const absentDays = Math.max(0, accruedWorkingDays - presentDays - halfDays);
      const dailySalary = toNumber(employee.monthlySalary) / workingDays;
      const baseSalary = round2(presentDays * dailySalary + halfDays * dailySalary);
      const overtimeHours = round2(overtimeMinutes / 60);
      const overtimeAmount = round2(overtimeHours * toNumber(employee.overtimeHourlyRate));
      const grossPay = round2(baseSalary + overtimeAmount);
      const paidAmount = round2(paidByEmployee.get(employee.id) ?? 0);
      const remainingAmount = Math.max(0, round2(grossPay - paidAmount));

      totalBaseSalary += baseSalary;
      totalOvertime += overtimeAmount;
      totalEarned += grossPay;
      totalPaid += paidAmount;
      totalRemaining += remainingAmount;

      await tx.payrollLine.upsert({
        where: { runId_employeeId: { runId: run.id, employeeId: employee.id } },
        create: {
          runId: run.id,
          employeeId: employee.id,
          workingDays: Math.round(workingDays),
          presentDays,
          halfDays,
          absentDays,
          overtimeHours,
          baseSalary,
          overtimeAmount,
          grossPay,
          paidAmount,
          remainingAmount
        },
        update: {
          workingDays: Math.round(workingDays),
          presentDays,
          halfDays,
          absentDays,
          overtimeHours,
          baseSalary,
          overtimeAmount,
          grossPay,
          paidAmount,
          remainingAmount
        }
      });
    }

    const nextStatus =
      period.isClosed && totalEarned > 0 && totalPaid >= totalEarned
        ? PayrollRunStatus.PAID
        : totalPaid > 0 || existingRun?.status === PayrollRunStatus.REVIEWED
          ? PayrollRunStatus.REVIEWED
          : PayrollRunStatus.DRAFT;

    await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        totalBaseSalary: round2(totalBaseSalary),
        totalOvertime: round2(totalOvertime),
        totalEarned: round2(totalEarned),
        totalPaid: round2(totalPaid),
        totalRemaining: round2(totalRemaining),
        status: nextStatus,
        updatedByUserId: authUser?.id ?? null
      }
    });

    return tx.payrollRun.findUniqueOrThrow({
      where: { id: run.id },
      include: {
        period: true,
        lines: { include: { employee: true } },
        payments: true
      }
    });
  });

  await writeAudit(c, {
    action: existingRun ? "PAYROLL_RUN_RECALCULATED" : "PAYROLL_RUN_CREATED",
    entityType: "PayrollRun",
    entityId: result.id
  });

  return c.json({ data: serializeRun(result) }, existingRun ? 200 : 201);
});

payrollRoute.delete("/runs/:id", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const authUser = getAuthUser(c);
  const existing = await prisma.payrollRun.findUnique({
    where: { id: c.req.param("id") },
    include: { payments: { where: { deletedAt: null } } }
  });

  if (!existing || existing.deletedAt) {
    return c.json({ message: "Payroll run not found" }, 404);
  }

  if (existing.payments.length > 0) {
    return c.json({ message: "Cancel payroll payments before cancelling the payroll run" }, 400);
  }

  const run = await prisma.payrollRun.update({
    where: { id: c.req.param("id") },
    data: {
      status: PayrollRunStatus.CANCELLED,
      deletedAt: new Date(),
      deletedByUserId: authUser?.id ?? null,
      updatedByUserId: authUser?.id ?? null
    }
  });

  return c.json({ message: "Payroll run cancelled", data: run });
});

payrollRoute.patch("/runs/:id/status", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = runStatusSchema.safeParse(body);

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const existing = await prisma.payrollRun.findUnique({
    where: { id: c.req.param("id") },
    include: { period: true, lines: true, payments: { where: { deletedAt: null } } }
  });

  if (!existing || existing.deletedAt) {
    return c.json({ message: "Payroll run not found" }, 404);
  }

  const target = parsed.data.status as PayrollRunStatus;
  const totalEarned = existing.lines.reduce((sum, line) => sum + toNumber(line.grossPay), 0);
  const totalPaid = existing.lines.reduce((sum, line) => sum + toNumber(line.paidAmount), 0);

  if (target === PayrollRunStatus.PAID && totalPaid < totalEarned) {
    return c.json({ message: "Payroll run cannot be marked paid while remaining amount exists" }, 400);
  }

  if (target === PayrollRunStatus.PAID && !existing.period.isClosed) {
    return c.json({ message: "Close the attendance period before marking payroll as paid" }, 400);
  }

  if (target === PayrollRunStatus.CANCELLED && existing.payments.length > 0) {
    return c.json({ message: "Cancel payroll payments before cancelling the payroll run" }, 400);
  }

  const run = await prisma.payrollRun.update({
    where: { id: existing.id },
    data: {
      status: target,
      deletedAt: target === PayrollRunStatus.CANCELLED ? new Date() : null,
      deletedByUserId: target === PayrollRunStatus.CANCELLED ? authUser?.id ?? null : null,
      updatedByUserId: authUser?.id ?? null
    },
    include: {
      period: true,
      lines: { include: { employee: true }, orderBy: { employee: { fullName: "asc" } } },
      payments: { include: { employee: true, currency: true }, orderBy: { paidAt: "desc" } }
    }
  });

  await writeAudit(c, {
    action: "PAYROLL_RUN_STATUS_UPDATED",
    entityType: "PayrollRun",
    entityId: run.id,
    metadata: { status: target }
  });

  return c.json({ data: serializeRun(run) });
});

payrollRoute.get("/payments", async (c) => {
  if (!canView(c)) return c.json({ message: "Permission denied" }, 403);

  const payments = await prisma.employeePayment.findMany({
    where: { deletedAt: null },
    include: {
      employee: true,
      currency: true,
      cashRegisterAccount: { include: { cashRegister: true } },
      bankAccount: true,
      payrollRun: { include: { period: true } }
    },
    orderBy: { paidAt: "desc" },
    take: 200
  });

  return c.json({
    data: payments.map((payment) => ({
      ...payment,
      amount: toNumber(payment.amount)
    }))
  });
});

payrollRoute.post("/payments", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const authUser = getAuthUser(c);
  const posDevice = await getRequestPosDevice(c, authUser?.id ?? null);
  const body = await c.req.json().catch(() => null);
  const parsed = paymentSchema.safeParse(body);

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const [employee, account] = await Promise.all([
    prisma.employee.findUnique({ where: { id: parsed.data.employeeId } }),
    getTreasuryAccount(parsed.data.accountType, parsed.data.accountId)
  ]);

  if (!employee || employee.deletedAt) {
    return c.json({ message: "Employee not found" }, 404);
  }

  if (!account) return c.json({ message: "Payment account not found" }, 404);

  if (account.currencyId !== parsed.data.currencyId) {
    return c.json({ message: "Payment account currency mismatch" }, 400);
  }

  if (account.balance < parsed.data.amount) {
    return c.json({ message: "Not enough balance in payment account" }, 400);
  }

  let currencySnapshot;

  try {
    currencySnapshot = await resolveCurrencySnapshot(prisma, parsed.data.currencyId);
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Currency rate could not be resolved" },
      400
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    let balanceAfter: unknown = null;

    if (parsed.data.accountType === "CASH") {
      const updated = await tx.cashRegisterAccount.update({
        where: { id: parsed.data.accountId },
        data: { balance: { decrement: parsed.data.amount } }
      });
      balanceAfter = updated.balance;
    } else {
      const updated = await tx.bankAccount.update({
        where: { id: parsed.data.accountId },
        data: { balance: { decrement: parsed.data.amount } }
      });
      balanceAfter = updated.balance;
    }

    const moneyTransaction = await tx.moneyTransaction.create({
      data: {
        currencyId: parsed.data.currencyId,
        cashRegisterAccountId:
          parsed.data.accountType === "CASH" ? parsed.data.accountId : null,
        bankAccountId:
          parsed.data.accountType === "BANK" ? parsed.data.accountId : null,
        type: MoneyTransactionType.PAYROLL_PAYMENT,
        direction: MoneyDirection.OUT,
        amount: parsed.data.amount,
        balanceAfter: balanceAfter as any,
        ...snapshotBaseFields(currencySnapshot, {
          amount: parsed.data.amount,
          balanceAfter: Number(balanceAfter || 0)
        }),
        referenceType: "EMPLOYEE_PAYMENT",
        createdByUserId: authUser?.id ?? null,
        posDeviceId: posDevice?.id ?? null,
        note: parsed.data.note ?? `Payroll payment to ${employee.fullName}`
      }
    });

    const payment = await tx.employeePayment.create({
      data: {
        employeeId: employee.id,
        payrollRunId: parsed.data.payrollRunId ?? null,
        payrollLineId: parsed.data.payrollLineId ?? null,
        currencyId: parsed.data.currencyId,
        cashRegisterAccountId:
          parsed.data.accountType === "CASH" ? parsed.data.accountId : null,
        bankAccountId:
          parsed.data.accountType === "BANK" ? parsed.data.accountId : null,
        amount: parsed.data.amount,
        exchangeRate: currencySnapshot.exchangeRate,
        baseCurrencyId: currencySnapshot.baseCurrencyId,
        baseAmount: toBaseAmount(parsed.data.amount, currencySnapshot),
        note: parsed.data.note ?? null,
        moneyTransactionId: moneyTransaction.id,
        createdByUserId: authUser?.id ?? null
      }
    });

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-PAYROLL",
      sourceType: "EMPLOYEE_PAYMENT",
      sourceId: payment.id,
      description: `Payroll payment to ${employee.fullName}`,
      createdByUserId: authUser?.id ?? null,
      lines: [
        {
          accountCode: "6100",
          debit: parsed.data.amount,
          exchangeRate: currencySnapshot.exchangeRate,
          baseCurrencyId: currencySnapshot.baseCurrencyId,
          note: parsed.data.note ?? "Payroll expense"
        },
        {
          accountCode: treasuryAccountCode(parsed.data.accountType),
          credit: parsed.data.amount,
          exchangeRate: currencySnapshot.exchangeRate,
          baseCurrencyId: currencySnapshot.baseCurrencyId,
          note: parsed.data.note ?? "Payroll paid"
        }
      ]
    });

    const updatedPayment = await tx.employeePayment.update({
      where: { id: payment.id },
      data: { journalEntryId: journalEntry.id },
      include: {
        employee: true,
        currency: true,
        payrollLine: true,
        payrollRun: true,
        moneyTransaction: true,
        journalEntry: true
      }
    });

    if (parsed.data.payrollLineId) {
      const line = await tx.payrollLine.findUnique({
        where: { id: parsed.data.payrollLineId }
      });
      if (line) {
        const paidAmount = toNumber(line.paidAmount) + parsed.data.amount;
        await tx.payrollLine.update({
          where: { id: line.id },
          data: {
            paidAmount,
            remainingAmount: Math.max(0, toNumber(line.grossPay) - paidAmount)
          }
        });
      }
    }

    if (parsed.data.payrollRunId) {
      const [lines, run] = await Promise.all([
        tx.payrollLine.findMany({
          where: { runId: parsed.data.payrollRunId }
        }),
        tx.payrollRun.findUnique({
          where: { id: parsed.data.payrollRunId },
          include: { period: true }
        })
      ]);
      const totalPaid = lines.reduce((sum, line) => sum + toNumber(line.paidAmount), 0);
      const totalEarned = lines.reduce((sum, line) => sum + toNumber(line.grossPay), 0);
      await tx.payrollRun.update({
        where: { id: parsed.data.payrollRunId },
        data: {
          totalPaid,
          totalRemaining: Math.max(0, totalEarned - totalPaid),
          status:
            run?.period.isClosed && totalEarned > 0 && totalPaid >= totalEarned
              ? PayrollRunStatus.PAID
              : PayrollRunStatus.REVIEWED
        }
      });
    }

    return updatedPayment;
  });

  await writeAudit(c, {
    action: "EMPLOYEE_PAYMENT_CREATED",
    entityType: "EmployeePayment",
    entityId: result.id
  });

  return c.json({ data: { ...result, amount: toNumber(result.amount) } }, 201);
});

payrollRoute.delete("/payments/:id", async (c) => {
  if (!canManage(c)) return c.json({ message: "Permission denied" }, 403);

  const authUser = getAuthUser(c);
  const posDevice = await getRequestPosDevice(c, authUser?.id ?? null);
  const payment = await prisma.employeePayment.findUnique({
    where: { id: c.req.param("id") },
    include: {
      employee: true,
      payrollLine: true
    }
  });

  if (!payment || payment.deletedAt) {
    return c.json({ message: "Employee payment not found" }, 404);
  }

  const amount = toNumber(payment.amount);
  const accountType = payment.cashRegisterAccountId ? "CASH" : "BANK";
  const accountId = payment.cashRegisterAccountId || payment.bankAccountId;

  if (!accountId) {
    return c.json({ message: "Payment account is missing" }, 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    let balanceAfter: unknown = null;

    if (accountType === "CASH") {
      const updated = await tx.cashRegisterAccount.update({
        where: { id: accountId },
        data: { balance: { increment: amount } }
      });
      balanceAfter = updated.balance;
    } else {
      const updated = await tx.bankAccount.update({
        where: { id: accountId },
        data: { balance: { increment: amount } }
      });
      balanceAfter = updated.balance;
    }

    const moneyTransaction = await tx.moneyTransaction.create({
      data: {
        currencyId: payment.currencyId,
        cashRegisterAccountId: accountType === "CASH" ? accountId : null,
        bankAccountId: accountType === "BANK" ? accountId : null,
        type: MoneyTransactionType.PAYROLL_PAYMENT,
        direction: MoneyDirection.IN,
        amount,
        balanceAfter: balanceAfter as any,
        exchangeRate: Number(payment.exchangeRate || 1),
        baseCurrencyId: payment.baseCurrencyId,
        baseAmount: toBaseAmount(amount, {
          exchangeRate: Number(payment.exchangeRate || 1),
          baseCurrencyId: payment.baseCurrencyId
        }),
        baseBalanceAfter: toBaseAmount(Number(balanceAfter || 0), {
          exchangeRate: Number(payment.exchangeRate || 1),
          baseCurrencyId: payment.baseCurrencyId
        }),
        referenceType: "EMPLOYEE_PAYMENT_CANCEL",
        referenceId: payment.id,
        createdByUserId: authUser?.id ?? null,
        posDeviceId: posDevice?.id ?? null,
        note: `Cancelled payroll payment for ${payment.employee.fullName}`
      }
    });

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-PAYROLL-CANCEL",
      sourceType: "EMPLOYEE_PAYMENT_CANCEL",
      sourceId: payment.id,
      description: `Cancelled payroll payment for ${payment.employee.fullName}`,
      createdByUserId: authUser?.id ?? null,
      lines: [
        {
          accountCode: treasuryAccountCode(accountType),
          debit: amount,
          exchangeRate: Number(payment.exchangeRate || 1),
          baseCurrencyId: payment.baseCurrencyId,
          note: "Payroll payment cancelled"
        },
        {
          accountCode: "6100",
          credit: amount,
          exchangeRate: Number(payment.exchangeRate || 1),
          baseCurrencyId: payment.baseCurrencyId,
          note: "Payroll expense reversed"
        }
      ]
    });

    const deleted = await tx.employeePayment.update({
      where: { id: payment.id },
      data: {
        deletedAt: new Date(),
        deletedByUserId: authUser?.id ?? null,
        updatedByUserId: authUser?.id ?? null,
        note: payment.note
          ? `${payment.note}\nCancelled by reversal ${moneyTransaction.id}/${journalEntry.id}`
          : `Cancelled by reversal ${moneyTransaction.id}/${journalEntry.id}`
      }
    });

    if (payment.payrollLineId) {
      const line = await tx.payrollLine.findUnique({
        where: { id: payment.payrollLineId }
      });
      if (line) {
        const paidAmount = Math.max(0, toNumber(line.paidAmount) - amount);
        await tx.payrollLine.update({
          where: { id: line.id },
          data: {
            paidAmount,
            remainingAmount: Math.max(0, toNumber(line.grossPay) - paidAmount)
          }
        });
      }
    }

    if (payment.payrollRunId) {
      const lines = await tx.payrollLine.findMany({
        where: { runId: payment.payrollRunId }
      });
      const totalPaid = lines.reduce((sum, line) => sum + toNumber(line.paidAmount), 0);
      const totalEarned = lines.reduce((sum, line) => sum + toNumber(line.grossPay), 0);
      await tx.payrollRun.update({
        where: { id: payment.payrollRunId },
        data: {
          totalPaid,
          totalRemaining: Math.max(0, totalEarned - totalPaid),
          status: totalPaid <= 0 ? PayrollRunStatus.DRAFT : PayrollRunStatus.REVIEWED
        }
      });
    }

    return deleted;
  });

  await writeAudit(c, {
    action: "EMPLOYEE_PAYMENT_CANCELLED",
    entityType: "EmployeePayment",
    entityId: result.id
  });

  return c.json({ message: "Employee payment cancelled", data: result });
});
