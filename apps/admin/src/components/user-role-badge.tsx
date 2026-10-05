import { Badge } from "@bibs/ui/components/badge";
import { m } from "@/paraglide/messages";

const roleLabels: Record<
	string,
	{
		label: () => string;
		variant: "default" | "secondary" | "outline" | "destructive";
	}
> = {
	admin: { label: m.users_role_admin, variant: "destructive" },
	seller: { label: m.users_role_seller, variant: "default" },
	customer: { label: m.users_role_customer, variant: "secondary" },
	employee: { label: m.users_role_employee, variant: "outline" },
};

export function UserRoleBadge({ role }: { role: string | null | undefined }) {
	const config = roleLabels[role ?? ""];
	if (!config) return <Badge variant="outline">{role ?? "—"}</Badge>;

	return <Badge variant={config.variant}>{config.label()}</Badge>;
}
