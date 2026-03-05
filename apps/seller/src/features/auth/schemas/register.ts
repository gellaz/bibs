import { z } from "zod";

export const registerFormSchema = z
	.object({
		email: z
			.string()
			.min(1, "L'email è obbligatoria")
			.email("Email non valida"),
		password: z.string().min(8, "La password deve avere almeno 8 caratteri"),
		confirmPassword: z.string().min(1, "Conferma la password"),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Le password non corrispondono",
		path: ["confirmPassword"],
	});

export type RegisterFormData = z.infer<typeof registerFormSchema>;
