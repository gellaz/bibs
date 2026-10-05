import { Button } from "@bibs/ui/components/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@bibs/ui/components/sheet";
import { useState } from "react";
import { m } from "@/paraglide/messages";
import { CategoryCharacteristicsPanel } from "./category-characteristics-panel";

interface CategoryRef {
	id: string;
	name: string;
	characteristicCount: number;
	macroCategory: { name: string };
}

/**
 * Il conteggio è anche il comando: la tabella condivisa delle categorie non
 * ha un punto di estensione per le azioni di riga, ma accetta celle
 * arbitrarie. Il pannello si monta solo ad apertura avvenuta, così la lista
 * delle sotto-categorie non scarica 179 volte il dizionario.
 */
export function CategoryCharacteristicsButton({
	category,
}: {
	category: CategoryRef;
}) {
	const [open, setOpen] = useState(false);
	const n = category.characteristicCount;

	return (
		<>
			<Button
				variant="outline"
				size="xs"
				className="rounded-full tabular-nums"
				onClick={() => setOpen(true)}
				aria-label={m.characteristics_manage_aria({ name: category.name })}
			>
				{n === 1
					? m.characteristics_count_one({ count: n })
					: m.characteristics_count({ count: n })}
			</Button>
			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
					<SheetHeader>
						<SheetTitle>{category.name}</SheetTitle>
						<SheetDescription>
							{m.characteristics_matrix_description({
								macro: category.macroCategory.name,
							})}
						</SheetDescription>
					</SheetHeader>
					<div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
						{open && <CategoryCharacteristicsPanel categoryId={category.id} />}
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}
