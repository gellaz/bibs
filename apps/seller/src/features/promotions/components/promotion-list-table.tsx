import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { Link } from "@tanstack/react-router";
import { MoreVerticalIcon } from "lucide-react";
import { m } from "@/paraglide/messages";

interface DiscountRow {
	id: string;
	title: string;
	percent: number;
	startsAt: string;
	endsAt: string | null;
	status: "active" | "paused" | "archived";
	productCount: number;
}

interface Props {
	rows: DiscountRow[];
	onPauseToggle: (id: string) => void;
	onArchive: (id: string) => void;
}

function operationalState(
	r: DiscountRow,
): "running" | "scheduled" | "paused" | "expired" | "archived" {
	if (r.status === "archived") return "archived";
	if (r.status === "paused") return "paused";
	const now = Date.now();
	const startsAt = new Date(r.startsAt).getTime();
	if (now < startsAt) return "scheduled";
	const endsAt = r.endsAt ? new Date(r.endsAt).getTime() : null;
	if (endsAt !== null && now > endsAt) return "expired";
	return "running";
}

function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString("it-IT", {
		day: "numeric",
		month: "short",
	});
}

const STATE_LABELS = {
	running: m.promotions_state_running,
	scheduled: m.promotions_state_scheduled,
	paused: m.promotions_state_paused,
	expired: m.promotions_state_expired,
	archived: m.promotions_state_archived,
} as const;

export function PromotionListTable({ rows, onPauseToggle, onArchive }: Props) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>{m.promotions_col_title()}</TableHead>
					<TableHead>{m.promotions_col_discount()}</TableHead>
					<TableHead>{m.promotions_col_period()}</TableHead>
					<TableHead>{m.promotions_col_products()}</TableHead>
					<TableHead>{m.promotions_col_state()}</TableHead>
					<TableHead />
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((r) => {
					const state = operationalState(r);
					return (
						<TableRow key={r.id}>
							<TableCell>
								<Link
									to="/promotions/$discountId"
									params={{ discountId: r.id }}
									className="font-medium hover:underline"
								>
									{r.title}
								</Link>
							</TableCell>
							<TableCell>
								<Badge variant="secondary">-{r.percent}%</Badge>
							</TableCell>
							<TableCell className="text-sm">
								{formatDate(r.startsAt)} →{" "}
								{r.endsAt ? formatDate(r.endsAt) : "∞"}
							</TableCell>
							<TableCell>{r.productCount}</TableCell>
							<TableCell>
								<Badge variant="outline">{STATE_LABELS[state]()}</Badge>
							</TableCell>
							<TableCell className="text-right">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon">
											<MoreVerticalIcon className="size-4" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem asChild>
											<Link
												to="/promotions/$discountId"
												params={{ discountId: r.id }}
											>
												{m.promotions_action_edit()}
											</Link>
										</DropdownMenuItem>
										{r.status !== "archived" && (
											<DropdownMenuItem onSelect={() => onPauseToggle(r.id)}>
												{r.status === "paused"
													? m.promotions_action_resume()
													: m.promotions_action_pause()}
											</DropdownMenuItem>
										)}
										{r.status !== "archived" && (
											<DropdownMenuItem onSelect={() => onArchive(r.id)}>
												{m.promotions_action_archive()}
											</DropdownMenuItem>
										)}
									</DropdownMenuContent>
								</DropdownMenu>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
