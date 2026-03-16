import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/select";
import { cn } from "~/lib/utils";

const DEFAULT_OPTIONS = [10, 20, 50, 100];

interface PageSizeSelectorProps {
	/** Current page size */
	pageSize: number;
	/** Callback when page size changes */
	onPageSizeChange: (pageSize: number) => void;
	/** Available page size options. Default: [10, 20, 50, 100] */
	options?: number[];
	/** Label text. Default: "Righe per pagina" */
	label?: string;
	/** Additional class name */
	className?: string;
}

function PageSizeSelector({
	pageSize,
	onPageSizeChange,
	options = DEFAULT_OPTIONS,
	label = "Righe per pagina",
	className,
}: PageSizeSelectorProps) {
	return (
		<div className={cn("flex items-center gap-2", className)}>
			<span className="text-muted-foreground text-sm whitespace-nowrap">
				{label}
			</span>
			<Select
				value={String(pageSize)}
				onValueChange={(value) => onPageSizeChange(Number(value))}
			>
				<SelectTrigger size="sm" className="w-16">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option} value={String(option)}>
							{option}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

export type { PageSizeSelectorProps };
export { PageSizeSelector };
