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
import { DataPagination } from "@bibs/ui/components/data-pagination";
import { DataTable } from "@bibs/ui/components/data-table";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import { Input } from "@bibs/ui/components/input";
import { PageSizeSelector } from "@bibs/ui/components/page-size-selector";
import { toast } from "@bibs/ui/components/sonner";
import type { SortOrder } from "@bibs/ui/components/sortable-table-head";
import { SortableHeadButton } from "@bibs/ui/components/sortable-table-head";
import { TableColumnsToggle } from "@bibs/ui/components/table-columns-toggle";
import { useDebouncedValue } from "@bibs/ui/hooks/use-debounced-value";
import { formatDateIt } from "@bibs/ui/lib/date";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { PencilIcon, SearchIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import {
	CsvImportDialog,
	type CsvImportResult,
} from "@/features/csv-import/components/csv-import-dialog";

type SortByField = "name" | "createdAt";

const EMPTY: never[] = [];

// Eden responses are { data, error }. The error shape is per-route, so keep it
// `unknown` here — that way any config closure's eden promise is assignable —
// and narrow it at runtime in `edenMessage`.
type EdenRes<T> = { data: T | null; error: unknown };

function edenMessage(error: unknown): string | undefined {
	if (error && typeof error === "object" && "value" in error) {
		const v = (error as { value?: unknown }).value;
		if (typeof v === "string") return v;
		if (v && typeof v === "object" && "message" in v) {
			const m = (v as { message?: unknown }).message;
			if (typeof m === "string") return m;
		}
	}
	return undefined;
}

async function unwrap<T>(p: Promise<EdenRes<T>>, fallback: string): Promise<T> {
	const res = await p;
	if (res.error) throw new Error(edenMessage(res.error) ?? fallback);
	if (res.data == null) throw new Error(fallback);
	return res.data;
}

export interface CategoryEntity {
	id: string;
	name: string;
	createdAt: Date | string;
}

export interface CrudListResult<T> {
	data: T[];
	pagination: { total: number };
}

export interface CrudListQuery {
	page: number;
	limit: number;
	search?: string;
	sortBy: SortByField;
	sortOrder: SortOrder;
	[filterKey: string]: string | number | undefined;
}

export interface CrudFormProps<TForm> {
	defaultValues?: TForm;
	onSubmit: (data: TForm) => void;
	onCancel: () => void;
	isPending: boolean;
	submitLabel: string;
	pendingLabel: string;
}

export interface CategoryCrudConfig<TEntity extends CategoryEntity, TForm> {
	queryKeyBase: string;
	storageKey: string;
	extraInvalidate?: readonly (readonly string[])[];

	list: (q: CrudListQuery) => Promise<EdenRes<CrudListResult<TEntity>>>;
	create: (form: TForm) => Promise<EdenRes<unknown>>;
	update: (id: string, form: TForm) => Promise<EdenRes<unknown>>;
	remove: (id: string) => Promise<EdenRes<unknown>>;

	extraColumns?: ColumnDef<TEntity>[];
	emptyIcon: ReactNode;

	renderForm: (p: CrudFormProps<TForm>) => ReactNode;
	editDefaults: (e: TEntity) => TForm;

	toolbarFilter?: (ctx: {
		values: Record<string, string>;
		set: (key: string, value: string) => void;
	}) => ReactNode;
	csvImport?: {
		onImport: (file: File) => Promise<CsvImportResult>;
		title: string;
		description: string;
		formatHint: string;
	};

	labels: {
		searchPlaceholder: string;
		empty: { title: string; subtitle: string };
		total: (n: number) => string;
		createDialog: { title: string; description: string };
		editDialog: { title: string; description: string };
		deleteDescription: (name: string) => ReactNode;
		toasts: { createOk: string; updateOk: string; deleteOk: string };
		rowAria: { edit: string; delete: string };
	};
}

interface CategoryCrudPanelProps<TEntity extends CategoryEntity, TForm> {
	config: CategoryCrudConfig<TEntity, TForm>;
	createOpen: boolean;
	onCreateOpenChange: (open: boolean) => void;
}

export function CategoryCrudPanel<TEntity extends CategoryEntity, TForm>({
	config,
	createOpen,
	onCreateOpenChange,
}: CategoryCrudPanelProps<TEntity, TForm>) {
	"use no memo";

	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(20);
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 300);
	const [sortBy, setSortBy] = useState<SortByField>("name");
	const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
	const [filterValues, setFilterValues] = useState<Record<string, string>>({});
	const [editOpen, setEditOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [importOpen, setImportOpen] = useState(false);
	const [selected, setSelected] = useState<TEntity | null>(null);

	const handleSort = (field: SortByField) => {
		if (sortBy === field) {
			setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(field);
			setSortOrder("asc");
		}
		setPage(1);
	};

	const setFilterValue = (key: string, value: string) => {
		setFilterValues((prev) => ({ ...prev, [key]: value }));
		setPage(1);
	};

	const activeFilters = useMemo(() => {
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(filterValues)) if (v) out[k] = v;
		return out;
	}, [filterValues]);

	const { data, isLoading, error } = useQuery({
		queryKey: [
			config.queryKeyBase,
			page,
			limit,
			debouncedSearch,
			sortBy,
			sortOrder,
			activeFilters,
		],
		queryFn: () =>
			unwrap(
				config.list({
					page,
					limit,
					...(debouncedSearch ? { search: debouncedSearch } : {}),
					sortBy,
					sortOrder,
					...activeFilters,
				}),
				"Errore nel caricamento dei dati",
			),
	});

	const invalidateAll = () => {
		void queryClient.invalidateQueries({ queryKey: [config.queryKeyBase] });
		for (const key of config.extraInvalidate ?? []) {
			void queryClient.invalidateQueries({ queryKey: [...key] });
		}
	};

	const createMutation = useMutation({
		mutationFn: (form: TForm) =>
			unwrap(config.create(form), "Errore durante la creazione"),
		onSuccess: () => {
			invalidateAll();
			onCreateOpenChange(false);
			toast.success(config.labels.toasts.createOk);
		},
		onError: (e: Error) =>
			toast.error(e.message || "Errore durante la creazione"),
	});

	const updateMutation = useMutation({
		mutationFn: ({ id, form }: { id: string; form: TForm }) =>
			unwrap(config.update(id, form), "Errore durante l'aggiornamento"),
		onSuccess: () => {
			invalidateAll();
			setEditOpen(false);
			setSelected(null);
			toast.success(config.labels.toasts.updateOk);
		},
		onError: (e: Error) =>
			toast.error(e.message || "Errore durante l'aggiornamento"),
	});

	const deleteMutation = useMutation({
		mutationFn: (id: string) =>
			unwrap(config.remove(id), "Errore durante l'eliminazione"),
		onSuccess: () => {
			invalidateAll();
			setDeleteOpen(false);
			setSelected(null);
			toast.success(config.labels.toasts.deleteOk);
		},
		onError: (e: Error) =>
			toast.error(e.message || "Errore durante l'eliminazione"),
	});

	const handleDelete = () => {
		if (!selected) return;
		deleteMutation.mutate(selected.id);
	};

	const columns = useMemo<ColumnDef<TEntity>[]>(() => {
		const nameCol: ColumnDef<TEntity> = {
			id: "name",
			enableHiding: false,
			meta: {
				menuLabel: "Nome",
				headerClassName: "pl-4",
				cellClassName: "pl-6 font-semibold",
			},
			header: () => (
				<SortableHeadButton
					active={sortBy === "name"}
					sortOrder={sortOrder}
					onSort={() => handleSort("name")}
				>
					Nome
				</SortableHeadButton>
			),
			cell: ({ row }) => row.original.name,
		};
		const createdAtCol: ColumnDef<TEntity> = {
			id: "createdAt",
			meta: {
				menuLabel: "Data creazione",
				cellClassName: "text-muted-foreground text-sm",
			},
			header: () => (
				<SortableHeadButton
					active={sortBy === "createdAt"}
					sortOrder={sortOrder}
					onSort={() => handleSort("createdAt")}
				>
					Data Creazione
				</SortableHeadButton>
			),
			cell: ({ row }) => formatDateIt(row.original.createdAt, { long: true }),
		};
		const actionsCol: ColumnDef<TEntity> = {
			id: "actions",
			enableHiding: false,
			meta: {
				headerClassName: "pr-6 text-right",
				cellClassName: "pr-6 text-right",
			},
			header: ({ table }) => <TableColumnsToggle table={table} align="end" />,
			cell: ({ row }) => (
				<div className="flex items-center justify-end gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => {
							setSelected(row.original);
							setEditOpen(true);
						}}
						aria-label={config.labels.rowAria.edit}
					>
						<PencilIcon className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => {
							setSelected(row.original);
							setDeleteOpen(true);
						}}
						aria-label={config.labels.rowAria.delete}
					>
						<Trash2Icon className="size-4" />
					</Button>
				</div>
			),
		};
		return [nameCol, ...(config.extraColumns ?? []), createdAtCol, actionsCol];
	}, [sortBy, sortOrder, config]);

	const rows = data?.data ?? EMPTY;

	return (
		<div className="space-y-4">
			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
					<p className="text-sm">
						Errore nel caricamento: {(error as Error).message}
					</p>
				</div>
			)}

			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
					<Input
						placeholder={config.labels.searchPlaceholder}
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							setPage(1);
						}}
						className="pl-9"
					/>
				</div>
				{config.toolbarFilter?.({ values: filterValues, set: setFilterValue })}
				{config.csvImport && (
					<Button variant="outline" onClick={() => setImportOpen(true)}>
						<UploadIcon />
						<span>Importa CSV</span>
					</Button>
				)}
			</div>

			<DataTable
				data={rows}
				columns={columns}
				storageKey={config.storageKey}
				getRowId={(row) => row.id}
				isLoading={isLoading}
				emptyState={
					<div className="flex flex-col items-center gap-2">
						{config.emptyIcon}
						<div>
							<p className="text-muted-foreground font-medium">
								{config.labels.empty.title}
							</p>
							<p className="text-muted-foreground/60 text-sm">
								{config.labels.empty.subtitle}
							</p>
						</div>
					</div>
				}
			/>

			{data?.pagination && data.pagination.total > 0 && (
				<div className="flex items-center justify-between">
					<div className="text-muted-foreground text-sm">
						{config.labels.total(data.pagination.total)}
					</div>
					<div className="flex items-center gap-4">
						<PageSizeSelector
							pageSize={limit}
							onPageSizeChange={(size) => {
								setLimit(size);
								setPage(1);
							}}
						/>
						<DataPagination
							page={page}
							totalPages={Math.ceil(data.pagination.total / limit)}
							onPageChange={setPage}
						/>
					</div>
				</div>
			)}

			<Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{config.labels.createDialog.title}</DialogTitle>
						<DialogDescription>
							{config.labels.createDialog.description}
						</DialogDescription>
					</DialogHeader>
					{config.renderForm({
						onSubmit: (form) => createMutation.mutate(form),
						onCancel: () => onCreateOpenChange(false),
						isPending: createMutation.isPending,
						submitLabel: "Crea",
						pendingLabel: "Creazione...",
					})}
				</DialogContent>
			</Dialog>

			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{config.labels.editDialog.title}</DialogTitle>
						<DialogDescription>
							{config.labels.editDialog.description}
						</DialogDescription>
					</DialogHeader>
					{selected && (
						<div key={selected.id}>
							{config.renderForm({
								defaultValues: config.editDefaults(selected),
								onSubmit: (form) =>
									updateMutation.mutate({ id: selected.id, form }),
								onCancel: () => {
									setEditOpen(false);
									setSelected(null);
								},
								isPending: updateMutation.isPending,
								submitLabel: "Salva",
								pendingLabel: "Salvataggio...",
							})}
						</div>
					)}
				</DialogContent>
			</Dialog>

			{config.csvImport && (
				<CsvImportDialog
					open={importOpen}
					onOpenChange={setImportOpen}
					title={config.csvImport.title}
					description={config.csvImport.description}
					formatHint={config.csvImport.formatHint}
					onImport={config.csvImport.onImport}
					onSuccess={invalidateAll}
				/>
			)}

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Conferma eliminazione</AlertDialogTitle>
						<AlertDialogDescription>
							{selected ? config.labels.deleteDescription(selected.name) : null}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => {
								setDeleteOpen(false);
								setSelected(null);
							}}
						>
							Annulla
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={handleDelete}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? "Eliminazione..." : "Elimina"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
