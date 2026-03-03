import { z } from "zod";

export const registerFormSchema = z
	.object({
		name: z.string().min(1, "Il nome è obbligatorio"),
		email: z
			.string()
			.min(1, "L'email è obbligatoria")
			.email("Email non valida"),
		password: z.string().min(8, "La password deve avere almeno 8 caratteri"),
		confirmPassword: z.string().min(1, "Conferma la password"),
		vatNumber: z
			.string()
			.regex(/^\d{11}$/, "La partita IVA deve essere di 11 cifre"),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Le password non corrispondono",
		path: ["confirmPassword"],
	});

export type RegisterFormData = z.infer<typeof registerFormSchema>;
