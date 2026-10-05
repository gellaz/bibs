import { Fragment, type ReactNode } from "react";

/**
 * Un messaggio tradotto con dentro parti di markup (es. una data in
 * grassetto). Il messaggio arriva da Paraglide con i segnaposto lasciati
 * letterali — `m.key({ date: "{date}" })` — e qui ogni `{nome}` diventa il
 * nodo corrispondente, così la frase resta una sola chiave in ogni lingua.
 * Un segnaposto senza nodo resta com'è.
 */
export function richMessage(
	message: string,
	parts: Record<string, ReactNode>,
): ReactNode[] {
	return message
		.split(/\{(\w+)\}/)
		.map((chunk, i) =>
			i % 2 === 1 ? (
				<Fragment key={`${chunk}-${i}`}>
					{parts[chunk] ?? `{${chunk}}`}
				</Fragment>
			) : (
				chunk
			),
		);
}
