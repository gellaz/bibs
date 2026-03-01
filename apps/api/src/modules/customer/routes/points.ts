import { Elysia, t } from "elysia";
import { PaginationQuery } from "@/lib/pagination";
import { ok } from "@/lib/responses";
import { okRes, PointTransactionSchema, withErrors } from "@/lib/schemas";
import { withCustomer } from "../context";
import { getPointsHistory } from "../services/points";

export const pointsRoutes = new Elysia().get(
	"/points",
	async (ctx) => {
		const { customerProfile: cp, query } = withCustomer(ctx);
		const data = await getPointsHistory({
			customerProfileId: cp.id,
			balance: cp.points,
			...query,
		});
		return ok(data);
	},
	{
		query: PaginationQuery,
		response: withErrors({
			200: okRes(
				t.Object({
					balance: t.Number(),
					transactions: t.Array(PointTransactionSchema),
					pagination: t.Object({
						page: t.Number(),
						limit: t.Number(),
						total: t.Number(),
					}),
				}),
			),
		}),
		detail: {
			summary: "Saldo e storico punti",
			description:
				"Restituisce il saldo punti corrente e lo storico paginato delle transazioni (earned/redeemed).",
			tags: ["Customer - Points"],
		},
	},
);
