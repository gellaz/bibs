"use client";

import * as React from "react";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "~/components/combobox";

export type MunicipalityOption = {
	id: string;
	name: string;
	provinceAcronym: string;
};

export type MunicipalityComboboxProps = {
	value: string | null;
	onChange: (id: string | null) => void;
	municipalities: MunicipalityOption[] | undefined;
	loading?: boolean;
	error?: boolean;
	placeholder?: string;
	disabled?: boolean;
	id?: string;
	"aria-invalid"?: boolean;
	"aria-describedby"?: string;
};

const VISIBLE_CAP = 50;

function normalize(value: string) {
	return value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
}

type Indexed = MunicipalityOption & { searchKey: string };

function indexMunicipalities(list: MunicipalityOption[]): Indexed[] {
	return list.map((m) => ({
		...m,
		searchKey: `${normalize(m.name)} (${m.provinceAcronym.toLowerCase()})`,
	}));
}

function filterMunicipalities(
	indexed: Indexed[],
	query: string,
): { items: MunicipalityOption[]; total: number } {
	if (!query.trim()) {
		return { items: indexed.slice(0, VISIBLE_CAP), total: indexed.length };
	}
	const q = normalize(query);
	const starts: Indexed[] = [];
	const includes: Indexed[] = [];
	for (const item of indexed) {
		if (item.searchKey.startsWith(q)) starts.push(item);
		else if (item.searchKey.includes(q)) includes.push(item);
	}
	const total = starts.length + includes.length;
	const merged = [...starts, ...includes].slice(0, VISIBLE_CAP);
	return { items: merged, total };
}

function MunicipalityCombobox({
	value,
	onChange,
	municipalities,
	loading = false,
	error = false,
	placeholder = "Cerca comune…",
	disabled,
	id,
	...ariaProps
}: MunicipalityComboboxProps) {
	const [query, setQuery] = React.useState("");

	const indexed = React.useMemo(
		() => (municipalities ? indexMunicipalities(municipalities) : []),
		[municipalities],
	);

	const { items, total } = React.useMemo(
		() => filterMunicipalities(indexed, query),
		[indexed, query],
	);

	const isLoading = loading || municipalities === undefined;
	const triggerDisabled = disabled || isLoading || error;

	const selected =
		value && municipalities
			? (municipalities.find((m) => m.id === value) ?? null)
			: null;

	const computedPlaceholder = error
		? "Impossibile caricare i comuni"
		: isLoading
			? "Caricamento comuni…"
			: placeholder;

	return (
		<Combobox
			items={items}
			filter={null}
			itemToStringLabel={(item: MunicipalityOption) =>
				`${item.name} (${item.provinceAcronym})`
			}
			itemToStringValue={(item: MunicipalityOption) => item.id}
			isItemEqualToValue={(
				itemValue: MunicipalityOption,
				val: MunicipalityOption,
			) => itemValue.id === val.id}
			value={selected}
			onValueChange={(item: MunicipalityOption | null) =>
				onChange(item?.id ?? null)
			}
			onInputValueChange={(next: string) => setQuery(next)}
		>
			<ComboboxInput
				id={id}
				placeholder={computedPlaceholder}
				disabled={triggerDisabled}
				aria-invalid={ariaProps["aria-invalid"]}
				aria-describedby={ariaProps["aria-describedby"]}
				showClear={!!selected}
			/>
			<ComboboxContent>
				<ComboboxList>
					{items.map((item) => (
						<ComboboxItem key={item.id} value={item}>
							{item.name} ({item.provinceAcronym})
						</ComboboxItem>
					))}
				</ComboboxList>
				<ComboboxEmpty>Nessun comune trovato</ComboboxEmpty>
				{total > VISIBLE_CAP && (
					<div className="text-muted-foreground border-t px-3 py-2 text-center text-xs">
						… altri {total - VISIBLE_CAP} risultati, raffina la ricerca
					</div>
				)}
			</ComboboxContent>
		</Combobox>
	);
}

export { MunicipalityCombobox };
