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
 * Il Salva delle impostazioni del back-office: con modifiche in sospeso resta
 * in vista in fondo allo schermo; senza, torna al suo posto, a fine sezione.
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
		<div
			className={cn(
				"flex items-center justify-end gap-3",
				dirty &&
					"sticky bottom-0 z-10 -mx-4 border-border border-t bg-background px-4 py-3",
			)}
		>
			{dirty && (
				<p className="mr-auto text-muted-foreground text-sm" role="status">
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
