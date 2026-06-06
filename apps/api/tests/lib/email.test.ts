import { afterEach, describe, expect, it, mock } from "bun:test";
import { sendEmailToMailpit, toMailpitPayload } from "@/lib/email";

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

const params = {
	to: "user@test.com",
	subject: "Oggetto di prova",
	html: "<p>Ciao</p>",
};

describe("toMailpitPayload", () => {
	it("maps our lowercase params to Mailpit's PascalCase send body", () => {
		expect(toMailpitPayload(params)).toEqual({
			From: { Email: "noreply@bibs.it", Name: "bibs" },
			To: [{ Email: "user@test.com" }],
			Subject: "Oggetto di prova",
			HTML: "<p>Ciao</p>",
		});
	});
});

describe("sendEmailToMailpit", () => {
	it("POSTs the payload to {baseUrl}/api/v1/send and returns true on 2xx", async () => {
		const fetchMock = mock(
			async () =>
				new Response(JSON.stringify({ ID: "abc123" }), { status: 200 }),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const delivered = await sendEmailToMailpit(
			params,
			"http://mailpit.test:8025",
		);

		expect(delivered).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("http://mailpit.test:8025/api/v1/send");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body as string)).toEqual(toMailpitPayload(params));
	});

	it("returns false when Mailpit is unreachable (fetch rejects)", async () => {
		globalThis.fetch = mock(async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;

		expect(await sendEmailToMailpit(params, "http://mailpit.test:8025")).toBe(
			false,
		);
	});

	it("returns false on a non-2xx response", async () => {
		globalThis.fetch = mock(
			async () => new Response("boom", { status: 500 }),
		) as unknown as typeof fetch;

		expect(await sendEmailToMailpit(params, "http://mailpit.test:8025")).toBe(
			false,
		);
	});
});
