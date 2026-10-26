import { config } from "@/lib/config";

const { defaultLimit } = config.pagination;

/**
 * Parses pagination query params into page, limit, offset.
 */
export function parsePagination(query: { page?: number; limit?: number }) {
	const limit = query.limit ?? defaultLimit;
	const page = query.page ?? 1;
	const offset = (page - 1) * limit;
	return { page, limit, offset };
}
