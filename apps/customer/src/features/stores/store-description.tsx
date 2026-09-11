import { useEffect, useRef, useState } from "react";
import { m } from "@/paraglide/messages";

/**
 * La voce del negoziante. Nel rail da ~300px una descrizione lunga diventa un
 * nastro da 400px che spinge orari e mappa fuori dallo schermo: la tagliamo a
 * sei righe e offriamo l'apertura.
 *
 * "Leggi tutto" compare solo se il testo viene davvero tagliato, e la misura si
 * rifà a ogni cambio di larghezza della colonna (ResizeObserver): a 1280px il
 * rail è più largo e lo stesso testo può starci tutto.
 */
export function StoreDescription({
	text,
	clampClassName = "line-clamp-6",
}: {
	text: string;
	/** Taglio a riposo: più corto nel rail, più generoso a colonna piena. */
	clampClassName?: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);
	const bodyRef = useRef<HTMLParagraphElement>(null);

	useEffect(() => {
		const el = bodyRef.current;
		if (!el || expanded) return;
		const measure = () => setOverflows(el.scrollHeight - el.clientHeight > 1);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [expanded, text]);

	return (
		<div className="space-y-1.5">
			<p
				ref={bodyRef}
				className={`whitespace-pre-line text-muted-foreground text-sm leading-relaxed ${
					expanded ? "" : clampClassName
				}`}
			>
				{text}
			</p>
			{overflows && (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => setExpanded((v) => !v)}
					className="-my-1.5 rounded-sm py-1.5 font-medium text-primary text-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-saffron focus-visible:ring-offset-2 focus-visible:ring-offset-background"
				>
					{expanded ? m.store_read_less() : m.store_read_more()}
				</button>
			)}
		</div>
	);
}
