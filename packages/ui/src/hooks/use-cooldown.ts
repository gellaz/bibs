import { useEffect, useState } from "react";

export type UseCooldownResult = {
	remaining: number; // milliseconds
	secondsRemaining: number; // ceil(remaining / 1000)
	ready: boolean;
};

/** The cooldown at instant `now`. Pure, so the rounding is testable. */
export function cooldownState(
	startedAt: number | null,
	durationMs: number,
	now: number,
): UseCooldownResult {
	if (startedAt == null) {
		return { remaining: 0, secondsRemaining: 0, ready: true };
	}
	const remaining = Math.max(0, durationMs - (now - startedAt));
	return {
		remaining,
		secondsRemaining: Math.ceil(remaining / 1000),
		ready: remaining === 0,
	};
}

/**
 * Delay until `secondsRemaining` next changes. A fixed 1s interval started at
 * an arbitrary offset shows each number for the wrong span (and the last one
 * for up to ~2s); waking on the boundary keeps the label in step with the clock.
 */
export function msUntilNextSecond(remaining: number): number {
	return remaining % 1000 || 1000;
}

/**
 * Cooldown start from a `sentAt` search param: `null` when nothing was sent
 * (the page was opened from a link, not right after a send), and never in the
 * future — a skewed clock or an edited URL must not block resend for an hour.
 */
export function sentAtFromSearch(
	sentAt: number | undefined,
	now: number,
): number | null {
	return sentAt === undefined ? null : Math.min(sentAt, now);
}

/**
 * Cooldown timer driven by an `startedAt` epoch (ms) and a `durationMs`.
 *
 * - Returns `ready: true` when `startedAt` is null OR when now - startedAt >= durationMs.
 * - Re-renders each time the displayed second changes, until ready.
 * - Cleans up the timer on unmount or when startedAt changes.
 *
 * The hook does NOT call back when ready — the consumer reads `ready` from the
 * return value to decide whether to enable a button etc.
 */
export function useCooldown(
	startedAt: number | null,
	durationMs: number,
): UseCooldownResult {
	const [state, setState] = useState<UseCooldownResult>(() =>
		cooldownState(startedAt, durationMs, Date.now()),
	);

	useEffect(() => {
		let id: ReturnType<typeof setTimeout> | undefined;
		const tick = () => {
			const next = cooldownState(startedAt, durationMs, Date.now());
			setState(next);
			if (!next.ready) id = setTimeout(tick, msUntilNextSecond(next.remaining));
		};
		// Recompute immediately when inputs change.
		tick();
		return () => clearTimeout(id);
	}, [startedAt, durationMs]);

	return state;
}
