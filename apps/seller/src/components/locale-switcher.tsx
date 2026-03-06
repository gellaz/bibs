import { Button } from "@bibs/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import { GlobeIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { getLocale, locales, setLocale } from "@/paraglide/runtime";

const LOCALE_LABELS: Record<string, string> = {
	it: "Italiano",
	en: "English",
};

export default function LocaleSwitcher() {
	const currentLocale = getLocale();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={m.language_label()}
					title={m.language_label()}
				>
					<GlobeIcon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuRadioGroup
					value={currentLocale}
					onValueChange={(value) => setLocale(value as typeof currentLocale)}
				>
					{locales.map((locale) => (
						<DropdownMenuRadioItem key={locale} value={locale}>
							{LOCALE_LABELS[locale] ?? locale.toUpperCase()}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
