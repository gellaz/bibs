import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { municipality, province } from "@/db/schemas/location";
import { store, storePhoneNumber } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
import { storeImage } from "@/db/schemas/store-image";
import { ServiceError } from "@/lib/errors";
import type {
	CustomClosure,
	OpeningHoursDay,
	OpenStatus,
} from "@/lib/holidays";
import { resolveOpenStatuses } from "@/lib/store-open-status";
import { publiclyVisibleStore } from "@/lib/store-visibility";

export interface StoreDetail {
	id: string;
	name: string;
	description: string | null;
	category: { id: string; name: string } | null;
	municipality: { id: string; name: string; provinceAcronym: string };
	addressLine1: string;
	addressLine2: string | null;
	zipCode: string;
	coordinates: { lat: number; lng: number } | null;
	images: { id: string; url: string }[];
	phoneNumbers: { id: string; label: string | null; number: string }[];
	websiteUrl: string | null;
	openingHours: OpeningHoursDay[] | null;
	openStatus: OpenStatus;
}

export async function getStoreDetail(id: string): Promise<StoreDetail> {
	const [row] = await db
		.select({
			id: store.id,
			name: store.name,
			description: store.description,
			addressLine1: store.addressLine1,
			addressLine2: store.addressLine2,
			zipCode: store.zipCode,
			websiteUrl: store.websiteUrl,
			location: store.location,
			openingHours: store.openingHours,
			closures: store.closures,
			categoryId: store.categoryId,
			categoryName: storeCategory.name,
			municipalityId: municipality.id,
			municipalityName: municipality.name,
			provinceAcronym: province.acronym,
		})
		.from(store)
		.innerJoin(municipality, eq(municipality.id, store.municipalityId))
		.innerJoin(province, eq(province.id, municipality.provinceId))
		.leftJoin(storeCategory, eq(storeCategory.id, store.categoryId))
		.where(and(eq(store.id, id), publiclyVisibleStore()))
		.limit(1);

	if (!row) throw new ServiceError(404, "Negozio non trovato");

	const [images, phoneNumbers] = await Promise.all([
		db
			.select({ id: storeImage.id, url: storeImage.url })
			.from(storeImage)
			.where(eq(storeImage.storeId, id))
			.orderBy(asc(storeImage.position)),
		db
			.select({
				id: storePhoneNumber.id,
				label: storePhoneNumber.label,
				number: storePhoneNumber.number,
			})
			.from(storePhoneNumber)
			.where(eq(storePhoneNumber.storeId, id))
			.orderBy(asc(storePhoneNumber.position)),
	]);

	const statusMap = await resolveOpenStatuses(
		[
			{
				id: row.id,
				openingHours: row.openingHours as OpeningHoursDay[] | null,
				closures: row.closures as CustomClosure[] | null,
			},
		],
		new Date(),
	);

	return {
		id: row.id,
		name: row.name,
		description: row.description,
		category:
			row.categoryId && row.categoryName
				? { id: row.categoryId, name: row.categoryName }
				: null,
		municipality: {
			id: row.municipalityId,
			name: row.municipalityName,
			provinceAcronym: row.provinceAcronym,
		},
		addressLine1: row.addressLine1,
		addressLine2: row.addressLine2,
		zipCode: row.zipCode,
		coordinates: row.location
			? { lat: row.location.y, lng: row.location.x }
			: null,
		images,
		phoneNumbers,
		websiteUrl: row.websiteUrl,
		openingHours: row.openingHours as OpeningHoursDay[] | null,
		openStatus: statusMap.get(row.id) ?? { isOpen: false, status: "closed" },
	};
}
