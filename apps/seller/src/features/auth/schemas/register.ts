import { z } from "zod";
import { m } from "@/paraglide/messages";

export const registerFormSchema = z
	.object({
		email: z
			.string()
			.min(1, { error: () => m.auth_email_required() })
			.email({ error: () => m.auth_email_invalid() }),
		password: z.string().min(8, { error: () => m.auth_password_min() }),
		confirmPassword: z
			.string()
			.min(1, { error: () => m.auth_confirm_password_required() }),
	})
	.refine((data) => data.password === data.confirmPassword, {
		error: () => m.auth_password_mismatch(),
		path: ["confirmPassword"],
	});

export type RegisterFormData = z.infer<typeof registerFormSchema>;
