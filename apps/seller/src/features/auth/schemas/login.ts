import { z } from "zod";

export const loginFormSchema = z.object({
	email: z.string().min(1, "L'email è obbligatoria").email("Email non valida"),
	password: z.string().min(1, "La password è obbligatoria"),
});

export type LoginFormData = z.infer<typeof loginFormSchema>;
