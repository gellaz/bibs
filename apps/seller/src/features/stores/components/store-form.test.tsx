import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { StoreForm } from "./store-form";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

// Fasce sovrapposte: validateOpeningHours le segna come errore.
const overlapping = [
	{
		dayOfWeek: 0,
		slots: [
			{ open: "09:00", close: "13:00" },
			{ open: "12:00", close: "18:00" },
		],
	},
];

describe("StoreForm con hideHours", () => {
	it("orari salvati non validi non bloccano il Salva di una scheda che non li mostra", () => {
		overwriteGetLocale(() => "it");
		const html = renderToStaticMarkup(
			<QueryClientProvider client={new QueryClient()}>
				<StoreForm
					onSubmit={() => {}}
					isPending={false}
					submitLabel="Salva"
					defaultValues={{ name: "Bottega", openingHours: overlapping }}
					hideHours
					extraDirty
				/>
			</QueryClientProvider>,
		);
		expect(html).not.toContain("Orari di apertura");
		// Abilitato = nessun disabled tra type="submit" e la chiusura del tag.
		expect(html).toMatch(/type="submit">Salva<\/button>/);
	});
});
