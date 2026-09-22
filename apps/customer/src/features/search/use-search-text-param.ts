import { useEffect, useRef, useState } from "react";

/**
 * Testo di ricerca controllato, allineato all'URL nei due sensi: si digita e
 * dopo una pausa il parametro si aggiorna; se `q` cambia da fuori (indietro,
 * avanti, link aperto) l'input si riallinea.
 *
 * `onChange` vive in un ref perché il chiamante lo ricrea a ogni render: nella
 * lista di dipendenze rifarebbe partire il timer di continuo, e il debounce
 * non scatterebbe mai.
 */
export function useSearchTextParam(
	q: string | undefined,
	onChange: (next: string | undefined) => void,
	delayMs = 300,
) {
	const [text, setText] = useState(q ?? "");

	// L'assegnazione sta in un effetto (non durante il render) perché il React
	// Compiler rifiuta le scritture a un ref in fase di render; gira prima
	// del debounce dichiarato sotto, quindi il ref è già aggiornato quando
	// scatta il timer.
	const onChangeRef = useRef(onChange);
	useEffect(() => {
		onChangeRef.current = onChange;
	});

	useEffect(() => {
		const id = setTimeout(
			() => onChangeRef.current(text || undefined),
			delayMs,
		);
		return () => clearTimeout(id);
	}, [text, delayMs]);

	// `prevQ` distingue "l'URL è cambiato da fuori" da "l'URL è cambiato perché
	// l'abbiamo appena scritto noi": solo il primo caso deve toccare l'input.
	const prevQ = useRef(q);
	useEffect(() => {
		if (q !== prevQ.current) {
			prevQ.current = q;
			setText(q ?? "");
		}
	}, [q]);

	return [text, setText] as const;
}
