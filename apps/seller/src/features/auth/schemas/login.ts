import { z } from "zod";
import { m } from "@/paraglide/messages";

export const loginFormSchema = z.object({
	email: z
		.string()
		.min(1, { error: () => m.auth_email_required() })
		.email({ error: () => m.auth_email_invalid() }),
	password: z.string().min(1, { error: () => m.auth_password_required() }),
});

export type LoginFormData = z.infer<typeof loginFormSchema>;
