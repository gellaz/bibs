// hc type inference with the TypeBox 1 validator (`v`) and typed responses (`send`).
import { hc, type InferRequestType, type InferResponseType } from "hono/client";
import type { AppType } from "./probe-after";

type Eq<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const ok = <T extends true>() => {};

const client = hc<AppType>("http://localhost:3000");

// json: wire type (StaticEncode): t.Date → string | number, t.Integer → string | number (Elysia-shaped)
type DiscIn = InferRequestType<
	(typeof client.seller.discounts)["$post"]
>["json"];
ok<Eq<DiscIn["title"], string>>();
ok<Eq<DiscIn["startsAt"], string | number>>();
ok<Eq<DiscIn["endsAt"], string | number | null | undefined>>();
void client.seller.discounts.$post({
	json: { title: "x", percent: 5, startsAt: "2026-01-01" },
});
// @ts-expect-error startsAt is required
void client.seller.discounts.$post({ json: { title: "x", percent: 5 } });
void client.seller.discounts.$post({
	// @ts-expect-error title must be a string
	json: { title: 1, percent: 5, startsAt: "2026-01-01" },
});

// query: typed from the schema, numbers and booleans allowed (hc stringifies them)
type QIn = InferRequestType<(typeof client.customer.products)["$get"]>["query"];
ok<Eq<QIn["openNow"], boolean | undefined>>();
ok<Eq<QIn["lat"], number | undefined>>();
void client.customer.products.$get({
	query: { page: 2, lat: 45.5, openNow: true },
});
// @ts-expect-error openNow is boolean
void client.customer.products.$get({ query: { openNow: "maybe" } });

// param
void client.echo.param[":n"].$get({ param: { n: 42 }, query: {} });

// response typed from the schema via send(): Date fields come back as the wire type
type Resp = InferResponseType<(typeof client.echo.resp)["$get"], 200>;
ok<Eq<Resp["success"], true>>();
ok<Eq<Resp["data"]["createdAt"], string | number>>();
ok<Eq<Resp["data"]["note"], string | null>>();
// @ts-expect-error passwordHash is not in the response schema (stripped at runtime too)
type _Leak = Resp["data"]["passwordHash"];
