import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@bibs/ui/components/sidebar";
import { BuildingIcon } from "lucide-react";
import { useSellerSettings } from "@/hooks/use-seller-settings";

export function CompanyHeader() {
	const { data, isLoading } = useSellerSettings();

	const businessName = data?.organization?.businessName;

	if (isLoading || !businessName) {
		return null;
	}

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<SidebarMenuButton size="lg" disabled>
					<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
						<BuildingIcon className="size-4" />
					</div>
					<div className="grid flex-1 text-left text-sm leading-tight">
						<span className="truncate font-medium">{businessName}</span>
						{data.organization?.vatNumber && (
							<span className="truncate text-xs text-muted-foreground">
								P.IVA {data.organization.vatNumber}
							</span>
						)}
					</div>
				</SidebarMenuButton>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
