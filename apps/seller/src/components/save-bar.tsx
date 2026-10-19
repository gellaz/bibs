import { Button } from "@bibs/ui/components/button";
import { cn } from "@bibs/ui/lib/utils";
import { m } from "@/paraglide/messages";

interface SaveBarProps {
	dirty: boolean;
	pending: boolean;
	/** Tiene spento il Salva anche con modifiche (es. orari non validi). */
	disabled?: boolean;
	submitLabel: string;
	pendingLabel: string;
	/** Assente: il bottone fa submit del form che contiene la barra. */
	onSave?: () => void;
	onCancel?: () => void;
}

/**
 * Il Salva delle impostazioni del back-office, sempre in vista: appiccicato in
 * fondo allo schermo mentre si scorre, al suo posto a fine pagina. Va messo come
 * ultimo figlio di una colonna flex che riempie l'altezza: `mt-auto` lo spinge in
 * fondo anche quando la pagina è corta.
 */
export function SaveBar({
	dirty,
	pending,
	disabled = false,
	submitLabel,
	pendingLabel,
	onSave,
	onCancel,
}: SaveBarProps) {
	return (
		// -mx-4/-mb-4 annullano il padding del contenitore della pagina: la barra
		// arriva ai bordi e, a fine pagina, poggia sul fondo.
		// A riposo è chrome come la barra laterale; con modifiche prende il tono
		// «tocca a te» dei badge di stato (12% di fondo, 40% di bordo), ma opaco:
		// il contenuto le scorre sotto.
		<div
			className={cn(
				"sticky bottom-0 z-10 -mx-4 mt-auto -mb-4 flex items-center justify-end gap-3 border-t px-4 py-3 transition-colors duration-200 motion-reduce:transition-none",
				dirty
					? "border-action/40 bg-[color-mix(in_oklab,var(--action)_12%,var(--background))]"
					: "border-border bg-sidebar",
			)}
		>
			{dirty && (
				<p className="mr-auto font-medium text-action text-sm" role="status">
					{m.store_form_unsaved()}
				</p>
			)}
			{onCancel && (
				<Button type="button" variant="outline" onClick={onCancel}>
					{m.common_cancel()}
				</Button>
			)}
			<Button
				type={onSave ? "button" : "submit"}
				onClick={onSave}
				disabled={pending || !dirty || disabled}
			>
				{pending ? pendingLabel : submitLabel}
			</Button>
		</div>
	);
}
