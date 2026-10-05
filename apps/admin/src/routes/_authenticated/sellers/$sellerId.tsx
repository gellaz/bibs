import { Button } from "@bibs/ui/components/button";
import { Spinner } from "@bibs/ui/components/spinner";
import { displayName } from "@bibs/ui/lib/display-name";
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeftIcon,
	CheckCircle2Icon,
	ExternalLinkIcon,
	XCircleIcon,
} from "lucide-react";
import { OnboardingStatusBadge } from "@/components/onboarding-status-badge";
import {
	SellerModerationDialog,
	useSellerModeration,
} from "@/components/seller-moderation-dialog";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/sellers/$sellerId")({
	component: SellerDetailPage,
});

function SellerDetailPage() {
	const { sellerId } = Route.useParams();
	const moderation = useSellerModeration({
		extraInvalidateKey: ["admin-seller-detail", sellerId],
	});

	const { data, isLoading, error } = useQuery({
		queryKey: ["admin-seller-detail", sellerId],
		queryFn: async () => {
			const response = await api().admin.sellers({ sellerId }).get();

			if (response.error) {
				throw new Error(response.error.value?.message || m.common_load_error());
			}

			return response.data;
		},
	});

	const seller = data?.data;

	if (isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Spinner className="size-8" />
			</div>
		);
	}

	if (error || !seller) {
		return (
			<div className="space-y-4">
				<Link
					to="/sellers"
					search={{ status: undefined }}
					className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
				>
					<ArrowLeftIcon className="size-4" />
					{m.sellers_back_to_list()}
				</Link>
				<div className="bg-destructive/10 text-destructive rounded-lg border border-destructive/20 p-4">
					<p className="text-sm">
						{(error as Error)?.message || m.sellers_not_found()}
					</p>
				</div>
			</div>
		);
	}

	const isPendingReview = seller.onboardingStatus === "pending_review";

	return (
		<div className={`space-y-4 ${isPendingReview ? "pb-20 sm:pb-0" : ""}`}>
			{/* Header */}
			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<Link
						to="/sellers"
						search={{ status: undefined }}
						className="text-muted-foreground hover:text-foreground -ml-1 inline-flex items-center gap-1 text-sm"
					>
						<ArrowLeftIcon className="size-4" />
					</Link>
					<h1 className="text-lg font-semibold">
						{seller.firstName && seller.lastName
							? `${seller.firstName} ${seller.lastName}`
							: displayName(seller.user)}
					</h1>
					{/* Desktop: badge + bottoni inline */}
					<div className="ml-auto hidden items-center gap-1.5 sm:flex">
						<OnboardingStatusBadge status={seller.onboardingStatus} />
						{isPendingReview && (
							<>
								<Button
									variant="destructive"
									size="sm"
									onClick={() =>
										moderation.setTarget({
											type: "reject",
											sellerId,
											sellerName:
												seller.organization?.businessName ??
												displayName(seller.user),
										})
									}
								>
									<XCircleIcon className="size-3.5" />
									{m.sellers_reject()}
								</Button>
								<Button
									variant="success"
									size="sm"
									onClick={() =>
										moderation.setTarget({
											type: "verify",
											sellerId,
											sellerName:
												seller.organization?.businessName ??
												displayName(seller.user),
										})
									}
								>
									<CheckCircle2Icon className="size-3.5" />
									{m.sellers_approve()}
								</Button>
							</>
						)}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-muted-foreground text-sm">
						{seller.user.email}
					</span>
					{/* Mobile: badge sotto email */}
					<span className="sm:hidden">
						<OnboardingStatusBadge status={seller.onboardingStatus} />
					</span>
				</div>
			</div>

			{/* Body: two-column layout */}
			<div className="bg-card rounded-lg border shadow-sm">
				<div className="grid gap-0 lg:grid-cols-2">
					{/* Colonna sinistra: anagrafica + documento */}
					<div className="border-border lg:border-r">
						<Section title={m.sellers_section_personal()}>
							<Field label={m.common_first_name()} value={seller.firstName} />
							<Field label={m.common_last_name()} value={seller.lastName} />
							<Field
								label={m.common_birth_date()}
								value={formatDate(seller.birthDate)}
							/>
							<Field
								label={m.sellers_citizenship()}
								value={seller.citizenship}
							/>
							<Field
								label={m.sellers_birth_country()}
								value={seller.birthCountry}
							/>
							<Field
								label={m.sellers_residence()}
								value={formatAddress(
									seller.residenceAddress,
									seller.residenceZipCode,
									seller.residenceMunicipality?.name ?? null,
									seller.residenceCountry,
									seller.residenceMunicipality?.provinceAcronym ?? null,
								)}
							/>
						</Section>

						<Section title={m.sellers_section_document()}>
							<Field
								label={m.sellers_document_number()}
								value={seller.documentNumber}
							/>
							<Field
								label={m.sellers_document_expiry()}
								value={formatDate(seller.documentExpiry)}
							/>
							<Field
								label={m.sellers_document_issued_municipality()}
								value={
									seller.documentIssuedMunicipality
										? `${seller.documentIssuedMunicipality.name} (${seller.documentIssuedMunicipality.provinceAcronym})`
										: null
								}
							/>
							{seller.documentImageUrl && (
								<div className="grid grid-cols-1 gap-x-3 px-4 py-1 sm:grid-cols-[140px_1fr] sm:py-0.5">
									<dt className="text-muted-foreground text-sm">
										{m.sellers_document_image()}
									</dt>
									<dd>
										<a
											href={seller.documentImageUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary hover:underline inline-flex items-center gap-1 text-sm"
										>
											{m.sellers_document_view()}
											<ExternalLinkIcon className="size-3" />
										</a>
									</dd>
								</div>
							)}
						</Section>
					</div>

					{/* Colonna destra: azienda */}
					<div className="border-border border-t lg:border-t-0">
						{seller.organization ? (
							<Section title={m.sellers_company()}>
								<Field
									label={m.sellers_business_name()}
									value={seller.organization.businessName}
								/>
								<Field
									label={m.sellers_vat_number()}
									value={seller.organization.vatNumber}
									mono
								/>
								<Field
									label={m.sellers_legal_form()}
									value={seller.organization.legalForm}
								/>
								<Field
									label={m.sellers_registered_office()}
									value={formatAddress(
										seller.organization.addressLine1,
										seller.organization.zipCode,
										seller.organization.municipality.name,
										seller.organization.country,
										seller.organization.municipality.provinceAcronym,
									)}
								/>
							</Section>
						) : (
							<div className="text-muted-foreground flex h-full items-center justify-center p-6 text-sm">
								{m.sellers_company_missing()}
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Mobile: barra sticky in fondo */}
			{isPendingReview && (
				<div className="bg-card/80 fixed inset-x-0 bottom-0 z-10 flex gap-2 border-t p-3 backdrop-blur-sm sm:hidden">
					<Button
						variant="destructive"
						className="flex-1"
						onClick={() =>
							moderation.setTarget({
								type: "reject",
								sellerId,
								sellerName:
									seller.organization?.businessName ?? displayName(seller.user),
							})
						}
					>
						<XCircleIcon className="size-4" />
						{m.sellers_reject()}
					</Button>
					<Button
						variant="success"
						className="flex-1"
						onClick={() =>
							moderation.setTarget({
								type: "verify",
								sellerId,
								sellerName:
									seller.organization?.businessName ?? displayName(seller.user),
							})
						}
					>
						<CheckCircle2Icon className="size-4" />
						{m.sellers_approve()}
					</Button>
				</div>
			)}

			{/* Confirm Dialog */}
			<SellerModerationDialog
				target={moderation.target}
				onOpenChange={(open) => {
					if (!open) moderation.setTarget(null);
				}}
				onConfirm={moderation.confirm}
				isPending={moderation.isPending}
			/>
		</div>
	);
}

// ── Layout helpers ──────────────────────────

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="border-border border-t first:border-t-0">
			<h3 className="bg-muted/60 border-border border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide">
				{title}
			</h3>
			<dl className="space-y-1 py-3">{children}</dl>
		</div>
	);
}

function Field({
	label,
	value,
	mono,
}: {
	label: string;
	value: string | null | undefined;
	mono?: boolean;
}) {
	return (
		<div className="grid grid-cols-1 gap-x-3 px-4 py-1 sm:grid-cols-[140px_1fr] sm:py-0.5">
			<dt className="text-muted-foreground text-xs sm:text-sm">{label}</dt>
			<dd
				className={`text-sm ${
					value ? (mono ? "font-mono" : "font-medium") : "text-muted-foreground"
				}`}
			>
				{value || "—"}
			</dd>
		</div>
	);
}

// ── Formatters ──────────────────────────────

function formatDate(value: string | null | undefined): string | null {
	if (!value) return null;
	return new Date(value).toLocaleDateString(intlLocale(), {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

function formatAddress(
	line: string | null | undefined,
	zip: string | null | undefined,
	city: string | null | undefined,
	country: string | null | undefined,
	province?: string | null,
): string | null {
	const parts = [line, [zip, city].filter(Boolean).join(" ")]
		.filter(Boolean)
		.join(", ");

	const suffix = [province, country].filter(Boolean).join(" ");

	if (!parts) return null;
	return suffix ? `${parts} (${suffix})` : parts;
}
