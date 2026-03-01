import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "@/db";
import { customerProfile } from "@/db/schemas/customer";
import { ServiceError } from "@/lib/errors";
import { betterAuth } from "@/plugins/better-auth";
import { addressesRoutes } from "./routes/addresses";
import { ordersRoutes } from "./routes/orders";
import { pointsRoutes } from "./routes/points";
import { searchRoutes } from "./routes/search";

export const customerModule = new Elysia({ prefix: "/customer" })
	.use(betterAuth)
	// Product search is public (no auth required)
	.use(searchRoutes)
	// Authenticated customer routes
	.guard(
		{
			auth: true,
			detail: {
				security: [{ bearerAuth: [] }],
			},
		},
		(app) =>
			app
				.resolve(async ({ user }) => {
					const profile = await db.query.customerProfile.findFirst({
						where: eq(customerProfile.userId, user.id),
					});

					if (!profile)
						throw new ServiceError(403, "Customer profile not found");
					return { customerProfile: profile };
				})
				.use(addressesRoutes)
				.use(pointsRoutes)
				.use(ordersRoutes),
	);
