import { Search, X } from "lucide-react";

interface SearchFieldProps {
	value: string;
	onChange: (next: string) => void;
	placeholder: string;
	ariaLabel: string;
	/** Etichetta accessibile del pulsante di pulizia: è un'icona. */
	clearLabel: string;
}

/**
 * Il campo di ricerca di `/products` e `/stores`. Le etichette arrivano dal
 * chiamante: le due pagine cercano cose diverse e devono dirlo.
 *
 * `[&::-webkit-search-cancel-button]:hidden` toglie la X nativa di WebKit, che
 * altrimenti raddoppierebbe la nostra.
 */
export function SearchField({
	value,
	onChange,
	placeholder,
	ariaLabel,
	clearLabel,
}: SearchFieldProps) {
	return (
		<div className="relative">
			<Search
				className="-translate-y-1/2 absolute top-1/2 left-4 size-4.5 text-muted-foreground"
				aria-hidden
			/>
			<input
				type="search"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				aria-label={ariaLabel}
				className="h-12 w-full rounded-lg border border-border bg-background pr-11 pl-11 text-base text-foreground outline-none transition-[color,box-shadow,border-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
			/>
			{value && (
				<button
					type="button"
					onClick={() => onChange("")}
					aria-label={clearLabel}
					className="-translate-y-1/2 absolute top-1/2 right-2 rounded-md p-2 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:focus-ring"
				>
					<X className="size-4" aria-hidden />
				</button>
			)}
		</div>
	);
}
