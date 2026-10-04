"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/button";
import { Input } from "~/components/input";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type"> & {
	/** Nomi accessibili del bottone mostra/nascondi (default in italiano). */
	labels?: { show: string; hide: string };
};

const DEFAULT_PASSWORD_LABELS = {
	show: "Mostra password",
	hide: "Nascondi password",
};

export function PasswordInput({
	className,
	labels = DEFAULT_PASSWORD_LABELS,
	...props
}: PasswordInputProps) {
	const [showPassword, setShowPassword] = useState(false);

	return (
		<div className="relative">
			<Input
				className={className}
				type={showPassword ? "text" : "password"}
				{...props}
			/>
			<Button
				className="absolute top-0 right-0 h-full px-3 hover:bg-transparent"
				onClick={() => setShowPassword((prev) => !prev)}
				size="icon"
				type="button"
				variant="ghost"
				tabIndex={-1}
				aria-label={showPassword ? labels.hide : labels.show}
			>
				{showPassword ? (
					<EyeOff className="h-4 w-4 text-muted-foreground" />
				) : (
					<Eye className="h-4 w-4 text-muted-foreground" />
				)}
			</Button>
		</div>
	);
}
