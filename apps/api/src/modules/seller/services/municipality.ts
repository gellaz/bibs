/**
 * Shared compact-municipality shape (id + name + province acronym) used across
 * the seller/admin/customer services that join a municipality relation.
 */

/**
 * Drizzle relational-query fragment selecting the compact municipality columns.
 * Spread into a `with:` block under a municipality relation, e.g.
 * `with: { municipality: municipalityCompactWith }`.
 */
export const municipalityCompactWith = {
	columns: { id: true, name: true },
	with: { province: { columns: { acronym: true } } },
} as const;

type RawMunicipalityCompact = {
	id: string;
	name: string;
	province: { acronym: string };
};

/** Flattens a joined municipality row to `{ id, name, provinceAcronym }`. */
export function toMunicipalityCompact(m: RawMunicipalityCompact) {
	return { id: m.id, name: m.name, provinceAcronym: m.province.acronym };
}
