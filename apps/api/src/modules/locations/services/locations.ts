import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { municipality, province } from "@/db/schemas/location";
import { COUNTRIES } from "@/modules/locations/services/countries";

export function listCountries() {
	return COUNTRIES;
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
