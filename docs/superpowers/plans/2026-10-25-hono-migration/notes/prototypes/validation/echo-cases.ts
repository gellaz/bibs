// Cases for the echo apps (what the handler receives / what the client gets).
import type { Case } from "./cases";

const j = (name: string, path: string, body: unknown): Case => ({
	name,
	method: "POST",
	path,
	body,
});

export const echoCases: Case[] = [
	j("body-discount", "/echo/discount", {
		title: "  Saldi  ",
		percent: 10,
		startsAt: "2026-01-01",
		endsAt: null,
		initialProductIds: ["a"],
		extra: "drop me",
	}),
	j("body-discount-intstr", "/echo/discount", {
		title: "x",
		percent: "7",
		startsAt: 1767225600000,
	}),
	j("body-discount-datetime", "/echo/discount", {
		title: "x",
		percent: 7,
		startsAt: "2026-01-01T10:00:00+01:00",
		endsAt: "2026-02-01 10:00:00",
	}),
	{
		name: "query-products",
		method: "GET",
		path: "/echo/products?page=2&lat=45.5&lng=11&openNow=true&onSale=false&minPrice=0&q=%20pane%20&extra=1",
	},
	{ name: "query-products-defaults", method: "GET", path: "/echo/products" },
	{
		name: "query-products-bool-1",
		method: "GET",
		path: "/echo/products?openNow=1",
	},
	{
		name: "query-products-dup",
		method: "GET",
		path: "/echo/products?page=1&page=2",
	},
	{ name: "param-int", method: "GET", path: "/echo/param/42" },
	{ name: "resp-strip", method: "GET", path: "/echo/resp" },
	{ name: "resp-invalid", method: "GET", path: "/echo/resp-invalid" },
	{ name: "resp-error-status", method: "GET", path: "/echo/resp-404" },
];

export const describeValue = (v: unknown): unknown => {
	if (v instanceof Date) return `Date(${v.toISOString()})`;
	if (Array.isArray(v)) return v.map(describeValue);
	if (v && typeof v === "object")
		return Object.fromEntries(
			Object.entries(v).map(([k, x]) => [k, describeValue(x)]),
		);
	return `${typeof v}:${JSON.stringify(v)}`;
};
