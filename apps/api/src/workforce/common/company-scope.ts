import { NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@talenthub/database";

// TODO(auth): once AuthModule lands, company-scoped workforce routes also verify the caller is a
// CompanyMember with an OWNER/ADMIN/HR_MANAGER role; until then this only checks the company exists.
export async function assertCompanyExists(db: PrismaClient, companyId: string): Promise<void> {
  const company = await db.company.findFirst({ where: { id: companyId, deletedAt: null }, select: { id: true } });
  if (!company) {
    throw new NotFoundException(`Company ${companyId} not found`);
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Turns a `take: limit + 1` query result into a page plus the cursor for the next one. */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export function cursorArgs(cursor: string | undefined, limit: number) {
  return {
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}
