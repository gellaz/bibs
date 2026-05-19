"use client";

import {
	CircleCheckIcon,
	InfoIcon,
	Loader2Icon,
	OctagonXIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
	const { resolvedTheme } = useTheme();
	const isDark = resolvedTheme === "dark";

	// In dark mode let Sonner default (#000) win — è esattamente l'effetto
	// near-black voluto. In light mode sovrascriviamo a `--popover` per evitare
	// che il toast diventi nero su cream.
	const style = isDark
		? ({
				"--normal-text": "var(--popover-foreground)",
				"--border-radius": "var(--radius)",
			} as React.CSSProperties)
		: ({
				"--normal-bg": "var(--popover)",
				"--normal-text": "var(--popover-foreground)",
				"--normal-border": "var(--border)",
				"--border-radius": "var(--radius)",
			} as React.CSSProperties);

	return (
		<Sonner
			theme={(resolvedTheme ?? "light") as ToasterProps["theme"]}
			className="toaster group"
			icons={{
				success: <CircleCheckIcon className="size-4" />,
				info: <InfoIcon className="size-4" />,
				warning: <TriangleAlertIcon className="size-4" />,
				error: <OctagonXIcon className="size-4" />,
				loading: <Loader2Icon className="size-4 animate-spin" />,
			}}
			style={style}
			toastOptions={{
				classNames: {
					toast: "cn-toast",
				},
			}}
			{...props}
		/>
	);
};

export { toast } from "sonner";
export { Toaster };
