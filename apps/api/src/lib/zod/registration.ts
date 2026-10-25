import { z } from "zod";
import { zFormat } from "./t";

// Body di /register (in Elysia erano scritti nella route): qui, senza effetti
// all'import, perché li usano anche i casi di parità (`tests/http/parity-cases.ts`).

export const RegisterBody = z.object({
	email: zFormat("email").meta({ description: "Indirizzo email" }),
	password: z.string().min(8).max(128).meta({
		description: "Password (minimo 8, massimo 128 caratteri)",
	}),
});

export const SignInBody = z.object({
	email: zFormat("email").meta({ description: "Indirizzo email" }),
	password: z.string().meta({ description: "Password" }),
});
