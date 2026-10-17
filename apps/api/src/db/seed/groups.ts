import { parseArgs } from "node:util";

export const SEED_ONLY = ["admin", "customer", "seller"] as const;
export type SeedOnly = (typeof SEED_ONLY)[number];

export interface SeedGroups {
	customer: boolean;
	seller: boolean;
	orders: boolean;
}

// Admin e pricing_config girano sempre; gli ordini servono customer e seller
// insieme, quindi solo nel seed completo.
export function seedGroups(only?: SeedOnly): SeedGroups {
	if (!only) return { customer: true, seller: true, orders: true };
	return {
		customer: only === "customer",
		seller: only === "seller",
		orders: false,
	};
}

export function parseSeedArgs(argv: string[]): SeedOnly | undefined {
	const usage = `Uso: db:seed [--only=<gruppo>] — gruppi: ${SEED_ONLY.join(", ")}`;
	let only: string | undefined;
	try {
		only = parseArgs({
			args: argv,
			strict: true,
			options: { only: { type: "string" } },
		}).values.only;
	} catch {
		throw new Error(usage);
	}
	if (only === undefined) return undefined;
	if (!(SEED_ONLY as readonly string[]).includes(only)) throw new Error(usage);
	return only as SeedOnly;
}
