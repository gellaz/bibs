import {
	type CategorySelection,
	expandedMacroId,
	isMacroActive,
	selectAllCategories,
	toggleCategory,
	toggleMacro,
} from "./category-selection";
import { CategoryRow, CategorySkeleton } from "./primitives";

interface FacetNode {
	id: string;
	name: string;
}

interface CategoryTreeProps<T extends FacetNode> {
	macros: (T & { categories: T[] })[];
	/** Il conteggio da mostrare: negozi o prodotti, secondo il rail. */
	count: (node: T) => number;
	allLabel: string;
	total: number;
	isPending: boolean;
	value: CategorySelection;
	onSelect: (next: CategorySelection) => void;
}

/** Albero macro → categoria del rail, con la riga "Tutte" in testa. */
export function CategoryTree<T extends FacetNode>({
	macros,
	count,
	allLabel,
	total,
	isPending,
	value,
	onSelect,
}: CategoryTreeProps<T>) {
	if (isPending) return <CategorySkeleton />;

	const { macroCategoryId, categoryId } = value;
	const expandedId = expandedMacroId(macros, value);

	return (
		<div className="-mx-2">
			<CategoryRow
				label={allLabel}
				count={total}
				active={!macroCategoryId && !categoryId}
				depth={0}
				onClick={() => onSelect(selectAllCategories())}
			/>
			{macros.map((macro) => {
				const isExpanded = expandedId === macro.id;
				return (
					<div key={macro.id}>
						<CategoryRow
							label={macro.name}
							count={count(macro)}
							active={isMacroActive(value, macro.id)}
							depth={0}
							expandable
							expanded={isExpanded}
							onClick={() => onSelect(toggleMacro(value, macro.id))}
						/>
						{isExpanded &&
							macro.categories.map((category) => (
								<CategoryRow
									key={category.id}
									label={category.name}
									count={count(category)}
									active={categoryId === category.id}
									depth={1}
									onClick={() =>
										onSelect(toggleCategory(value, macro.id, category.id))
									}
								/>
							))}
					</div>
				);
			})}
		</div>
	);
}
