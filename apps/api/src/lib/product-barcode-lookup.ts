import { Prisma } from "../generated/prisma/client";
import { normalizeBarcodeText } from "./barcode";
import { prisma } from "./prisma";

export type BarcodeLookupStatus = "FOUND" | "AMBIGUOUS" | "NOT_FOUND";

export async function findProductIdsByBarcode(
  value: string,
  options: { includeDeleted?: boolean; limit?: number } = {},
) {
  const normalized = normalizeBarcodeText(value);

  if (!normalized) return [];

  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT p.id
    FROM "Product" p
    WHERE
      ${options.includeDeleted ? Prisma.sql`TRUE` : Prisma.sql`p."deletedAt" IS NULL`}
      AND (
        p."barcodeNormalized" = ${normalized}
        OR NULLIF(
          replace(
            replace(
              replace(
                replace(
                  regexp_replace(
                    translate(
                      COALESCE(p.barcode, ''),
                      concat(
                        chr(1776), chr(1777), chr(1778), chr(1779), chr(1780),
                        chr(1781), chr(1782), chr(1783), chr(1784), chr(1785),
                        chr(1632), chr(1633), chr(1634), chr(1635), chr(1636),
                        chr(1637), chr(1638), chr(1639), chr(1640), chr(1641)
                      ),
                      '01234567890123456789'
                    ),
                    '[-[:space:]]+',
                    '',
                    'g'
                  ),
                  chr(8203),
                  ''
                ),
                chr(8204),
                ''
              ),
              chr(8205),
              ''
            ),
            chr(8288),
            ''
          ),
          ''
        ) = ${normalized}
      )
    ORDER BY
      (p."deletedAt" IS NULL) DESC,
      p."isActive" DESC,
      p."updatedAt" DESC,
      p.id ASC
    LIMIT ${limit}
  `);

  return rows.map((row) => row.id);
}

export function barcodeLookupStatus(count: number): BarcodeLookupStatus {
  if (count === 0) return "NOT_FOUND";
  if (count === 1) return "FOUND";
  return "AMBIGUOUS";
}
