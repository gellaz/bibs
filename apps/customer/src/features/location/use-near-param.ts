import { useEffect, useRef } from "react";
import { useSearchOrigin } from "./search-origin";
import { nearFromOrigin } from "./search-origin-state";

/**
 * Tiene allineati il parametro `near` dell'URL e l'origine attiva.
 *
 * All'arrivo **vince il link**: `adoptedNear` ricorda quale valore dell'URL è
 * già stato consumato, così non lo si riadotta a ogni render. Un `near` che
 * non risolve nulla (l'indirizzo di un altro cliente, o `gps` senza consenso)
 * viene tolto dall'URL invece di restare lì a promettere un'origine che non
 * c'è.
 *
 * Da lì in poi **vince il chip**: quando l'origine cambia, l'URL la rispecchia,
 * così quello che si condivide è la vista che si sta guardando.
 * `lastOriginKey` parte indefinito di proposito — al primo giro non si scrive
 * niente, altrimenti l'origine ancora in avvio cancellerebbe il `near` del
 * link appena aperto.
 */
export function useNearParam(
	near: string | undefined,
	setNear: (next: string | undefined) => void,
) {
	const { origin, isAddressesPending, adoptNear } = useSearchOrigin();

	// `setNear` vive in un ref perché il chiamante lo ricrea a ogni render, e
	// qui serve stabile dentro gli effetti sotto. L'assegnazione sta in un
	// effetto (non durante il render) perché il React Compiler rifiuta le
	// scritture a un ref in fase di render; gira prima degli altri effetti
	// dichiarati sotto, quindi il ref è già aggiornato quando servono.
	const setNearRef = useRef(setNear);
	useEffect(() => {
		setNearRef.current = setNear;
	});

	const adoptedNear = useRef<string | null>(null);
	useEffect(() => {
		// Un id di indirizzo non si può giudicare finché la rubrica non ha risposto.
		if (isAddressesPending) return;
		const key = near ?? null;
		if (adoptedNear.current === key) return;
		adoptedNear.current = key;
		if (key === null) return;
		if (!adoptNear(key)) setNearRef.current(undefined);
	}, [near, isAddressesPending, adoptNear]);

	const lastOriginKey = useRef<string | null | undefined>(undefined);
	useEffect(() => {
		const key = nearFromOrigin(origin) ?? null;
		const changed =
			lastOriginKey.current !== undefined && lastOriginKey.current !== key;
		lastOriginKey.current = key;
		if (!changed || (near ?? null) === key) return;
		adoptedNear.current = key;
		setNearRef.current(key ?? undefined);
	}, [origin, near]);
}
