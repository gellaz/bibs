import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { pointTransaction } from "@/db/schemas/points";
import { parsePagination } from "@/lib/pagination";

interface GetPointsHistoryParams {
	customerProfileId: string;
	balance: number;
	page?: number;
	limit?: number;
}

export async function getPointsHistory(params: GetPointsHistoryParams) {
	const { customerProfileId, balance } = params;
	const { page, limit, offset } = parsePagination(params);

	const [transactions, [{ total }]] = await Promise.all([
		db.query.pointTransaction.findMany({
			where: eq(pointTransaction.customerProfileId, customerProfileId),
			orderBy: (pt, { desc }) => [desc(pt.createdAt)],
			limit,
			offset,
		}),
		db
			.select({ total: count() })
			.from(pointTransaction)
			.where(eq(pointTransaction.customerProfileId, customerProfileId)),
	]);

	return { balance, transactions, pagination: { page, limit, total } };
}
