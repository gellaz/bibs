import { Badge } from "@bibs/ui/components/badge";

const roleLabels: Record<
	string,
	{
		label: string;
		variant: "default" | "secondary" | "outline" | "destructive";
	}
> = {
	admin: { label: "Admin", variant: "destructive" },
	seller: { label: "Venditore", variant: "default" },
	customer: { label: "Cliente", variant: "secondary" },
	employee: { label: "Dipendente", variant: "outline" },
};

export function UserRoleBadge({ role }: { role: string | null | undefined }) {
	const config = roleLabels[role ?? ""] ?? {
		label: role ?? "—",
		variant: "outline" as const,
	};

	return <Badge variant={config.variant}>{config.label}</Badge>;
}
