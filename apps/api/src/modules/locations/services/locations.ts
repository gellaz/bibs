import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { municipality, province } from "@/db/schemas/location";
import { COUNTRIES } from "@/lib/countries";
import { parsePagination } from "@/lib/pagination";

export function listCountries() {
	return COUNTRIES;
}

export async function listRegions() {
	return db.query.region.findMany();
}

interface ListProvincesParams {
	regionId?: string;
}

export async function listProvinces(params: ListProvincesParams) {
	const where = params.regionId
		? eq(province.regionId, params.regionId)
		: undefined;

	return db.query.province.findMany({ where });
}

interface ListMunicipalitiesParams {
	page?: number;
	limit?: number;
	provinceId?: string;
}

export async function listMunicipalities(params: ListMunicipalitiesParams) {
	const { page, limit, offset } = parsePagination(params);
	const where = params.provinceId
		? eq(municipality.provinceId, params.provinceId)
		: undefined;

	const [data, [{ total }]] = await Promise.all([
		// Stable total order over a large reference table — without it, offset
		// paging returns non-deterministic page contents (id tiebreaks equal names).
		db.query.municipality.findMany({
			where,
			orderBy: (m, { asc }) => [asc(m.name), asc(m.id)],
			limit,
			offset,
		}),
		db.select({ total: count() }).from(municipality).where(where),
	]);

	return { data, pagination: { page, limit, total } };
}

export async function listAllMunicipalities() {
	return db
		.select({
			id: municipality.id,
			name: municipality.name,
			provinceAcronym: province.acronym,
		})
		.from(municipality)
		.innerJoin(province, eq(municipality.provinceId, province.id))
		.orderBy(asc(municipality.name));
}
