import { Button } from "@bibs/ui/components/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@bibs/ui/components/combobox";
import { Field, FieldLabel } from "@bibs/ui/components/field";
import { LocateFixed, MapPin } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useSearchOrigin } from "@/features/location/search-origin";
import { m } from "@/paraglide/messages";
import type { GeocodeSuggestionItem } from "./use-geocode";
import { useGeocode } from "./use-geocode";

interface AddressSearchProps {
	onSelect: (suggestion: GeocodeSuggestionItem) => void;
	disabled?: boolean;
}

/**
 * Il campo che riempie il form. I suggerimenti restano **nell'ordine in cui
 * arrivano dal server**: quell'ordine è il bias di prossimità, e riordinarli
 * lato client vanificherebbe l'endpoint. Da qui `filter={null}`.
 */
export function AddressSearch({ onSelect, disabled }: AddressSearchProps) {
	const fieldId = useId();
	const [text, setText] = useState("");
	const [debounced, setDebounced] = useState("");
	const { origin, gpsCoords, geoStatus, requestGps } = useSearchOrigin();

	// L'ordine della spec: il GPS se il consenso c'è già, altrimenti l'origine
	// attiva quando è un indirizzo salvato — chi aggiunge il secondo indirizzo
	// di solito lo aggiunge vicino al primo — altrimenti nessun bias.
	const bias =
		geoStatus === "granted"
			? gpsCoords
			: origin.kind === "address"
				? origin.coords
				: null;

	// Una richiesta per pausa di digitazione, non una per tasto.
	useEffect(() => {
		const id = setTimeout(() => setDebounced(text), 300);
		return () => clearTimeout(id);
	}, [text]);

	const { data, isFetching, isError } = useGeocode(debounced, bias);
	const suggestions = data ?? [];

	return (
		<Field>
			<FieldLabel htmlFor={fieldId}>{m.address_search_label()}</FieldLabel>
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
					placeholder={m.address_search_placeholder()}
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
							? m.address_search_unavailable()
							: debounced.trim().length < 3
								? m.address_search_hint()
								: isFetching
									? m.address_search_loading()
									: m.address_search_empty()}
					</ComboboxEmpty>
				</ComboboxContent>
			</Combobox>

			{/* Chiedere la posizione qui non cambia l'origine della ricerca:
			    compilare un indirizzo non è dire "cerca da qui". */}
			{(geoStatus === "idle" ||
				geoStatus === "denied" ||
				geoStatus === "pending") && (
				<Button
					type="button"
					variant="secondary"
					size="sm"
					className="mt-1 min-h-11 self-start sm:min-h-9"
					disabled={geoStatus === "pending"}
					onClick={requestGps}
				>
					<LocateFixed className="size-4" aria-hidden />
					{geoStatus === "pending"
						? m.address_search_locating()
						: m.address_search_use_location()}
				</Button>
			)}
			{geoStatus === "granted" && (
				<p className="mt-1 text-muted-foreground text-xs">
					{m.address_search_nearby_first()}
				</p>
			)}
		</Field>
	);
}
