import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@bibs/ui/components/combobox";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

export interface BrandComboboxValue {
	brandId?: string;
	brandName?: string;
}

interface BrandComboboxProps {
	/** Id dell'input, per collegarlo a una `<label htmlFor>`. */
	id?: string;
	value: BrandComboboxValue | null;
	onChange: (next: BrandComboboxValue | null) => void;
	placeholder?: string;
}

/** Un brand esistente (con id) o da creare (solo nome). */
type BrandItem = { brandId?: string; brandName: string };

const sameBrand = (a: BrandItem, b: BrandItem) =>
	a.brandId || b.brandId
		? a.brandId === b.brandId
		: a.brandName === b.brandName;

// Stessa tendina di SelectCombobox, ma l'elenco lo filtra il server e in coda
// c'è la voce per creare il brand scritto.
export function BrandCombobox({
	id,
	value,
	onChange,
	placeholder,
}: BrandComboboxProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");

	const selected: BrandItem | null = value?.brandName
		? { brandId: value.brandId, brandName: value.brandName }
		: null;
	// Il testo uguale al brand scelto non è una ricerca: riaprendo si vede di
	// nuovo tutto l'elenco.
	const search = query === selected?.brandName ? "" : query;
	const deferredQuery = useDeferredValue(search);

	const { data: brands = [] } = useQuery({
		queryKey: ["seller-brands", deferredQuery],
		queryFn: async () => {
			const response = await api().seller.brands.get({
				query: { q: deferredQuery || undefined, limit: 20 },
			});
			return unwrap(response, m.products_brand_load_error()).data;
		},
		enabled: open,
		staleTime: 30_000,
	});

	const trimmed = search.trim();
	const exactMatch = brands.some(
		(b) => b.name.toLowerCase() === trimmed.toLowerCase(),
	);
	const items: BrandItem[] = brands.map((b) => ({
		brandId: b.id,
		brandName: b.name,
	}));
	if (trimmed && !exactMatch) items.push({ brandName: trimmed });

	return (
		<Combobox
			items={items}
			filter={null}
			value={selected}
			onValueChange={(next: BrandItem | null) =>
				onChange(
					next ? { brandId: next.brandId, brandName: next.brandName } : null,
				)
			}
			onOpenChange={setOpen}
			onInputValueChange={(next: string) => setQuery(next)}
			itemToStringLabel={(item: BrandItem) => item.brandName}
			isItemEqualToValue={sameBrand}
			autoHighlight
		>
			<ComboboxInput
				id={id}
				placeholder={placeholder ?? m.products_brand_placeholder()}
				showClear={!!selected}
				clearLabel={
					selected
						? m.common_remove_named({ name: selected.brandName })
						: undefined
				}
				className="w-full"
			/>
			<ComboboxContent>
				<ComboboxEmpty>{m.products_brand_empty()}</ComboboxEmpty>
				<ComboboxList>
					{(item: BrandItem) => (
						<ComboboxItem
							key={item.brandId ?? `new:${item.brandName}`}
							value={item}
						>
							{item.brandId
								? item.brandName
								: m.products_brand_create({ name: item.brandName })}
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}
