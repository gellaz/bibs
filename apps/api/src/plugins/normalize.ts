import { Elysia } from "elysia";
import { deepTrim } from "@/lib/deep-trim";

/**
 * Global plugin that trims leading/trailing whitespace from all string
 * values in the request body before validation runs.
 *
 * This ensures that `minLength: 1` correctly rejects whitespace-only
 * strings and that stored data is always clean.
 */
export const normalize = new Elysia({ name: "normalize" }).onTransform(
	{ as: "global" },
	(ctx) => {
		if (ctx.body !== undefined && ctx.body !== null) {
			ctx.body = deepTrim(ctx.body);
		}
	},
);
