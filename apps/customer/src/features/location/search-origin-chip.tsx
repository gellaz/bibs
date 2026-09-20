import {
	Drawer,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@bibs/ui/components/drawer";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@bibs/ui/components/popover";
import { Separator } from "@bibs/ui/components/separator";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { useIsMobile } from "@bibs/ui/hooks/use-mobile";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
	Check,
	ChevronDown,
	Globe,
	LocateFixed,
	MapPin,
	Settings2,
} from "lucide-react";
import { m } from "@/paraglide/messages";
import { originLabel } from "./origin-label";
import { useSearchOrigin } from "./search-origin";
import { addressOriginLabel } from "./search-origin-state";

/** Alone saffron + anello Ink: la regola del focus di DESIGN.md. */
const FOCUS_RING =
	"outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron";

/**
 * Il selettore dell'origine. Sta nell'header perché "da dove cerco" è la prima
 * domanda di una ricerca locale, e perché da qui è raggiungibile da ogni
 * pagina — prima esisteva solo come bottone GPS dentro due schermate.
 */
export function SearchOriginChip() {
	const { origin, geoStatus, isBooting, pickerOpen, setPickerOpen } =
		useSearchOrigin();
	const isMobile = useIsMobile();

	const trigger = (
		<button
			type="button"
			disabled={isBooting}
			aria-label={m.origin_chip_aria()}
			className={`inline-flex min-h-11 max-w-[15rem] items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-foreground text-sm transition-colors hover:border-primary/40 hover:bg-muted sm:min-h-9 ${FOCUS_RING}`}
		>
			<MapPin
				className="size-4 shrink-0 text-saffron-deep dark:text-saffron"
				aria-hidden
			/>
			{isBooting ? (
				<Skeleton className="h-4 w-24" />
			) : (
				<span className="truncate font-medium">
					{originLabel(origin, geoStatus)}
				</span>
			)}
			<ChevronDown
				className="size-3.5 shrink-0 text-muted-foreground"
				aria-hidden
			/>
		</button>
	);

	// Una sola istanza montata: il pannello finisce in un portal, quindi due
	// copie "nascoste con il CSS" si aprirebbero tutte e due.
	if (isMobile) {
		return (
			<Drawer open={pickerOpen} onOpenChange={setPickerOpen}>
				<DrawerTrigger asChild>{trigger}</DrawerTrigger>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>{m.origin_title()}</DrawerTitle>
					</DrawerHeader>
					<div className="overflow-y-auto px-2 pb-8">
						<OriginOptions onPick={() => setPickerOpen(false)} />
					</div>
				</DrawerContent>
			</Drawer>
		);
	}

	return (
		<Popover open={pickerOpen} onOpenChange={setPickerOpen}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent align="start" className="w-80 gap-0 p-2">
				<p className="px-2 pt-1 pb-2 font-medium text-muted-foreground text-xs">
					{m.origin_title()}
				</p>
				<div className="max-h-[60vh] overflow-y-auto">
					<OriginOptions onPick={() => setPickerOpen(false)} />
				</div>
			</PopoverContent>
		</Popover>
	);
}

function OptionRow({
	icon: Icon,
	title,
	hint,
	active,
	disabled,
	onClick,
}: {
	icon: LucideIcon;
	title: string;
	hint?: string;
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-current={active ? "true" : undefined}
			className={`flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING} ${
				active
					? "bg-primary/10 text-primary"
					: "text-foreground enabled:hover:bg-muted"
			}`}
		>
			<Icon
				className={`size-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
				aria-hidden
			/>
			<span className="min-w-0 flex-1">
				<span className="block truncate font-medium text-sm">{title}</span>
				{hint && (
					<span className="block truncate text-muted-foreground text-xs">
						{hint}
					</span>
				)}
			</span>
			{active && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
		</button>
	);
}

function OriginOptions({ onPick }: { onPick: () => void }) {
	const {
		origin,
		addresses,
		geoStatus,
		chooseGps,
		chooseAddress,
		chooseNowhere,
	} = useSearchOrigin();

	// Un indirizzo senza coordinate non può essere un'origine: la rubrica le
	// esige sui nuovi, ma le righe vecchie dell'API possono averle nulle.
	const usable = addresses.filter((a) => a.location !== null);

	const gpsHint =
		geoStatus === "pending"
			? m.origin_gps_locating()
			: geoStatus === "denied"
				? m.origin_gps_denied()
				: geoStatus === "unsupported"
					? m.origin_gps_unsupported()
					: undefined;

	return (
		<div className="space-y-0.5">
			<OptionRow
				icon={LocateFixed}
				title={m.origin_gps()}
				hint={gpsHint}
				active={origin.kind === "gps"}
				disabled={geoStatus === "unsupported"}
				onClick={() => {
					chooseGps();
					onPick();
				}}
			/>

			<p className="px-2 pt-3 pb-1 font-medium text-muted-foreground text-xs">
				{m.origin_addresses_title()}
			</p>
			{usable.length === 0 ? (
				<p className="px-2 pb-1 text-muted-foreground text-xs">
					{m.origin_addresses_empty()}
				</p>
			) : (
				usable.map((address) => (
					<OptionRow
						key={address.id}
						icon={MapPin}
						title={addressOriginLabel(address)}
						hint={`${address.addressLine1} · ${address.municipality.name}`}
						active={
							origin.kind === "address" && origin.addressId === address.id
						}
						onClick={() => {
							chooseAddress(address.id);
							onPick();
						}}
					/>
				))
			)}

			<div className="pt-3">
				<OptionRow
					icon={Globe}
					title={m.origin_everywhere()}
					hint={m.origin_everywhere_hint()}
					active={origin.kind === "none"}
					onClick={() => {
						chooseNowhere();
						onPick();
					}}
				/>
			</div>

			<Separator className="my-1" />
			<Link
				to="/addresses"
				onClick={onPick}
				className={`flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-primary text-sm transition-colors hover:bg-muted ${FOCUS_RING}`}
			>
				<Settings2 className="size-4 shrink-0" aria-hidden />
				{m.origin_manage()}
			</Link>
		</div>
	);
}
