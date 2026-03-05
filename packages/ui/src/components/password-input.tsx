"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/button";
import { Input } from "~/components/input";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">;

export function PasswordInput({ className, ...props }: PasswordInputProps) {
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
				aria-label={showPassword ? "Nascondi password" : "Mostra password"}
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
