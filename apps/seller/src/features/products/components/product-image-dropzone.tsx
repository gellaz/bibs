import {
	Dropzone,
	DropzoneContent,
	DropzoneEmptyState,
} from "@bibs/ui/components/dropzone";
import { Label } from "@bibs/ui/components/label";
import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	horizontalListSortingStrategy,
	SortableContext,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripIcon, StarIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface ExistingImage {
	id: string;
	url: string;
}

/** A unified item that can be either an existing server image or a new local file. */
type ImageItem =
	| { type: "existing"; id: string; url: string }
	| { type: "new"; id: string; file: File };

interface ProductImageDropzoneProps {
	files: File[];
	onDrop: (acceptedFiles: File[]) => void;
	onRemoveFile: (index: number) => void;
	onReorderFiles: (files: File[]) => void;
	existingImages?: ExistingImage[];
	onDeleteExisting?: (imageId: string) => void;
	onReorderExisting?: (imageIds: string[]) => void;
	maxFiles?: number;
	maxSize?: number;
}

export function ProductImageDropzone({
	files,
	onDrop,
	onRemoveFile,
	onReorderFiles,
	existingImages = [],
	onDeleteExisting,
	onReorderExisting,
	maxFiles = 10,
	maxSize = 5 * 1024 * 1024,
}: ProductImageDropzoneProps) {
	const totalCount = existingImages.length + files.length;

	// Assign stable IDs to new files via a WeakMap
	const fileIdMap = useRef(new WeakMap<File, string>());
	const fileIdCounter = useRef(0);
	const getFileId = (file: File) => {
		let id = fileIdMap.current.get(file);
		if (!id) {
			id = `new-${fileIdCounter.current++}`;
			fileIdMap.current.set(file, id);
		}
		return id;
	};

	// Rebuild items from props
	const buildItems = (): ImageItem[] => [
		...existingImages.map(
			(img): ImageItem => ({ type: "existing", id: img.id, url: img.url }),
		),
		...files.map(
			(file): ImageItem => ({ type: "new", id: getFileId(file), file }),
		),
	];

	const [items, setItems] = useState<ImageItem[]>(buildItems);

	// Sync items when props change externally (add/delete), but not on reorder
	const prevExistingIds = useRef(existingImages.map((img) => img.id).join(","));
	const prevFileIds = useRef(files.map((f) => getFileId(f)).join(","));

	useEffect(() => {
		const existingIds = existingImages.map((img) => img.id).join(",");
		const fileIds = files.map((f) => getFileId(f)).join(",");

		// Detect external changes: items added or removed (set differs, not just order)
		const prevExistingSet = new Set(prevExistingIds.current.split(","));
		const currExistingSet = new Set(existingImages.map((img) => img.id));
		const prevFileSet = new Set(prevFileIds.current.split(","));
		const currFileSet = new Set(files.map((f) => getFileId(f)));

		const existingChanged =
			prevExistingSet.size !== currExistingSet.size ||
			[...prevExistingSet].some((id) => !currExistingSet.has(id));
		const filesChanged =
			prevFileSet.size !== currFileSet.size ||
			[...prevFileSet].some((id) => !currFileSet.has(id));

		if (existingChanged || filesChanged) {
			// Items were added or removed — rebuild, keeping current order for surviving items
			const survivingItems = items.filter((item) => {
				if (item.type === "existing") return currExistingSet.has(item.id);
				return currFileSet.has(item.id);
			});
			// Add any new items at the end
			const survivingIds = new Set(survivingItems.map((item) => item.id));
			const newExistingItems = existingImages
				.filter((img) => !survivingIds.has(img.id))
				.map(
					(img): ImageItem => ({
						type: "existing",
						id: img.id,
						url: img.url,
					}),
				);
			const newFileItems = files
				.filter((file) => !survivingIds.has(getFileId(file)))
				.map(
					(file): ImageItem => ({
						type: "new",
						id: getFileId(file),
						file,
					}),
				);
			setItems([...survivingItems, ...newExistingItems, ...newFileItems]);
		}

		prevExistingIds.current = existingIds;
		prevFileIds.current = fileIds;
	}, [existingImages, files]);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
	);

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const oldIndex = items.findIndex((item) => item.id === active.id);
		const newIndex = items.findIndex((item) => item.id === over.id);
		if (oldIndex === -1 || newIndex === -1) return;

		const reordered = arrayMove(items, oldIndex, newIndex);

		// Update local state immediately for instant visual feedback
		setItems(reordered);

		// Notify parents
		const newExisting = reordered.filter(
			(item): item is ImageItem & { type: "existing" } =>
				item.type === "existing",
		);
		const newFiles = reordered.filter(
			(item): item is ImageItem & { type: "new" } => item.type === "new",
		);

		onReorderExisting?.(newExisting.map((img) => img.id));
		onReorderFiles(newFiles.map((f) => f.file));
	};

	return (
		<div className="space-y-2">
			<Label>
				Immagini
				{totalCount > 0 && (
					<span className="ml-1 text-xs font-normal text-muted-foreground">
						({totalCount}/{maxFiles})
					</span>
				)}
			</Label>
			<Dropzone
				src={files.length > 0 ? files : undefined}
				onDrop={onDrop}
				maxFiles={maxFiles}
				maxSize={maxSize}
				accept={{ "image/*": [".png", ".jpg", ".jpeg", ".webp"] }}
			>
				<DropzoneContent />
				<DropzoneEmptyState />
			</Dropzone>
			{items.length > 0 && (
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
				>
					<SortableContext
						items={items.map((item) => item.id)}
						strategy={horizontalListSortingStrategy}
					>
						<div className="flex flex-wrap gap-2">
							{items.map((item, index) => (
								<SortableImageItem
									key={item.id}
									item={item}
									isDefault={index === 0}
									onDelete={() => {
										if (item.type === "existing") {
											onDeleteExisting?.(item.id);
										} else {
											const fileIndex = files.indexOf(item.file);
											if (fileIndex !== -1) onRemoveFile(fileIndex);
										}
									}}
								/>
							))}
						</div>
					</SortableContext>
				</DndContext>
			)}
		</div>
	);
}

function SortableImageItem({
	item,
	isDefault,
	onDelete,
}: {
	item: ImageItem;
	isDefault: boolean;
	onDelete: () => void;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: item.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		zIndex: isDragging ? 10 : undefined,
	};

	const src =
		item.type === "existing" ? item.url : URL.createObjectURL(item.file);

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`group relative ${isDragging ? "opacity-50" : ""}`}
		>
			<img
				src={src}
				alt=""
				className={`size-20 rounded-md border object-cover ${isDefault ? "ring-2 ring-primary" : ""}`}
			/>
			{/* Drag handle */}
			<button
				type="button"
				{...attributes}
				{...listeners}
				className="absolute bottom-0.5 left-0.5 hidden size-5 cursor-grab items-center justify-center rounded bg-background/80 text-muted-foreground active:cursor-grabbing group-hover:flex"
			>
				<GripIcon className="size-3" />
			</button>
			{/* Default badge */}
			{isDefault && (
				<span className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5 rounded bg-primary px-1 py-0.5 text-[10px] font-medium leading-none text-primary-foreground">
					<StarIcon className="size-2.5" />
				</span>
			)}
			{/* Delete button */}
			<button
				type="button"
				onClick={onDelete}
				className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-destructive text-white shadow-sm ring-2 ring-background group-hover:flex"
			>
				<XIcon className="size-3" />
			</button>
		</div>
	);
}
