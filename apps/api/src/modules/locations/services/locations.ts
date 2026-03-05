import { count, eq } from "drizzle-orm";
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
		db.query.municipality.findMany({ where, limit, offset }),
		db.select({ total: count() }).from(municipality).where(where),
	]);

	return { data, pagination: { page, limit, total } };
}
