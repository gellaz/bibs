import { sql } from "drizzle-orm";
import {
	check,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import {
	type GeocodeHit,
	geocodingProviderNames,
} from "@/lib/geocoding/provider";

/**
 * Cache delle risposte del geocoder. La chiave include la cella di bias: senza
 * di essa il ranking di un utente a Milano finirebbe servito a un utente a Roma,
 * perché il bias cambia quali risultati il provider restituisce.
 *
 * Non memorizza il `municipalityId`: la risoluzione del comune è deterministica
 * e locale, quindi correggerla non richiede di invalidare la cache.
 */
/**
 * I valori del CHECK derivati dalla tupla della porta: una fonte di verità sola.
 * `sql.raw` perché un CHECK è DDL e non ammette parametri — i valori sono nostre
 * costanti di compilazione, non input.
 */
const providerCheckValues = geocodingProviderNames
	.map((name) => `'${name}'`)
	.join(", ");

export const geocodingLookup = pgTable(
	"geocoding_lookups",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		provider: text("provider", { enum: geocodingProviderNames }).notNull(),
		/** Query normalizzata: lowercase, spazi collassati. */
		query: text("query").notNull(),
		/** `45.46,9.19` (2 decimali, ~1,1 km) oppure `-` quando non c'è bias. */
		biasCell: text("bias_cell").notNull(),
		results: jsonb("results").$type<GeocodeHit[]>().notNull(),
		fetchedAt: timestamp("fetched_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		unique("geocoding_lookup_key_unique").on(t.provider, t.query, t.biasCell),
		check(
			"geocoding_provider_valid",
			sql`${t.provider} IN (${sql.raw(providerCheckValues)})`,
		),
	],
);
