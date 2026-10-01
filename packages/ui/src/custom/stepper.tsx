"use client";

import { CheckIcon } from "lucide-react";
import {
	Children,
	type ComponentProps,
	createContext,
	type ReactNode,
	use,
} from "react";
import { cn } from "~/lib/utils";

// ── Context ─────────────────────────────────

interface StepperContextValue {
	activeStep: number;
	totalSteps: number;
}

const StepperContext = createContext<StepperContextValue>({
	activeStep: 0,
	totalSteps: 0,
});

// ── Internal context for StepperItem index ──

interface StepperItemContextValue {
	index: number;
	isCompleted: boolean;
	isCurrent: boolean;
}

const StepperItemContext = createContext<StepperItemContextValue>({
	index: 0,
	isCompleted: false,
	isCurrent: false,
});

// ── Stepper ─────────────────────────────────

interface StepperProps extends Omit<ComponentProps<"nav">, "children"> {
	/** Zero-based index of the currently active step. Steps before this index are marked as completed. */
	activeStep: number;
	/** `StepperItem` children. The number of children determines the total steps. */
	children: ReactNode;
}

/**
 * A multi-step progress indicator.
 *
 * Uses CSS Grid for perfectly equidistant steps and animated connectors.
 * Fully responsive: on mobile (`< sm`) only the current step label is shown.
 *
 * @example
 * ```tsx
 * <Stepper activeStep={2}>
 *   <StepperItem>
 *     <StepperIndicator />
 *     <StepperTitle>Account</StepperTitle>
 *   </StepperItem>
 *   <StepperItem>
 *     <StepperIndicator />
 *     <StepperTitle>Details</StepperTitle>
 *   </StepperItem>
 *   <StepperItem>
 *     <StepperIndicator />
 *     <StepperTitle>Confirm</StepperTitle>
 *   </StepperItem>
 * </Stepper>
 * ```
 */
function Stepper({ activeStep, children, className, ...props }: StepperProps) {
	const totalSteps = Children.count(children);

	return (
		<StepperContext value={{ activeStep, totalSteps }}>
			<nav
				aria-label="Progress"
				data-slot="stepper"
				className={cn("w-full", className)}
				{...props}
			>
				<ol
					data-slot="stepper-list"
					className="flex items-start"
					style={{
						display: "grid",
						gridTemplateColumns: `repeat(${totalSteps}, 1fr)`,
					}}
				>
					{Children.map(children, (child, index) => (
						<StepperItemContext
							value={{
								index,
								isCompleted: index < activeStep,
								isCurrent: index === activeStep,
							}}
						>
							{child}
						</StepperItemContext>
					))}
				</ol>
			</nav>
		</StepperContext>
	);
}

// ── StepperItem ─────────────────────────────

interface StepperItemProps extends ComponentProps<"li"> {}

/** A single step in the stepper. Renders its children and an animated connector line to the next step. */
function StepperItem({ className, children, ...props }: StepperItemProps) {
	const { totalSteps } = use(StepperContext);
	const { index, isCompleted, isCurrent } = use(StepperItemContext);
	const isLast = index === totalSteps - 1;

	return (
		<li
			data-slot="stepper-item"
			data-state={isCompleted ? "completed" : isCurrent ? "active" : "upcoming"}
			aria-current={isCurrent ? "step" : undefined}
			className={cn("relative flex flex-col items-center gap-2", className)}
			{...props}
		>
			{children}
			{!isLast && (
				<div
					data-slot="stepper-separator"
					className="absolute top-4 left-[calc(50%+20px)] right-[calc(-50%+20px)] h-0.5 rounded-full bg-muted-foreground/20"
				>
					<div
						className={cn(
							"h-full rounded-full bg-primary transition-all duration-500 ease-in-out",
							isCompleted ? "w-full" : "w-0",
						)}
					/>
				</div>
			)}
		</li>
	);
}

// ── StepperIndicator ────────────────────────

interface StepperIndicatorProps extends ComponentProps<"div"> {}

/** Circular step indicator showing the step number or a check icon when completed. */
function StepperIndicator({ className, ...props }: StepperIndicatorProps) {
	const { index, isCompleted, isCurrent } = use(StepperItemContext);

	return (
		<div
			data-slot="stepper-indicator"
			className={cn(
				"relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all duration-300",
				isCompleted &&
					"border-primary bg-primary text-primary-foreground scale-100",
				isCurrent &&
					"border-primary bg-primary/10 text-primary ring-primary/20 ring-4",
				!isCompleted &&
					!isCurrent &&
					"border-muted-foreground/25 bg-background text-muted-foreground/40",
				className,
			)}
			{...props}
		>
			{isCompleted ? (
				<CheckIcon className="size-4 animate-in fade-in zoom-in duration-300" />
			) : (
				<span>{index + 1}</span>
			)}
		</div>
	);
}

// ── StepperTitle ────────────────────────────

interface StepperTitleProps extends ComponentProps<"span"> {}

/** Label text for a step. On mobile (`< sm`), only the active step label is visible. */
function StepperTitle({ className, children, ...props }: StepperTitleProps) {
	const { isCurrent, isCompleted } = use(StepperItemContext);

	return (
		<span
			data-slot="stepper-title"
			className={cn(
				"text-xs text-center transition-colors duration-300",
				isCurrent && "font-medium text-foreground",
				isCompleted && "text-muted-foreground hidden sm:block",
				!isCurrent &&
					!isCompleted &&
					"text-muted-foreground/50 hidden sm:block",
				className,
			)}
			{...props}
		>
			{children}
		</span>
	);
}

export { Stepper, StepperIndicator, StepperItem, StepperTitle };
