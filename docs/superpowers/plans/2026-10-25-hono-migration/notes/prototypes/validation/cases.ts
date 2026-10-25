// Shared request cases for the before (Elysia) / after (Hono) probe.
export type Case = {
	name: string;
	method: string;
	path: string;
	body?: unknown;
	raw?: string;
	headers?: Record<string, string>;
};

const json = (
	name: string,
	method: string,
	path: string,
	body: unknown,
	headers?: Record<string, string>,
): Case => ({
	name,
	method,
	path,
	body,
	headers,
});

export const cases: Case[] = [
	// registration: format, minLength, required
	json("reg-empty", "POST", "/register/customer", {}),
	json("reg-bad-email", "POST", "/register/customer", {
		email: "nope",
		password: "12345678",
	}),
	json("reg-short-pw", "POST", "/register/customer", {
		email: "a@b.it",
		password: "123",
	}),
	json(
		"reg-short-pw-en",
		"POST",
		"/register/customer",
		{ email: "a@b.it", password: "123" },
		{ cookie: "PARAGLIDE_LOCALE=en" },
	),
	json("reg-pw-number", "POST", "/register/customer", {
		email: "a@b.it",
		password: 12345678,
	}),
	// seller discounts body: t.Integer, t.Date, t.Nullable(t.Date), Array maxItems
	json("disc-empty-title", "POST", "/seller/discounts", {
		title: "   ",
		percent: 5,
		startsAt: "2026-01-01",
	}),
	json("disc-percent-150", "POST", "/seller/discounts", {
		title: "x",
		percent: 150,
		startsAt: "2026-01-01",
	}),
	json("disc-percent-float", "POST", "/seller/discounts", {
		title: "x",
		percent: 5.5,
		startsAt: "2026-01-01",
	}),
	json("disc-percent-str", "POST", "/seller/discounts", {
		title: "x",
		percent: "abc",
		startsAt: "2026-01-01",
	}),
	json("disc-percent-numstr-valid", "POST", "/seller/discounts", {
		title: "x",
		percent: "5",
		startsAt: "2026-01-01",
	}),
	json("disc-bad-date", "POST", "/seller/discounts", {
		title: "x",
		percent: 5,
		startsAt: "not-a-date",
	}),
	json("disc-bad-endsAt", "POST", "/seller/discounts", {
		title: "x",
		percent: 5,
		startsAt: "2026-01-01",
		endsAt: "bad",
	}),
	json("disc-missing-startsAt", "POST", "/seller/discounts", {
		title: "x",
		percent: 5,
	}),
	json("disc-valid", "POST", "/seller/discounts", {
		title: "x",
		percent: 5,
		startsAt: "2026-01-01",
		extra: 1,
	}),
	// query coercion: t.Integer / t.Number / t.Boolean / literal union
	{ name: "q-page-0", method: "GET", path: "/seller/discounts?page=0" },
	{ name: "q-page-abc", method: "GET", path: "/seller/discounts?page=abc" },
	{ name: "q-limit-1000", method: "GET", path: "/seller/discounts?limit=1000" },
	{ name: "q-state-bad", method: "GET", path: "/seller/discounts?state=foo" },
	{
		name: "q-valid",
		method: "GET",
		path: "/seller/discounts?page=2&limit=10&state=concluded",
	},
	{
		name: "q-search-lat-bad",
		method: "GET",
		path: "/customer/products?lat=abc",
	},
	{
		name: "q-search-lat-200",
		method: "GET",
		path: "/customer/products?lat=200",
	},
	{
		name: "q-search-openNow-bad",
		method: "GET",
		path: "/customer/products?openNow=maybe",
	},
	{
		name: "q-search-radius-0",
		method: "GET",
		path: "/customer/products?radius=0",
	},
	// unknown route
	{ name: "404", method: "GET", path: "/nope" },
	// body parsing edge cases
	{
		name: "reg-malformed-json",
		method: "POST",
		path: "/register/customer",
		raw: "{bad",
		headers: { "content-type": "application/json" },
	},
	{
		name: "reg-no-content-type",
		method: "POST",
		path: "/register/customer",
		raw: '{"email":"nope","password":"12345678"}',
	},
	{
		name: "reg-text-plain",
		method: "POST",
		path: "/register/customer",
		raw: '{"email":"nope","password":"12345678"}',
		headers: { "content-type": "text/plain" },
	},
];

export function toRequest(c: Case): Request {
	const headers: Record<string, string> = { ...(c.headers ?? {}) };
	let body: string | undefined = c.raw;
	if (c.body !== undefined) {
		headers["content-type"] = "application/json";
		body = JSON.stringify(c.body);
	}
	return new Request(`http://localhost${c.path}`, {
		method: c.method,
		headers,
		body,
	});
}
