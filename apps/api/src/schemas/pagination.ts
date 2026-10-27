import { z } from "zod";
import { config } from "@/lib/config";
import { zInteger } from "./t";

const { defaultLimit, maxLimit } = config.pagination;

/** Gemello Zod di `PaginationQuery` (`lib/pagination.ts`). */
export const PaginationQuery = z.object({
	page: zInteger({
		minimum: 1,
		default: 1,
		description: "Numero di pagina",
	}).optional(),
	limit: zInteger({
		minimum: 1,
		maximum: maxLimit,
		default: defaultLimit,
		description: "Elementi per pagina",
	}).optional(),
});
