import { Hono } from "hono";
import { z } from "zod";
import { requireCustomer } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { ok } from "@/lib/responses";
import { PointTransactionSchema } from "@/lib/zod/entities";
import { PaginationQuery } from "@/lib/zod/pagination";
import { okRes, withErrors } from "@/lib/zod/responses";
import { customerSecurity } from "../context";
import { getPointsHistory } from "../services/points";

const PointsResponse = okRes(
	z.object({
		balance: z.number(),
		transactions: z.array(PointTransactionSchema),
		pagination: z.object({
			page: z.number(),
			limit: z.number(),
			total: z.number(),
		}),
	}),
);

export const pointsRoutes = new Hono().get(
	"/points",
	doc({
		response: withErrors({ 200: PointsResponse }),
		detail: {
			summary: "Saldo e storico punti",
			description:
				"Restituisce il saldo punti corrente e lo storico paginato delle transazioni (earned/redeemed).",
			tags: ["Customer - Points"],
			...customerSecurity,
		},
	}),
	v("query", PaginationQuery),
	requireCustomer,
	async (c) => {
		const cp = c.var.customerProfile;
		const data = await getPointsHistory({
			customerProfileId: cp.id,
			balance: cp.points,
			...c.req.valid("query"),
		});
		return send(c, PointsResponse, ok(data));
	},
);
