import {
	CalendarDaysIcon,
	LayersIcon,
	type LucideIcon,
	SlidersHorizontalIcon,
	TagIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { CategoryCrudPanel } from "@/features/crud/category-crud-panel";
import { HolidaysPanel } from "@/features/holidays/components/holidays-panel";
import { productCategoriesConfig } from "@/features/product-categories/product-categories.config";
import { productCharacteristicsConfig } from "@/features/product-characteristics/product-characteristics.config";
import { productMacroCategoriesConfig } from "@/features/product-macro-categories/product-macro-categories.config";
import { storeCategoriesConfig } from "@/features/store-categories/store-categories.config";
import { storeMacroCategoriesConfig } from "@/features/store-macro-categories/store-macro-categories.config";
import { m } from "@/paraglide/messages";

interface PanelProps {
	createOpen: boolean;
	onCreateOpenChange: (open: boolean) => void;
}

export interface ConfigurationSection {
	slug: string;
	group: "products" | "stores" | "calendar";
	// L'icona dice il tipo di voce, il gruppo dice il dominio.
	icon: LucideIcon;
	// Testi come funzioni: vanno letti a ogni render, dopo un cambio di lingua.
	title: () => string;
	cardTitle: () => string;
	description: () => string;
	createLabel: () => string;
	countKey?:
		| "productMacroCategories"
		| "productCategories"
		| "productCharacteristics"
		| "storeMacroCategories"
		| "storeCategories";
	render: (p: PanelProps) => ReactNode;
}

export const configurationGroups = [
	{ id: "products", label: m.configurations_group_products },
	{ id: "stores", label: m.configurations_group_stores },
	{ id: "calendar", label: m.configurations_group_calendar },
] as const;

export const configurationSections: ConfigurationSection[] = [
	{
		slug: "product-macro-categories",
		group: "products",
		icon: LayersIcon,
		title: m.configurations_section_product_macro_categories,
		cardTitle: m.configurations_card_macro_categories,
		description: m.configurations_desc_product_macro_categories,
		createLabel: m.configurations_new_category,
		countKey: "productMacroCategories",
		render: (p) => (
			<CategoryCrudPanel config={productMacroCategoriesConfig} {...p} />
		),
	},
	{
		slug: "product-categories",
		group: "products",
		icon: TagIcon,
		title: m.configurations_section_product_categories,
		cardTitle: m.configurations_card_categories,
		description: m.configurations_desc_product_categories,
		createLabel: m.configurations_new_category,
		countKey: "productCategories",
		render: (p) => (
			<CategoryCrudPanel config={productCategoriesConfig} {...p} />
		),
	},
	{
		slug: "product-characteristics",
		group: "products",
		icon: SlidersHorizontalIcon,
		title: m.configurations_section_product_characteristics,
		cardTitle: m.configurations_card_characteristics,
		description: m.configurations_desc_product_characteristics,
		createLabel: m.configurations_new_characteristic,
		countKey: "productCharacteristics",
		render: (p) => (
			<CategoryCrudPanel config={productCharacteristicsConfig} {...p} />
		),
	},
	{
		slug: "store-macro-categories",
		group: "stores",
		icon: LayersIcon,
		title: m.configurations_section_store_macro_categories,
		cardTitle: m.configurations_card_macro_categories,
		description: m.configurations_desc_store_macro_categories,
		createLabel: m.configurations_new_category,
		countKey: "storeMacroCategories",
		render: (p) => (
			<CategoryCrudPanel config={storeMacroCategoriesConfig} {...p} />
		),
	},
	{
		slug: "store-categories",
		group: "stores",
		icon: TagIcon,
		title: m.configurations_section_store_categories,
		cardTitle: m.configurations_card_categories,
		description: m.configurations_desc_store_categories,
		createLabel: m.configurations_new_category,
		countKey: "storeCategories",
		render: (p) => <CategoryCrudPanel config={storeCategoriesConfig} {...p} />,
	},
	{
		slug: "holidays",
		group: "calendar",
		icon: CalendarDaysIcon,
		title: m.configurations_section_holidays,
		cardTitle: m.configurations_section_holidays,
		description: m.configurations_desc_holidays,
		createLabel: m.configurations_new_holiday,
		render: (p) => <HolidaysPanel {...p} />,
	},
];
