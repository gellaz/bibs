import { Checkbox } from "@bibs/ui/components/checkbox";
import { Label } from "@bibs/ui/components/label";

interface ProductCategory {
	id: string;
	name: string;
}

interface ProductCategoryPickerProps {
	categories: ProductCategory[];
	selected: string[];
	onToggle: (categoryId: string) => void;
	required?: boolean;
}

export function ProductCategoryPicker({
	categories,
	selected,
	onToggle,
	required = false,
}: ProductCategoryPickerProps) {
	return (
		<div className="space-y-2">
			<Label>
				Categorie{required && " *"}
				{selected.length > 0 && (
					<span className="ml-1 text-xs font-normal text-muted-foreground">
						({selected.length} selezionat
						{selected.length === 1 ? "a" : "e"})
					</span>
				)}
			</Label>
			{categories.length > 0 ? (
				<div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
					{categories.map((cat) => (
						<label
							key={cat.id}
							htmlFor={`cat-${cat.id}`}
							className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
						>
							<Checkbox
								id={`cat-${cat.id}`}
								checked={selected.includes(cat.id)}
								onCheckedChange={() => onToggle(cat.id)}
							/>
							{cat.name}
						</label>
					))}
				</div>
			) : (
				<p className="text-xs text-muted-foreground">
					Nessuna categoria disponibile
				</p>
			)}
		</div>
	);
}
