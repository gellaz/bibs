import { Alert, AlertDescription } from "@bibs/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { Button } from "@bibs/ui/components/button";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { unwrapJson } from "@bibs/ui/lib/api-client";
import { displayName } from "@bibs/ui/lib/display-name";
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { RejectChangeDialog } from "@/features/requests/reject-change-dialog";
import { adminApi } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/requests/$changeId")({
	component: ChangeDetailPage,
});

const DOCUMENT_TYPE_LABEL = {
	identity_card: m.sellers_document_type_identity_card,
	driving_license: m.sellers_document_type_driving_license,
	passport: m.sellers_document_type_passport,
} as const;

function formatDate(value: string | Date | null | undefined) {
	if (!value) return null;
	return new Date(value).toLocaleDateString(intlLocale(), {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

function ChangeDetailPage() {
	const { changeId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [approveOpen, setApproveOpen] = useState(false);
	const [rejectOpen, setRejectOpen] = useState(false);
	const detailKey = ["admin-requests", "change", changeId];

	const { data, isLoading, error } = useQuery({
		queryKey: detailKey,
		queryFn: async () => {
			const response = await adminApi.requests.changes[":changeId"].$get({
				param: { changeId },
			});
			return (await unwrapJson(response, m.request_detail_not_found())).data;
		},
	});

	const decide = useMutation({
		mutationFn: async (reason: string | null) => {
			const change = adminApi.sellers.changes[":changeId"];
			const param = { changeId };
			const response =
				reason === null
					? await change.approve.$patch({ param })
					: await change.reject.$patch({ param, json: { reason } });
			await unwrapJson(response, m.request_detail_action_error());
			return reason === null;
		},
		onSuccess: (approved) => {
			void queryClient.invalidateQueries({ queryKey: ["admin-requests"] });
			void queryClient.invalidateQueries({ queryKey: ["admin-sellers"] });
			toast.success(
				approved ? m.request_detail_approved() : m.request_detail_rejected(),
			);
			void navigate({ to: "/requests", search: { type: undefined } });
		},
		onError: (e: Error) => {
			toast.error(e.message);
			setApproveOpen(false);
			setRejectOpen(false);
			// 400 «non più in attesa»: ricarica dettaglio, lista e badge.
			// Con il 409 sulla partita IVA la richiesta resta in attesa e rifiutabile.
			void queryClient.invalidateQueries({ queryKey: ["admin-requests"] });
		},
	});

	if (isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Spinner className="size-8" />
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="bg-destructive/10 text-destructive rounded-lg border border-destructive/20 p-4">
				<p className="text-sm">
					{error?.message || m.request_detail_not_found()}
				</p>
			</div>
		);
	}

	const isPending = data.status === "pending";
	const rows =
		data.vat !== null
			? [
					{
						label: m.sellers_vat_number(),
						current: data.vat.current,
						requested: data.vat.requested,
						mono: true,
					},
				]
			: data.document !== null
				? documentRows(data.document.current, data.document.requested)
				: [];

	return (
		<div className="space-y-4">
			<div className="space-y-1">
				<div className="flex flex-wrap items-center gap-2">
					<h1 className="text-lg font-semibold">{m.request_detail_title()}</h1>
					<div className="ml-auto flex gap-1.5">
						{isPending && (
							<>
								<Button
									variant="destructive"
									size="sm"
									disabled={decide.isPending}
									onClick={() => setRejectOpen(true)}
								>
									{m.sellers_reject()}
								</Button>
								<Button
									variant="success"
									size="sm"
									disabled={decide.isPending}
									onClick={() => setApproveOpen(true)}
								>
									{m.sellers_approve()}
								</Button>
							</>
						)}
					</div>
				</div>
				<p className="text-muted-foreground text-sm">
					{displayName(data.seller)}
					{data.seller.businessName && ` (${data.seller.businessName})`}
					{" · "}
					{data.changeType === "vat"
						? m.request_detail_type_vat()
						: m.request_detail_type_document()}
					{" · "}
					{formatDate(data.createdAt)}
				</p>
				<Link
					to="/sellers/$sellerId"
					params={{ sellerId: data.seller.id }}
					className="text-primary text-sm hover:underline"
				>
					{m.request_detail_seller_link()}
				</Link>
			</div>

			{!isPending && (
				<Alert>
					<AlertDescription>{m.request_detail_not_pending()}</AlertDescription>
				</Alert>
			)}

			<div className="bg-card rounded-lg border shadow-sm">
				<div className="text-muted-foreground bg-muted/60 grid grid-cols-2 gap-x-4 border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide sm:grid-cols-[140px_1fr_1fr]">
					<span className="hidden sm:block" />
					<span>{m.request_detail_current()}</span>
					<span>{m.request_detail_requested()}</span>
				</div>
				<dl className="divide-y">
					{rows.map((row) => (
						<div
							key={row.label}
							className="grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-2 sm:grid-cols-[140px_1fr_1fr]"
						>
							<dt className="text-muted-foreground col-span-2 text-sm sm:col-span-1">
								{row.label}
							</dt>
							<Value value={row.current} mono={row.mono} />
							<Value value={row.requested} mono={row.mono} />
						</div>
					))}
				</dl>
			</div>

			<AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{m.sellers_approve()}</AlertDialogTitle>
						<AlertDialogDescription>
							{m.request_detail_approve_confirm()}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={decide.isPending}>
							{m.common_cancel()}
						</AlertDialogCancel>
						<AlertDialogAction
							variant="success"
							disabled={decide.isPending}
							onClick={() => decide.mutate(null)}
						>
							{decide.isPending ? m.common_please_wait() : m.sellers_approve()}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<RejectChangeDialog
				open={rejectOpen}
				onOpenChange={setRejectOpen}
				onConfirm={(reason) => decide.mutate(reason)}
				isPending={decide.isPending}
			/>
		</div>
	);
}

interface Snapshot {
	documentType: keyof typeof DOCUMENT_TYPE_LABEL | null;
	documentNumber: string | null;
	documentExpiry: string | null;
	issuedMunicipality: { name: string; provinceAcronym: string } | null;
	imageUrl: string | null;
}

interface Row {
	label: string;
	current: React.ReactNode;
	requested: React.ReactNode;
	mono?: boolean;
}

function documentRows(current: Snapshot, requested: Snapshot): Row[] {
	const both = (f: (s: Snapshot) => React.ReactNode) => ({
		current: f(current),
		requested: f(requested),
	});
	return [
		{
			label: m.sellers_document_type(),
			...both((s) => s.documentType && DOCUMENT_TYPE_LABEL[s.documentType]()),
		},
		{
			label: m.sellers_document_number(),
			...both((s) => s.documentNumber),
		},
		{
			label: m.sellers_document_expiry(),
			...both((s) => formatDate(s.documentExpiry)),
		},
		{
			label: m.sellers_document_issued_municipality(),
			...both(
				(s) =>
					s.issuedMunicipality &&
					`${s.issuedMunicipality.name} (${s.issuedMunicipality.provinceAcronym})`,
			),
		},
		{
			label: m.sellers_document_image(),
			...both(
				(s) =>
					s.imageUrl && (
						<a href={s.imageUrl} target="_blank" rel="noopener noreferrer">
							<img
								src={s.imageUrl}
								alt={m.sellers_document_image()}
								className="max-h-40 rounded border"
							/>
						</a>
					),
			),
		},
	];
}

function Value({ value, mono }: { value: React.ReactNode; mono?: boolean }) {
	return (
		<dd
			className={`text-sm ${value ? (mono ? "font-mono" : "font-medium") : "text-muted-foreground"}`}
		>
			{value || "—"}
		</dd>
	);
}
