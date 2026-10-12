import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { VerifyLinkNotice } from "./verify-link-notice";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

function text(node: React.ReactElement) {
	return renderToStaticMarkup(node)
		.replace(/<[^>]+>/g, "")
		.trim();
}

describe("VerifyLinkNotice", () => {
	it("dopo la verifica dice di accedere per continuare la registrazione", () => {
		overwriteGetLocale(() => "it");
		expect(text(<VerifyLinkNotice verified />)).toContain(
			"Accedi per continuare la registrazione",
		);
	});

	it("con un errore dice che il link non vale, anche se c'è verified", () => {
		overwriteGetLocale(() => "it");
		const out = text(<VerifyLinkNotice verified error="TOKEN_EXPIRED" />);
		expect(out).toContain("Il link non è più valido");
		expect(out).not.toContain("Email confermata");
	});

	// Il token scade dopo un'ora anche per chi ha già confermato l'email e
	// riapre il link: il banner non deve dare per scontato che serva un reinvio.
	it("con un errore non dà per scontato che l'email sia ancora da confermare", () => {
		overwriteGetLocale(() => "it");
		expect(text(<VerifyLinkNotice error="TOKEN_EXPIRED" />)).toContain(
			"non è ancora confermata",
		);
	});

	it("senza parametri non mostra niente", () => {
		expect(renderToStaticMarkup(<VerifyLinkNotice />)).toBe("");
	});
});
