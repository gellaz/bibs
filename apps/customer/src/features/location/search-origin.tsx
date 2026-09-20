import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { AddressItem } from "@/features/addresses/use-addresses";
import { useAddresses } from "@/features/addresses/use-addresses";
import type { Coords } from "./coords";
import type { SearchOrigin, StoredChoice } from "./search-origin-state";
import {
	bootChoice,
	choiceFromNear,
	findOriginAddress,
	originFromChoice,
	parseStoredChoice,
	STORAGE_KEY,
	serializeChoice,
} from "./search-origin-state";
import type { GeoStatus } from "./use-geolocation";
import { useGeolocation } from "./use-geolocation";

interface SearchOriginValue {
	/** Da dove si sta cercando, adesso. */
	origin: SearchOrigin;
	/** Le coordinate dell'origine, o `null`: è quello che le query vogliono. */
	coords: Coords | null;
	/** Vero finché permessi e rubrica non hanno risposto: la UI non indovina. */
	isBooting: boolean;
	addresses: AddressItem[];
	isAddressesPending: boolean;
	geoStatus: GeoStatus;
	/** La posizione del browser, indipendente dalla scelta: serve al bias del geocoder. */
	gpsCoords: Coords | null;
	chooseGps: () => void;
	chooseAddress: (addressId: string) => void;
	chooseNowhere: () => void;
	/** Chiede la posizione senza cambiare origine (il form della rubrica). */
	requestGps: () => void;
	/**
	 * Fa vincere il `near` di un link, senza mai chiedere permessi.
	 * Restituisce `false` se quel `near` non risolve nulla — l'id di un altro
	 * cliente, o `gps` senza consenso — così la route può ripulire l'URL.
	 */
	adoptNear: (near: string) => boolean;
	pickerOpen: boolean;
	setPickerOpen: (open: boolean) => void;
}

const SearchOriginContext = createContext<SearchOriginValue | null>(null);

function readStoredChoice(): StoredChoice | null {
	try {
		return parseStoredChoice(window.localStorage.getItem(STORAGE_KEY));
	} catch {
		// Storage bloccato (Safari privato, cookie di terze parti): si riparte
		// dalle regole di default, non si esplode.
		return null;
	}
}

/**
 * L'origine della ricerca per tutta l'app autenticata. Sta sopra l'header
 * perché il chip vive lì, e sopra l'`Outlet` perché home, lista, facet e mappa
 * leggono la stessa cosa: prima della PR 3 c'erano due stati GPS scollegati.
 */
export function SearchOriginProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const { data, isPending: isAddressesPending } = useAddresses();
	const addresses = useMemo(() => data ?? [], [data]);
	const {
		coords: gpsCoords,
		status: geoStatus,
		request: requestGps,
	} = useGeolocation();

	// `null` = non ancora deciso. Si legge `localStorage` qui e non in un
	// initializer di `useState` perché l'app è SSR: leggerlo in render
	// significherebbe un'idratazione che non combacia.
	const [choice, setChoice] = useState<StoredChoice | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);
	const booted = useRef(false);

	useEffect(() => {
		if (booted.current) return;
		// Decidere prima di sapere se il permesso c'è e quali indirizzi esistono
		// vorrebbe dire mostrare "Tutta l'Italia" e poi cambiarlo sotto gli occhi.
		if (geoStatus === "probing" || isAddressesPending) return;
		booted.current = true;
		setChoice(
			bootChoice({
				stored: readStoredChoice(),
				addresses,
				gpsUsable: geoStatus === "granted" || geoStatus === "pending",
			}),
		);
	}, [geoStatus, isAddressesPending, addresses]);

	const commit = useCallback((next: StoredChoice) => {
		// Una scelta esplicita arrivata prima del boot vince sul boot.
		booted.current = true;
		setChoice(next);
		try {
			window.localStorage.setItem(STORAGE_KEY, serializeChoice(next));
		} catch {
			// La scelta vale per questa sessione e basta.
		}
	}, []);

	const chooseGps = useCallback(() => {
		commit({ kind: "gps" });
		// Il prompt del browser scatta qui: su un tocco, mai da solo.
		requestGps();
	}, [commit, requestGps]);

	const chooseAddress = useCallback(
		(addressId: string) => commit({ kind: "address", addressId }),
		[commit],
	);

	const chooseNowhere = useCallback(() => commit({ kind: "none" }), [commit]);

	const adoptNear = useCallback(
		(near: string): boolean => {
			const next = choiceFromNear(near);
			// Chi riceve un link non ha chiesto niente: se il permesso non c'è
			// già, `near=gps` non lo chiede — decade a nessuna origine.
			if (next.kind === "gps" && geoStatus !== "granted") {
				commit({ kind: "none" });
				return false;
			}
			// Un id che non è tuo non risolve nulla, e non è un errore da mostrare.
			if (
				next.kind === "address" &&
				!findOriginAddress(addresses, next.addressId)
			) {
				commit({ kind: "none" });
				return false;
			}
			commit(next);
			return true;
		},
		[addresses, commit, geoStatus],
	);

	const origin = useMemo(
		() => originFromChoice(choice, { addresses, gpsCoords }),
		[choice, addresses, gpsCoords],
	);

	const value = useMemo<SearchOriginValue>(
		() => ({
			origin,
			coords: origin.kind === "none" ? null : origin.coords,
			isBooting: choice === null,
			addresses,
			isAddressesPending,
			geoStatus,
			gpsCoords,
			chooseGps,
			chooseAddress,
			chooseNowhere,
			requestGps,
			adoptNear,
			pickerOpen,
			setPickerOpen,
		}),
		[
			origin,
			choice,
			addresses,
			isAddressesPending,
			geoStatus,
			gpsCoords,
			chooseGps,
			chooseAddress,
			chooseNowhere,
			requestGps,
			adoptNear,
			pickerOpen,
		],
	);

	return (
		<SearchOriginContext.Provider value={value}>
			{children}
		</SearchOriginContext.Provider>
	);
}

export function useSearchOrigin() {
	const ctx = useContext(SearchOriginContext);
	if (!ctx) {
		throw new Error("useSearchOrigin va usato dentro SearchOriginProvider");
	}
	return ctx;
}
