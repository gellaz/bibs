import { renderSVG } from "uqr";
import { m } from "@/paraglide/messages";
import { formatPickupCode } from "./pickup-code";

/**
 * QR del codice di ritiro. Sfondo sempre bianco: gli scanner non leggono il QR
 * invertito della dark mode. Il QR codifica solo il codice, mai l'id ordine.
 */
export function PickupQr({ code }: { code: string }) {
	const svg = renderSVG(code, { border: 2 });
	return (
		<figure className="flex flex-col items-center gap-3">
			<div
				role="img"
				aria-label={m.orders_pickup_qr_aria({ code: formatPickupCode(code) })}
				className="size-52 rounded-xl bg-white p-2 [&_svg]:size-full"
				// SVG generato localmente da uqr a partire da un codice di 6 caratteri del nostro alfabeto
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
			<figcaption className="text-center">
				<span className="block text-muted-foreground text-xs">
					{m.orders_pickup_code_label()}
				</span>
				<span className="font-mono font-semibold text-2xl text-foreground tracking-[0.2em]">
					{formatPickupCode(code)}
				</span>
			</figcaption>
		</figure>
	);
}
