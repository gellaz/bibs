import { useCallback, useEffect, useMemo, useState } from "react";

export type CheckboxState = "checked" | "indeterminate" | "unchecked";

export interface UseProductSelectionResult {
	selected: Set<string>;
	isSelected: (id: string) => boolean;
	toggleOne: (id: string) => void;
	toggleAllOnPage: () => void;
	clear: () => void;
	headerCheckboxState: CheckboxState;
}

interface UseProductSelectionParams {
	currentPageIds: string[];
	/** Reset selection when this value changes (e.g. statusFilter). */
	resetKey: string;
}

export function useProductSelection({
	currentPageIds,
	resetKey,
}: UseProductSelectionParams): UseProductSelectionResult {
	const [selected, setSelected] = useState<Set<string>>(new Set());

	useEffect(() => {
		setSelected(new Set());
	}, [resetKey]);

	const isSelected = useCallback((id: string) => selected.has(id), [selected]);

	const toggleOne = useCallback((id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const toggleAllOnPage = useCallback(() => {
		setSelected((prev) => {
			const allSelected =
				currentPageIds.length > 0 && currentPageIds.every((id) => prev.has(id));
			if (allSelected) {
				const next = new Set(prev);
				for (const id of currentPageIds) next.delete(id);
				return next;
			}
			const next = new Set(prev);
			for (const id of currentPageIds) next.add(id);
			return next;
		});
	}, [currentPageIds]);

	const clear = useCallback(() => setSelected(new Set()), []);

	const headerCheckboxState = useMemo<CheckboxState>(() => {
		if (currentPageIds.length === 0) return "unchecked";
		const selectedOnPage = currentPageIds.filter((id) =>
			selected.has(id),
		).length;
		if (selectedOnPage === 0) return "unchecked";
		if (selectedOnPage === currentPageIds.length) return "checked";
		return "indeterminate";
	}, [currentPageIds, selected]);

	return {
		selected,
		isSelected,
		toggleOne,
		toggleAllOnPage,
		clear,
		headerCheckboxState,
	};
}
