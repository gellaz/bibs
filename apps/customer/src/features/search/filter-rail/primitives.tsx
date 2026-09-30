import { Skeleton } from "@bibs/ui/components/skeleton";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";

/**
 * Focus del register brand: alone saffron con l'anello Ink appena fuori. Il
 * saffron da solo non arriva al 3:1 richiesto a un indicatore di focus, è
 * l'Ink a portare il contrasto (The Focus Contrast Rule in DESIGN.md).
 */
export const FOCUS_RING =
	"outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron";

const ROW = `flex min-h-11 w-full items-center gap-2 rounded-md py-2 pr-2 text-left transition-colors lg:min-h-9 ${FOCUS_RING}`;

/**
 * Intestazione di sezione del rail: la stessa voce sottile della scheda
 * negozio — il peso tipografico resta ai risultati, non ai filtri.
 */
export function FilterSection({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-2">
			<h2 className="font-medium text-[0.8125rem] text-foreground tracking-[0.04em]">
				{title}
			</h2>
			{children}
		</section>
	);
}

/** Conteggio a destra di una riga: misura, quindi mono e tabellare. */
function Count({ value }: { value: number }) {
	return (
		<span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
			{value}
		</span>
	);
}

/**
 * Riga di categoria. Lo stato attivo è Ink (tinta + testo): sul customer il
 * saffron è riservato ai momenti-segnale (ricompensa, civico, presenza), la
 * selezione di un filtro non è uno di quelli.
 */
export function CategoryRow({
	label,
	count,
	active,
	depth,
	expandable,
	expanded,
	onClick,
}: {
	label: string;
	count: number;
	active: boolean;
	depth: 0 | 1;
	expandable?: boolean;
	expanded?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-expanded={expandable ? expanded : undefined}
			aria-current={active ? "true" : undefined}
			className={`${ROW} ${depth === 1 ? "pl-8 text-[0.8125rem]" : "pl-2 text-sm"} ${
				active
					? "bg-primary/10 font-medium text-primary"
					: "text-muted-foreground hover:bg-muted hover:text-foreground"
			}`}
		>
			{expandable ? (
				<ChevronRight
					aria-hidden
					className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${
						expanded ? "rotate-90" : ""
					}`}
				/>
			) : (
				depth === 0 && (
					<span aria-hidden className="-ml-0.5 size-3.5 shrink-0" />
				)
			)}
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<Count value={count} />
		</button>
	);
}

/**
 * Riga a interruttore: stessa geometria di `CategoryRow` — è lo stesso gesto
 * nello stesso rail — ma `aria-pressed`, perché qui si accende un filtro
 * invece di scegliere fra alternative. A zero resta visibile e spenta: "nessuno
 * aperto adesso" è una risposta, non rumore da nascondere.
 */
export function ToggleRow({
	icon: Icon,
	label,
	count,
	active,
	disabled,
	onClick,
}: {
	icon: LucideIcon;
	label: string;
	count: number;
	active: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-pressed={active}
			className={`${ROW} pl-2 text-sm disabled:cursor-not-allowed ${
				active
					? "bg-primary/10 font-medium text-primary"
					: "text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-60"
			}`}
		>
			<Icon className="-ml-0.5 size-3.5 shrink-0" aria-hidden />
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<Count value={count} />
		</button>
	);
}

export function CategorySkeleton() {
	return (
		<div className="space-y-1.5 py-1" aria-hidden>
			{[72, 58, 80, 64, 70, 54].map((w) => (
				<Skeleton key={w} className="h-6" style={{ width: `${w}%` }} />
			))}
		</div>
	);
}

export function RadiusPill({
	label,
	active,
	disabled,
	onClick,
}: {
	label: string;
	active: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`inline-flex min-h-11 items-center justify-center rounded-full border px-3 font-medium text-xs transition-colors disabled:cursor-not-allowed lg:min-h-7 lg:px-2.5 ${FOCUS_RING} ${
				active
					? "border-primary bg-primary text-primary-foreground"
					: "border-border text-muted-foreground enabled:hover:border-primary/40 enabled:hover:text-foreground disabled:border-dashed"
			}`}
		>
			{label}
		</button>
	);
}
