import { z } from "zod";

// Gemelli Zod di `lib/schemas/forms/onboarding.ts` (D3 del piano Hono), stessi
// nomi; si aggiungono quando una route migrata li usa. In U11b prendono il
// posto del file TypeBox (`@bibs/api/schemas`).

export const AcceptInviteBody = z.object({
	token: z
		.string()
		.min(1)
		.meta({ description: "Token dell'invito", error: "Token mancante" }),
	password: z.string().min(8).max(128).meta({
		description: "Password (minimo 8, massimo 128 caratteri)",
		error: "La password deve avere almeno 8 caratteri",
	}),
	confirmPassword: z.string().min(8).max(128).meta({
		description: "Conferma password",
		error: "La conferma password deve avere almeno 8 caratteri",
	}),
});
