import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@bibs/ui/components/combobox";
import { Field, FieldDescription, FieldLabel } from "@bibs/ui/components/field";
import { MapPin } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
	GEOCODE_MIN_QUERY,
	type GeocodeSuggestionItem,
	useGeocode,
} from "../hooks/use-geocode";

interface StoreAddressSearchProps {
	onSelect: (suggestion: GeocodeSuggestionItem) => void;
	disabled?: boolean;
}

/**
 * Il campo che compila indirizzo, comune, CAP e posizione. I suggerimenti
 * restano nell'ordine del server (se il testo nomina un comune, i suggerimenti
 * di quel comune vengono prima): da qui `filter={null}`.
 */
export function StoreAddressSearch({
	onSelect,
	disabled,
}: StoreAddressSearchProps) {
	const fieldId = useId();
	const [text, setText] = useState("");
	const [debounced, setDebounced] = useState("");

	// Una richiesta per pausa di digitazione, non una per tasto.
	useEffect(() => {
		const id = setTimeout(() => setDebounced(text), 300);
		return () => clearTimeout(id);
	}, [text]);

	const { data, isFetching, isError } = useGeocode(debounced);
	const suggestions = data ?? [];

	return (
		<Field>
			<FieldLabel htmlFor={fieldId}>Cerca l'indirizzo</FieldLabel>
			<Combobox
				items={suggestions}
				filter={null}
				itemToStringLabel={(item: GeocodeSuggestionItem) => item.label}
				itemToStringValue={(item: GeocodeSuggestionItem) => item.providerRef}
				isItemEqualToValue={(
					a: GeocodeSuggestionItem,
					b: GeocodeSuggestionItem,
				) => a.providerRef === b.providerRef}
				value={null}
				onValueChange={(item: GeocodeSuggestionItem | null) => {
					if (item) onSelect(item);
				}}
				onInputValueChange={(next: string) => setText(next)}
			>
				<ComboboxInput
					id={fieldId}
					placeholder="Es. Via Indipendenza 10, Bologna"
					disabled={disabled}
					showTrigger={false}
				/>
				<ComboboxContent>
					<ComboboxList>
						{suggestions.map((item) => (
							<ComboboxItem key={item.providerRef} value={item}>
								<MapPin
									className="mr-2 size-4 shrink-0 text-muted-foreground"
									aria-hidden
								/>
								{item.label}
							</ComboboxItem>
						))}
					</ComboboxList>
					<ComboboxEmpty>
						{isError
							? "Ricerca non disponibile: compila i campi a mano"
							: debounced.trim().length < GEOCODE_MIN_QUERY
								? "Scrivi via e numero civico"
								: isFetching
									? "Ricerca in corso…"
									: "Nessun indirizzo trovato"}
					</ComboboxEmpty>
				</ComboboxContent>
			</Combobox>
			<FieldDescription>
				Scegli un suggerimento: compila i campi qui sotto e posiziona il negozio
				sulla mappa.
			</FieldDescription>
		</Field>
	);
}
