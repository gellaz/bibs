"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "~/components/button";
import { cn } from "~/lib/utils";

export interface CopyButtonLabels {
	copy: string;
	copied: string;
}

const DEFAULT_LABELS: CopyButtonLabels = { copy: "Copia", copied: "Copiato" };

interface CopyButtonProps {
	/** Stringa da copiare negli appunti. */
	value: string;
	/**
	 * Etichette accessibili (screen reader): `copy` a riposo, `copied` per 1.5s
	 * dopo un click andato a buon fine. In italiano di default.
	 */
	labels?: Partial<CopyButtonLabels>;
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
	labels: labelOverrides,
	size = "icon-xs",
	className,
}: CopyButtonProps) {
	const labels = { ...DEFAULT_LABELS, ...labelOverrides };
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
			aria-label={copied ? labels.copied : labels.copy}
			className={cn("text-muted-foreground hover:text-foreground", className)}
		>
			{copied ? <CheckIcon /> : <CopyIcon />}
		</Button>
	);
}
