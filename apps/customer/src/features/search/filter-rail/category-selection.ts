/** La parte del valore dei filtri che l'albero delle categorie legge e scrive. */
export interface CategorySelection {
	macroCategoryId?: string;
	categoryId?: string;
}

interface MacroNode {
	id: string;
	categories: { id: string }[];
}

/**
 * La macro aperta è quella che contiene la selezione: nessuno stato separato
 * da tenere in sincrono, e l'URL descrive già tutta la vista.
 */
export function expandedMacroId(
	macros: MacroNode[],
	{ macroCategoryId, categoryId }: CategorySelection,
): string | undefined {
	return (
		macroCategoryId ??
		macros.find((mc) => mc.categories.some((c) => c.id === categoryId))?.id
	);
}

export function isMacroActive(
	{ macroCategoryId, categoryId }: CategorySelection,
	macroId: string,
): boolean {
	return macroCategoryId === macroId && !categoryId;
}

export function selectAllCategories(): CategorySelection {
	return { macroCategoryId: undefined, categoryId: undefined };
}

/**
 * Ri-cliccare la macro già selezionata la chiude e torna a "Tutte": un solo
 * gesto per aprire e per annullare.
 */
export function toggleMacro(
	selection: CategorySelection,
	macroId: string,
): CategorySelection {
	return {
		macroCategoryId: isMacroActive(selection, macroId) ? undefined : macroId,
		categoryId: undefined,
	};
}

/** Ri-cliccare la categoria scelta la toglie e resta sulla sua macro. */
export function toggleCategory(
	{ categoryId }: CategorySelection,
	macroId: string,
	nextCategoryId: string,
): CategorySelection {
	return {
		macroCategoryId: macroId,
		categoryId: categoryId === nextCategoryId ? undefined : nextCategoryId,
	};
}
