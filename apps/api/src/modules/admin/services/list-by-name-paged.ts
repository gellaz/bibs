import { and, asc, count, desc, ilike, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { parsePagination } from "@/lib/pagination";

export interface ListByNameParams {
	page?: number;
	limit?: number;
	search?: string;
	sortBy?: "name" | "createdAt";
	sortOrder?: "asc" | "desc";
}

/**
 * Shared "list rows by name with pagination/search/sort" used by the admin
 * category services. The caller supplies the `findMany` (so it can add its own
 * relations, e.g. `with: { macroCategory }`) and any `extraFilters` beyond the
 * name search; the table provides the `name`/`createdAt` columns + count.
 */
export async function listByNamePaged<Row>(
	table: PgTable & { name: AnyPgColumn; createdAt: AnyPgColumn },
	params: ListByNameParams,
	findMany: (opts: {
		where: SQL | undefined;
		orderBy: SQL;
		limit: number;
		offset: number;
	}) => Promise<Row[]>,
	extraFilters: (SQL | undefined)[] = [],
) {
	const { page, limit, offset } = parsePagination(params);

	const filters = [
		params.search ? ilike(table.name, `%${params.search}%`) : undefined,
		...extraFilters,
	].filter((f): f is SQL => f !== undefined);
	const where =
		filters.length === 0
			? undefined
			: filters.length === 1
				? filters[0]
				: and(...filters);

	const orderBy = (params.sortOrder === "desc" ? desc : asc)(
		params.sortBy === "createdAt" ? table.createdAt : table.name,
	);

	const [data, [{ total }]] = await Promise.all([
		findMany({ where, orderBy, limit, offset }),
		db.select({ total: count() }).from(table).where(where),
	]);

	return { data, pagination: { page, limit, total } };
}
