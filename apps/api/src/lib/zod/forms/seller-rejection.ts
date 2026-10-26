import { z } from "zod";
import { zString } from "@/lib/schemas/t";

// Gemello Zod di `RejectSellerBody` (`lib/schemas/forms/seller-rejection.ts`,
// D3 del piano Hono). `SELLER_REJECTION_REASONS` è un dato, non uno schema:
// resta lì.

export const RejectSellerBody = z.object({
	reason: zString({
		minLength: 1,
		maxLength: 500,
		pattern: "\\S",
		description: "Motivo del rifiuto, mostrato al venditore e nell'email",
		error: "Indica il motivo del rifiuto",
	}),
	fixStep: z
		.union([z.literal("document"), z.literal("company"), z.null()])
		.meta({ description: "Step da correggere; null = rifiuto definitivo" }),
});
