import { Button } from "@bibs/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@bibs/ui/components/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@bibs/ui/components/popover";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDownIcon, XIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

export interface BrandComboboxValue {
	brandId?: string;
	brandName?: string;
}

interface BrandComboboxProps {
	/** Id del trigger, per collegarlo a una `<label htmlFor>`. */
	id?: string;
	value: BrandComboboxValue | null;
	onChange: (next: BrandComboboxValue | null) => void;
	placeholder?: string;
}

export function BrandCombobox({
	id,
	value,
	onChange,
	placeholder,
}: BrandComboboxProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query);

	const { data: brands = [] } = useQuery({
		queryKey: ["seller-brands", deferredQuery],
		queryFn: async () => {
			const response = await api().seller.brands.get({
				query: { q: deferredQuery || undefined, limit: 20 },
			});
			return unwrap(response, m.products_brand_load_error()).data;
		},
		enabled: open,
		staleTime: 30_000,
	});

	const trimmed = query.trim();
	const exactMatch = brands.some(
		(b) => b.name.toLowerCase() === trimmed.toLowerCase(),
	);
	const showCreateOption = trimmed.length > 0 && !exactMatch;

	const displayLabel =
		value?.brandName ?? placeholder ?? m.products_brand_placeholder();

	return (
		<div className="flex items-center gap-2">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						id={id}
						type="button"
						variant="outline"
						role="combobox"
						aria-expanded={open}
						className="w-full justify-between font-normal"
					>
						<span className={value ? "" : "text-muted-foreground"}>
							{displayLabel}
						</span>
						<ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent
					className="w-[--radix-popover-trigger-width] p-0"
					align="start"
				>
					<Command shouldFilter={false}>
						<CommandInput
							placeholder={m.products_brand_search()}
							value={query}
							onValueChange={setQuery}
						/>
						<CommandList>
							<CommandEmpty>{m.products_brand_empty()}</CommandEmpty>
							{brands.length > 0 && (
								<CommandGroup heading={m.products_brand_existing()}>
									{brands.map((b) => (
										<CommandItem
											key={b.id}
											value={b.id}
											onSelect={() => {
												onChange({ brandId: b.id, brandName: b.name });
												setOpen(false);
												setQuery("");
											}}
										>
											{b.name}
										</CommandItem>
									))}
								</CommandGroup>
							)}
							{showCreateOption && (
								<CommandGroup heading={m.products_brand_new()}>
									<CommandItem
										value={`__create__${trimmed}`}
										onSelect={() => {
											onChange({ brandName: trimmed });
											setOpen(false);
											setQuery("");
										}}
									>
										{m.products_brand_create({ name: trimmed })}
									</CommandItem>
								</CommandGroup>
							)}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			{value && (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					onClick={() => onChange(null)}
					aria-label={m.products_brand_remove()}
				>
					<XIcon className="h-4 w-4" />
				</Button>
			)}
		</div>
	);
}
