import { Elysia } from "elysia";

export const requestId = new Elysia({ name: "request-id" }).derive(
	{ as: "global" },
	({ set }) => {
		const id = crypto.randomUUID();
		set.headers["x-request-id"] = id;
		return { requestId: id };
	},
);
