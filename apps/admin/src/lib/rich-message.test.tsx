import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { richMessage } from "./rich-message";

function html(message: string, parts: Record<string, React.ReactNode>) {
	return renderToStaticMarkup(<p>{richMessage(message, parts)}</p>);
}

describe("richMessage", () => {
	it("puts each part where its placeholder is", () => {
		expect(
			html("Stai pagando {amount} per {count} negozi attivi.", {
				amount: <strong>€58.00/mese</strong>,
				count: <strong>2</strong>,
			}),
		).toBe(
			"<p>Stai pagando <strong>€58.00/mese</strong> per <strong>2</strong> negozi attivi.</p>",
		);
	});

	it("follows the word order of the language", () => {
		expect(
			html("{store}: deletion scheduled on {date}", {
				date: <strong>1 Nov</strong>,
				store: "Bottega",
			}),
		).toBe("<p>Bottega: deletion scheduled on <strong>1 Nov</strong></p>");
	});

	it("leaves a placeholder without a part as it is", () => {
		expect(html("Fino al {date}.", {})).toBe("<p>Fino al {date}.</p>");
	});
});
