import "dotenv/config";

import { prisma } from "../lib/prisma";
import { readCliArgument } from "../lib/cli-arguments";
import { writeJsonArtifact } from "../lib/json-artifact";

type AttendancePreviewRow = {
  source: string;
  id: string;
  ownerId: string;
  storedLocalDate: string | null;
  derivedLocalDate: string;
};

type CollisionRow = {
  source: string;
  ownerId: string;
  derivedLocalDate: string;
  ids: string[];
  count: bigint | number | string;
};

const output = readCliArgument("output");
const limit = Math.min(1_000, Math.max(1, Number(readCliArgument("limit") || 100)));

try {
  const [rows, collisions] = await Promise.all([
    prisma.$queryRaw<AttendancePreviewRow[]>`
      WITH candidates AS (
        SELECT
          'AttendanceRecord'::text AS source,
          id,
          "employeeId" AS "ownerId",
          "localDate" AS "storedLocalDate",
          TO_CHAR((date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kabul', 'YYYY-MM-DD') AS "derivedLocalDate"
        FROM "AttendanceRecord"
        UNION ALL
        SELECT
          'AttendanceWorkday'::text,
          id,
          "periodId",
          "localDate",
          TO_CHAR((date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kabul', 'YYYY-MM-DD')
        FROM "AttendanceWorkday"
        UNION ALL
        SELECT
          'AttendanceDeviceLock'::text,
          id,
          "deviceId",
          "localDate",
          TO_CHAR((date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kabul', 'YYYY-MM-DD')
        FROM "AttendanceDeviceLock"
      )
      SELECT *
      FROM candidates
      WHERE "storedLocalDate" IS NULL OR "storedLocalDate" <> "derivedLocalDate"
      ORDER BY source, "ownerId", "derivedLocalDate", id
      LIMIT ${limit}
    `,
    prisma.$queryRaw<CollisionRow[]>`
      WITH candidates AS (
        SELECT
          'AttendanceRecord'::text AS source,
          id,
          "employeeId" AS "ownerId",
          TO_CHAR((date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kabul', 'YYYY-MM-DD') AS "derivedLocalDate"
        FROM "AttendanceRecord"
        UNION ALL
        SELECT
          'AttendanceWorkday'::text,
          id,
          "periodId",
          TO_CHAR((date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kabul', 'YYYY-MM-DD')
        FROM "AttendanceWorkday"
        UNION ALL
        SELECT
          'AttendanceDeviceLock'::text,
          id,
          "deviceId",
          TO_CHAR((date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kabul', 'YYYY-MM-DD')
        FROM "AttendanceDeviceLock"
      )
      SELECT
        source,
        "ownerId",
        "derivedLocalDate",
        ARRAY_AGG(id ORDER BY id) AS ids,
        COUNT(*)::bigint AS count
      FROM candidates
      GROUP BY source, "ownerId", "derivedLocalDate"
      HAVING COUNT(*) > 1
      ORDER BY source, "ownerId", "derivedLocalDate"
      LIMIT ${limit}
    `,
  ]);

  const report = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    timeZone: "Asia/Kabul",
    readOnly: true,
    summary: {
      mismatchSampleCount: rows.length,
      collisionGroupCount: collisions.length,
      blocked: collisions.length > 0,
    },
    mismatches: rows,
    collisions: collisions.map((row) => ({ ...row, count: Number(row.count) })),
  };

  if (output) {
    const path = await writeJsonArtifact(output, report);
    console.log(`Attendance local-date preview written to ${path}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (report.summary.blocked) process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
