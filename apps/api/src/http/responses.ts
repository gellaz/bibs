export function ok<T>(data: T) {
	return { success: true as const, data };
}

export function okPage<T>(
	data: T[],
	pagination: { page: number; limit: number; total: number },
) {
	return { success: true as const, data, pagination };
}

export function okMessage(message: string) {
	return { success: true as const, data: null, message };
}

export function errorBody(error: string, message: string) {
	return { success: false as const, error, message };
}
