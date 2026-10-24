"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import * as React from "react";
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxCollection,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxGroup,
	ComboboxInput,
	ComboboxItem,
	ComboboxLabel,
	ComboboxList,
	ComboboxTrigger,
	ComboboxValue,
	useComboboxAnchor,
} from "~/components/combobox";
import { cn } from "~/lib/utils";

export type ComboboxOption = {
	value: string;
	label: string;
	/**
	 * Intestazione del gruppo: le opzioni con lo stesso gruppo vanno insieme,
	 * nell'ordine in cui arrivano. La ricerca guarda anche il gruppo.
	 */
	group?: string;
};

type OptionGroup = { value: string; items: ComboboxOption[] };

type BaseProps = {
	options: ComboboxOption[];
	placeholder: string;
	/** Nessuna opzione corrisponde alla ricerca. */
	emptyText: string;
	/** Nome accessibile del pulsante che svuota la scelta (singola) o toglie un chip (multipla). */
	clearLabel: (label: string) => string;
	id?: string;
	/** Ref dell'input: react-hook-form ci sposta il fuoco sul primo errore. */
	ref?: React.Ref<HTMLInputElement>;
	disabled?: boolean;
	className?: string;
	"aria-label"?: string;
	"aria-invalid"?: boolean;
	"aria-describedby"?: string;
};

export type SelectComboboxProps = BaseProps &
	(
		| {
				multiple?: false;
				value: string | null;
				onChange: (value: string | null) => void;
		  }
		| {
				multiple: true;
				value: string[];
				onChange: (value: string[]) => void;
		  }
	);

export function groupOptions(
	options: ComboboxOption[],
): ComboboxOption[] | OptionGroup[] {
	if (!options.some((o) => o.group)) return options;
	const groups = new Map<string, ComboboxOption[]>();
	for (const option of options) {
		const key = option.group ?? "";
		const items = groups.get(key);
		if (items) items.push(option);
		else groups.set(key, [option]);
	}
	return Array.from(groups, ([value, items]) => ({ value, items }));
}

const label = (option: ComboboxOption) => option.label;
const sameOption = (a: ComboboxOption, b: ComboboxOption) =>
	a.value === b.value;

function renderOption(option: ComboboxOption) {
	return (
		<ComboboxItem key={option.value} value={option}>
			{option.label}
		</ComboboxItem>
	);
}

/**
 * La tendina con ricerca di bibs: scelta singola o multipla da un elenco
 * statico, con filtro che ignora accenti e maiuscole. Per un elenco cercato sul
 * server si compone `Combobox` direttamente (vedi la marca del seller).
 */
export function SelectCombobox(props: SelectComboboxProps) {
	const {
		options,
		placeholder,
		emptyText,
		clearLabel,
		id,
		ref,
		disabled,
		className,
	} = props;
	const aria = {
		"aria-label": props["aria-label"],
		"aria-invalid": props["aria-invalid"],
		"aria-describedby": props["aria-describedby"],
	};
	const anchor = useComboboxAnchor();
	const items = React.useMemo(() => groupOptions(options), [options]);
	const grouped = items !== options;
	const { contains } = ComboboxPrimitive.useFilter();
	const filter = (option: ComboboxOption, query: string) =>
		contains(option.label, query) ||
		(option.group !== undefined && contains(option.group, query));

	const content = (
		<ComboboxContent anchor={props.multiple ? anchor : undefined}>
			<ComboboxEmpty>{emptyText}</ComboboxEmpty>
			<ComboboxList>
				{grouped
					? (group: OptionGroup) => (
							<ComboboxGroup key={group.value} items={group.items}>
								<ComboboxLabel>{group.value}</ComboboxLabel>
								<ComboboxCollection>{renderOption}</ComboboxCollection>
							</ComboboxGroup>
						)
					: renderOption}
			</ComboboxList>
		</ComboboxContent>
	);

	if (props.multiple) {
		const selected = props.value
			.map((v) => options.find((o) => o.value === v))
			.filter((o): o is ComboboxOption => !!o);
		const { onChange } = props;
		return (
			<Combobox
				multiple
				autoHighlight
				items={items}
				filter={filter}
				value={selected}
				onValueChange={(next: ComboboxOption[]) =>
					onChange(next.map((o) => o.value))
				}
				itemToStringLabel={label}
				isItemEqualToValue={sameOption}
				disabled={disabled}
			>
				<ComboboxChips ref={anchor} className={cn("w-full", className)}>
					<ComboboxValue>
						{(values: ComboboxOption[]) => (
							<>
								{values.map((o) => (
									<ComboboxChip key={o.value} removeLabel={clearLabel(o.label)}>
										{o.label}
									</ComboboxChip>
								))}
								<ComboboxChipsInput
									id={id}
									ref={ref}
									placeholder={values.length > 0 ? undefined : placeholder}
									disabled={disabled}
									{...aria}
								/>
							</>
						)}
					</ComboboxValue>
					<ComboboxTrigger className="ml-auto" />
				</ComboboxChips>
				{content}
			</Combobox>
		);
	}

	const selected = options.find((o) => o.value === props.value) ?? null;
	const { onChange } = props;
	return (
		<Combobox
			autoHighlight
			items={items}
			filter={filter}
			value={selected}
			onValueChange={(next: ComboboxOption | null) =>
				onChange(next?.value ?? null)
			}
			itemToStringLabel={label}
			isItemEqualToValue={sameOption}
			disabled={disabled}
		>
			<ComboboxInput
				id={id}
				ref={ref}
				placeholder={placeholder}
				disabled={disabled}
				showClear={!!selected && !disabled}
				clearLabel={selected ? clearLabel(selected.label) : undefined}
				className={cn("w-full", className)}
				{...aria}
			/>
			{content}
		</Combobox>
	);
}
