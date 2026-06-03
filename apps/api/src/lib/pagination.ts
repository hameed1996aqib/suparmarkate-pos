import type { Context } from "hono";

export type PagePagination = {
  page: number;
  limit: number;
  skip: number;
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPagePagination(
  c: Context,
  options: { defaultLimit?: number; maxLimit?: number } = {}
): PagePagination {
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 100;
  const page = positiveInteger(c.req.query("page"), 1);
  const limit = Math.min(positiveInteger(c.req.query("limit"), defaultLimit), maxLimit);

  return {
    page,
    limit,
    skip: (page - 1) * limit
  };
}

export function createPaginationMeta(input: {
  page: number;
  limit: number;
  total: number;
}) {
  return {
    page: input.page,
    limit: input.limit,
    total: input.total,
    totalPages: Math.max(1, Math.ceil(input.total / input.limit))
  };
}
