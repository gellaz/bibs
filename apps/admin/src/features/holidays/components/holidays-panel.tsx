import { intlLocale } from "@bibs/ui/lib/intl-locale";

("use no memo");

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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@bibs/ui/components/dropdown-menu";
import { Field, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import { toast } from "@bibs/ui/components/sonner";
import { DataTable } from "@bibs/ui/custom/data-table";
import { StatusBadge } from "@bibs/ui/custom/status-badge";
import { useRowSelection } from "@bibs/ui/hooks/use-row-selection";
import { unwrapJson } from "@bibs/ui/lib/api-client";
import { toYMD } from "@bibs/ui/lib/date";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CalendarDaysIcon,
	CircleCheckIcon,
	CircleMinusIcon,
	EyeIcon,
	EyeOffIcon,
	PencilIcon,
	Trash2Icon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
	BulkToolbar,
	RowActionsMenu,
	selectColumn,
} from "@/components/bulk-selection";
import { HolidayForm } from "@/features/holidays/components/holiday-form";
import { adminApi } from "@/lib/api";
import { runBulk, toastBulkResult } from "@/lib/bulk";
import { m } from "@/paraglide/messages";

interface HolidayDefinition {
	id: string;
	name: string;
	type: "fixed" | "easter_relative" | "one_off";
	month: number | null;
	day: number | null;
	easterOffsetDays: number | null;
	oneOffDate: string | null;
	isActive: boolean;
	createdAt: Date | string;
	updatedAt: Date | string;
}

interface HolidaysPanelProps {
	createOpen: boolean;
	onCreateOpenChange: (open: boolean) => void;
}

/** Human-readable "quando" for a holiday definition. */
function describeHoliday(h: HolidayDefinition): string {
	if (h.type === "fixed" && h.month && h.day) {
		return new Date(2000, h.month - 1, h.day).toLocaleDateString(intlLocale(), {
			day: "numeric",
			month: "long",
		});
	}
	if (h.type === "easter_relative") {
		if (h.easterOffsetDays === 0) return m.holidays_easter_sunday();
		if (h.easterOffsetDays === 1) return m.holidays_easter_monday();
		return m.holidays_easter_offset({
			offset: `${h.easterOffsetDays! > 0 ? "+" : ""}${h.easterOffsetDays}`,
		});
	}
	if (h.type === "one_off" && h.oneOffDate) {
		const [y, mo, d] = toYMD(h.oneOffDate).split("-").map(Number);
		return new Date(y, mo - 1, d).toLocaleDateString(intlLocale(), {
			day: "numeric",
			month: "short",
			year: "numeric",
		});
	}
	return "—";
}

const holiday = adminApi["holiday-definitions"][":holidayId"];

const YEARS = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() + i);

