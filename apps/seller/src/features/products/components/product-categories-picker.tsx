import { Checkbox } from "@bibs/ui/components/checkbox";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@bibs/ui/components/command";
import { Label } from "@bibs/ui/components/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@bibs/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@bibs/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";

interface ProductCategoriesPickerProps {
	macroCategoryId: string | null;
	categoryIds: string[];
	onMacroChange: (
		macroId: string | null,
		suggestedVatRate?: "22" | "10" | "5" | "4" | "0",
	) => void;
	onToggleCategory: (categoryId: string) => void;
	required?: boolean;
}

export function ProductCategoriesPicker({
	macroCategoryId,
	categoryIds,
	onMacroChange,
	onToggleCategory,
	required = false,
}: ProductCategoriesPickerProps) {
	const [open, setOpen] = useState(false);

	const { data: macros = [] } = useQuery({
		queryKey: ["product-macro-categories"],
		queryFn: async () => {
			const response = await api()["product-macro-categories"].get({
				query: { page: 1, limit: 100 },
			});
			if (response.error)
				throw new Error("Errore nel caricamento macro-categorie");
			return response.data.data;
		},
	});

	const { data: categories = [] } = useQuery({
		queryKey: ["product-categories", macroCategoryId],
		queryFn: async () => {
			const response = await api()["product-categories"].get({
				query: {
					page: 1,
					limit: 100,
					macroCategoryId: macroCategoryId ?? undefined,
				},
			});
			if (response.error) throw new Error("Errore nel caricamento categorie");
			return response.data.data;
		},
		enabled: !!macroCategoryId,
	});

	const selectedCategories = categories.filter((c) =>
		categoryIds.includes(c.id),
	);

	return (
		<div className="@container grid gap-4 @md:grid-cols-2">
			<div className="space-y-2">
				<Label>Macrocategoria{required && " *"}</Label>
				<Select
					value={macroCategoryId ?? ""}
					onValueChange={(v) =>
						onMacroChange(
							v || null,
							macros.find((m) => m.id === v)?.suggestedVatRate,
						)
					}
				>
					<SelectTrigger className="w-full">
						<SelectValue placeholder="Seleziona una macrocategoria" />
					</SelectTrigger>
					<SelectContent>
						{macros.map((m) => (
							<SelectItem key={m.id} value={m.id}>
								{m.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{macroCategoryId && (
				<div className="space-y-2">
					<Label>Categorie{required && " *"}</Label>
					<Popover open={open} onOpenChange={setOpen}>
						<PopoverTrigger asChild>
							<button
								type="button"
								aria-expanded={open}
								className="border-input dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-8 w-full items-center justify-between gap-1.5 rounded-lg border bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:ring-3"
							>
								<div className="flex flex-wrap items-center gap-1.5">
									{selectedCategories.length === 0 ? (
										<span className="text-muted-foreground">
											Aggiungi categorie…
										</span>
									) : (
										selectedCategories.map((cat) => (
											<span
												key={cat.id}
												className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
											>
												{cat.name}
												{/* biome-ignore lint/a11y/useSemanticElements: a nested <button> inside the PopoverTrigger <button> is invalid HTML; use a span with role=button to keep the X interactive without parent button conflict. */}
												<span
													role="button"
													tabIndex={0}
													aria-label={`Rimuovi ${cat.name}`}
													className="hover:bg-primary-foreground/20 -mr-0.5 flex size-3.5 items-center justify-center rounded-full"
													onClick={(e) => {
														e.stopPropagation();
														onToggleCategory(cat.id);
													}}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") {
															e.preventDefault();
															e.stopPropagation();
															onToggleCategory(cat.id);
														}
													}}
												>
													<XIcon className="size-3" />
												</span>
											</span>
										))
									)}
								</div>
								<ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
							</button>
						</PopoverTrigger>
						<PopoverContent
							className="w-(--radix-popover-trigger-width) p-0"
							align="start"
						>
							<Command>
								<CommandInput placeholder="Cerca categoria…" />
								<CommandList>
									<CommandEmpty>
										Nessuna categoria disponibile per questa macro.
									</CommandEmpty>
									<CommandGroup>
										{categories.map((cat) => {
											const isOn = categoryIds.includes(cat.id);
											return (
												<CommandItem
													key={cat.id}
													value={cat.name}
													onSelect={() => onToggleCategory(cat.id)}
												>
													<Checkbox
														checked={isOn}
														tabIndex={-1}
														aria-hidden
														className="pointer-events-none"
													/>
													{cat.name}
												</CommandItem>
											);
										})}
									</CommandGroup>
								</CommandList>
							</Command>
						</PopoverContent>
					</Popover>
					{categoryIds.length > 0 && (
						<p className="text-muted-foreground text-xs">
							{categoryIds.length} selezionat
							{categoryIds.length === 1 ? "a" : "e"}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
