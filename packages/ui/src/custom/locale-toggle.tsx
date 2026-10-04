"use client";

import { ToggleGroup, ToggleGroupItem } from "~/components/toggle-group";
import {
	segmentedTrayClassName,
	segmentedTrayItemClassName,
} from "~/custom/theme-toggle";
import { cn } from "~/lib/utils";

/** Nome di ogni lingua nella lingua stessa: non si traduce. */
const NATIVE_NAMES: Record<string, string> = {
	it: "Italiano",
	en: "English",
};

interface LocaleToggleProps<L extends string> {
	locales: readonly L[];
	value: L;
	onChange: (locale: L) => void;
	/** Etichetta della riga, già tradotta ("Lingua" / "Language"). */
	label: string;
	className?: string;
}

/**
 * Riga "Lingua" con vassoio segmentato IT / EN, gemella di `ThemeToggle`
 * (stesso vassoio, è un `<div>` così non chiude il menu che la ospita). Il
 * runtime Paraglide è di ogni app: il componente riceve locale e callback.
 * Con una sola lingua non c'è niente da scegliere e non renderizza nulla.
 */
export function LocaleToggle<L extends string>({
	locales,
	value,
	onChange,
	label,
	className,
}: LocaleToggleProps<L>) {
	if (locales.length < 2) return null;

	return (
		<div
			className={cn(
				"flex items-center justify-between gap-3 px-2 py-1",
				className,
			)}
		>
			<span className="font-medium text-muted-foreground text-xs">{label}</span>
			<ToggleGroup
				type="single"
				value={value}
				onValueChange={(next) => {
					if (!next || next === value) return;
					onChange(next as L);
				}}
				size="sm"
				spacing={1}
				aria-label={label}
				className={segmentedTrayClassName}
			>
				{locales.map((locale) => {
					const name = NATIVE_NAMES[locale] ?? locale.toUpperCase();
					return (
						<ToggleGroupItem
							key={locale}
							value={locale}
							aria-label={name}
							title={name}
							className={cn(
								"px-2 font-medium text-xs",
								segmentedTrayItemClassName,
							)}
						>
							{locale.toUpperCase()}
						</ToggleGroupItem>
					);
				})}
			</ToggleGroup>
		</div>
	);
}