export function HolidaysPanel({
	createOpen,
	onCreateOpenChange,
}: HolidaysPanelProps) {
	"use no memo";

	const queryClient = useQueryClient();
	const [editOpen, setEditOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
	const [selected, setSelected] = useState<HolidayDefinition | null>(null);
	const [editName, setEditName] = useState("");
	const [previewYear, setPreviewYear] = useState(YEARS[0]);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: ["holiday-definitions"] });
	};

	const { data, isLoading, error } = useQuery({
		queryKey: ["holiday-definitions"],
		queryFn: async () => {
			const response = await adminApi["holiday-definitions"].$get();
			return unwrapJson(response, m.holidays_load_error());
		},
	});

	const { data: previewData } = useQuery({
		queryKey: ["holiday-definitions", "preview", previewYear],
		queryFn: async () => {
			const response = await adminApi["holiday-definitions"].preview.$get({
				query: { year: previewYear },
			});
			if (!response.ok) return null;
			return (await response.json()).data;
		},
	});

	const createMutation = useMutation({
		mutationFn: async (
			input:
				| { type: "fixed"; name: string; month: number; day: number }
				| { type: "easter_relative"; name: string; easterOffsetDays: number }
				| { type: "one_off"; name: string; oneOffDate: string },
		) => {
			const response = await adminApi["holiday-definitions"].$post({
				json: input,
			});
			return unwrapJson(response, m.common_create_error());
		},
		onSuccess: () => {
			invalidate();
			onCreateOpenChange(false);
			toast.success(m.holidays_create_ok());
		},
		onError: (e: Error) => toast.error(e.message || m.common_create_error()),
	});

	const updateMutation = useMutation({
		mutationFn: async (input: {
			id: string;
			name?: string;
			isActive?: boolean;
		}) => {
			const { id, ...patch } = input;
			const response = await holiday.$patch({
				param: { holidayId: id },
				json: patch,
			});
			return unwrapJson(response, m.common_update_error());
		},
		onSuccess: () => {
			invalidate();
			setEditOpen(false);
			setSelected(null);
			toast.success(m.holidays_update_ok());
		},
		onError: (e: Error) => toast.error(e.message || m.common_update_error()),
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const response = await holiday.$delete({ param: { holidayId: id } });
			return unwrapJson(response, m.common_delete_error());
		},
		onSuccess: () => {
			invalidate();
			setDeleteOpen(false);
			setSelected(null);
			toast.success(m.holidays_delete_ok());
		},
		onError: (e: Error) => toast.error(e.message || m.common_delete_error()),
	});

	const rows = useMemo<HolidayDefinition[]>(() => data?.data ?? [], [data]);
	// Una sola pagina con tutte le festività: niente da azzerare.
	const selection = useRowSelection({
		currentPageIds: rows.map((r) => r.id),
		resetKey: "",
	});
	const selectedRows = rows.filter((r) => selection.isSelected(r.id));
	const selectionRef = useRef(selection);
	selectionRef.current = selection;

	const bulkMutation = useMutation({
		mutationFn: ({
			action,
			items,
		}: {
			action: "activate" | "deactivate" | "delete";
			items: HolidayDefinition[];
		}) =>
			runBulk(items, async (h) => {
				const param = { holidayId: h.id };
				if (action === "delete")
					return unwrapJson(
						await holiday.$delete({ param }),
						m.common_delete_error(),
					);
				return unwrapJson(
					await holiday.$patch({
						param,
						json: { isActive: action === "activate" },
					}),
					m.common_update_error(),
				);
			}),
		onSuccess: (result, { action }) => {
			invalidate();
			setBulkDeleteOpen(false);
			selection.clear();
			toastBulkResult(result, {
				done: (n) =>
					action === "delete"
						? n === 1
							? m.holidays_delete_ok()
							: m.holidays_bulk_delete_ok({ count: n })
						: n === 1
							? m.holidays_update_ok()
							: (action === "activate"
									? m.holidays_bulk_activate_ok
									: m.holidays_bulk_deactivate_ok)({ count: n }),
				error:
					action === "delete"
						? m.common_delete_error()
						: m.common_update_error(),
			});
		},
	});

	const columns = useMemo<DataTableColumnDef<HolidayDefinition>[]>(
		() => [
			selectColumn<HolidayDefinition>(() => selectionRef.current),
			{
				id: "name",
				header: m.common_name(),
				enableHiding: false,
				meta: {
					headerClassName: "w-[30%]",
					cellClassName: "font-semibold",
				},
				cell: ({ row }) => row.original.name,
			},
			{
				id: "when",
				header: m.holidays_column_when(),
				meta: {
					headerClassName: "w-[30%]",
					cellClassName: "text-muted-foreground",
				},
				cell: ({ row }) => describeHoliday(row.original),
			},
			{
				id: "status",
				header: m.holidays_column_status(),
				meta: { headerClassName: "w-[20%]" },
				cell: ({ row }) =>
					row.original.isActive ? (
						<StatusBadge tone="success" icon={CircleCheckIcon}>
							{m.holidays_status_active()}
						</StatusBadge>
					) : (
						<StatusBadge tone="closed" icon={CircleMinusIcon}>
							{m.holidays_status_inactive()}
						</StatusBadge>
					),
			},
			{
				id: "actions",
				enableHiding: false,
				meta: {
					// px-2: il pulsante icona (32 px) entra giusto nei 48 px di w-12.
					headerClassName: "w-12 px-2",
					cellClassName: "w-12 px-2",
					sticky: "right",
				},
				header: "",
				cell: ({ row }) => {
					const h = row.original;
					return (
						<RowActionsMenu name={h.name}>
							<DropdownMenuItem
								className="whitespace-nowrap"
								onClick={() => {
									setSelected(h);
									setEditName(h.name);
									setEditOpen(true);
								}}
							>
								<PencilIcon />
								{m.holidays_rename()}
							</DropdownMenuItem>
							{!h.isActive && (
								<DropdownMenuItem
									className="whitespace-nowrap"
									onClick={() =>
										updateMutation.mutate({ id: h.id, isActive: true })
									}
								>
									<EyeIcon />
									{m.holidays_activate()}
								</DropdownMenuItem>
							)}
							<DropdownMenuSeparator />
							{h.isActive && (
								<DropdownMenuItem
									variant="warning"
									className="whitespace-nowrap"
									onClick={() =>
										updateMutation.mutate({ id: h.id, isActive: false })
									}
								>
									<EyeOffIcon />
									{m.holidays_deactivate()}
								</DropdownMenuItem>
							)}
							<DropdownMenuItem
								variant="destructive"
								className="whitespace-nowrap"
								onClick={() => {
									setSelected(h);
									setDeleteOpen(true);
								}}
							>
								<Trash2Icon />
								{m.common_delete()}
							</DropdownMenuItem>
						</RowActionsMenu>
					);
				},
			},
		],
		[],
	);

	return (
		<div className="space-y-4">
			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
					<p className="text-sm">
						{m.common_load_error_with_message({
							message: (error as Error).message,
						})}
					</p>
				</div>
			)}

			<BulkToolbar count={selectedRows.length} onClear={selection.clear}>
				<Button
					size="sm"
					variant="success"
					disabled={bulkMutation.isPending}
					onClick={() =>
						bulkMutation.mutate({ action: "activate", items: selectedRows })
					}
				>
					<EyeIcon className="size-4" />
					{m.holidays_activate()}
				</Button>
				<Button
					size="sm"
					variant="warning"
					disabled={bulkMutation.isPending}
					onClick={() =>
						bulkMutation.mutate({ action: "deactivate", items: selectedRows })
					}
				>
					<EyeOffIcon className="size-4" />
					{m.holidays_deactivate()}
				</Button>
				<Button
					size="sm"
					variant="destructive"
					disabled={bulkMutation.isPending}
					onClick={() => setBulkDeleteOpen(true)}
				>
					<Trash2Icon className="size-4" />
					{m.common_delete()}
				</Button>
			</BulkToolbar>

			<DataTable
				data={rows}
				columns={columns}
				storageKey="admin.holidays.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				isRowSelected={(row) => selection.isSelected(row.original.id)}
				emptyState={
					<div className="flex flex-col items-center gap-2">
						<CalendarDaysIcon className="text-muted-foreground/40 size-8" />
						<div>
							<p className="text-muted-foreground font-medium">
								{m.holidays_empty_title()}
							</p>
							<p className="text-muted-foreground/60 text-sm">
								{m.holidays_empty_subtitle()}
							</p>
						</div>
					</div>
				}
			/>

			<div className="rounded-lg border p-4 space-y-3">
				<div className="flex items-center gap-3">
					<span className="text-sm font-medium">
						{m.holidays_preview_title()}
					</span>
					<NativeSelect
						className="w-32"
						value={String(previewYear)}
						onChange={(e) => setPreviewYear(Number(e.target.value))}
						aria-label={m.holidays_preview_year()}
					>
						{YEARS.map((y) => (
							<NativeSelectOption key={y} value={String(y)}>
								{y}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</div>
				<ul className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
					{(previewData ?? []).map((p) => (
						<li
							key={`${p.definitionId}-${toYMD(p.date)}`}
							className="text-sm text-muted-foreground"
						>
							<span className="font-mono">{toYMD(p.date)}</span> — {p.name}
						</li>
					))}
				</ul>
			</div>

			<Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{m.configurations_new_holiday()}</DialogTitle>
						<DialogDescription>
							{m.holidays_create_description()}
						</DialogDescription>
					</DialogHeader>
					<HolidayForm
						isPending={createMutation.isPending}
						onCancel={() => onCreateOpenChange(false)}
						onSubmit={(formData) => {
							if (formData.type === "fixed") {
								createMutation.mutate({
									type: "fixed",
									name: formData.name,
									month: Number(formData.month),
									day: Number(formData.day),
								});
							} else if (formData.type === "easter_relative") {
								createMutation.mutate({
									type: "easter_relative",
									name: formData.name,
									easterOffsetDays: Number(formData.easterOffsetDays),
								});
							} else {
								createMutation.mutate({
									type: "one_off",
									name: formData.name,
									oneOffDate: formData.oneOffDate as string,
								});
							}
						}}
					/>
				</DialogContent>
			</Dialog>

			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{m.holidays_rename_title()}</DialogTitle>
						<DialogDescription>
							{m.holidays_rename_description()}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<Field>
							<FieldLabel htmlFor="edit-holiday-name">
								{m.common_name()}
							</FieldLabel>
							<Input
								id="edit-holiday-name"
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
							/>
						</Field>
					</div>
					<div className="flex justify-end gap-3">
						<Button variant="outline" onClick={() => setEditOpen(false)}>
							{m.common_cancel()}
						</Button>
						<Button
							disabled={
								updateMutation.isPending || editName.trim().length === 0
							}
							onClick={() => {
								if (selected)
									updateMutation.mutate({
										id: selected.id,
										name: editName.trim(),
									});
							}}
						>
							{updateMutation.isPending ? m.common_saving() : m.common_save()}
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{m.common_confirm_delete_title()}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{m.holidays_delete_description({ name: selected?.name ?? "" })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => {
								setDeleteOpen(false);
								setSelected(null);
							}}
						>
							{m.common_cancel()}
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleteMutation.isPending}
							onClick={() => {
								if (selected) deleteMutation.mutate(selected.id);
							}}
						>
							{deleteMutation.isPending
								? m.common_deleting()
								: m.common_delete()}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{m.common_confirm_delete_title()}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{selectedRows.length === 1
								? m.holidays_delete_description({ name: selectedRows[0].name })
								: m.holidays_bulk_delete_description({
										count: selectedRows.length,
									})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={bulkMutation.isPending}
							onClick={(e) => {
								// Resta aperto finché le chiamate non finiscono.
								e.preventBaseUIHandler();
								bulkMutation.mutate({ action: "delete", items: selectedRows });
							}}
						>
							{bulkMutation.isPending ? m.common_deleting() : m.common_delete()}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
