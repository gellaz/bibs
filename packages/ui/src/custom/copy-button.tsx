"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "~/components/button";
import { cn } from "~/lib/utils";

interface CopyButtonProps {
	/** Stringa da copiare negli appunti. */
	value: string;
	/**
	 * Etichetta accessibile (screen reader). Default: "Copia". Quando il click
	 * va a buon fine diventa "Copiato" per 1.5s.
	 */
	label?: string;
	/** Override del size del Button. Default: `icon-xs` (24×24, icona 12px). */
	size?: "icon-xs" | "icon-sm" | "icon";
	className?: string;
}

/**
 * Bottone icona per copiare un valore negli appunti. Feedback via swap icona
 * (Copy → Check) per 1.5s. Fallisce silenziosamente se `navigator.clipboard`
 * non è disponibile (contesto insicuro, permessi denegati).
 */
export function CopyButton({
	value,
	label = "Copia",
	size = "icon-xs",
	className,
}: CopyButtonProps) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
		} catch {
			// Clipboard API non disponibile (HTTP, permessi, ecc.) — silent.
		}
	}

	return (
		<Button
			type="button"
			variant="ghost"
			size={size}
			onClick={handleCopy}
			aria-label={copied ? "Copiato" : label}
			className={cn("text-muted-foreground hover:text-foreground", className)}
		>
			{copied ? <CheckIcon /> : <CopyIcon />}
		</Button>
	);
}
