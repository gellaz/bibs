import { z } from "zod";
import { zFormat, zString } from "./t";

// Body di /register (fino a U4 scritti nella route): qui, senza effetti
// all'import, perché li usano anche i casi di parità (`tests/unit/http/parity-cases.ts`).

export const RegisterBody = z.object({
	email: zFormat("email").meta({ description: "Indirizzo email" }),
	password: zString({
		minLength: 8,
		maxLength: 128,
		description: "Password (minimo 8, massimo 128 caratteri)",
	}),
});

export const SignInBody = z.object({
	email: zFormat("email").meta({ description: "Indirizzo email" }),
	password: z.string().meta({ description: "Password" }),
});
