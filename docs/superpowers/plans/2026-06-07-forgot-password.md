# Forgot/Reset Password Flow (P0.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the password-recovery flow: today "Hai dimenticato la password?" in the pending-verification banner navigates to `/forgot-password` **which 404s** (`as any` cast bypasses the typed router), and the better-auth native endpoint returns `400 RESET_PASSWORD_DISABLED` because no `sendResetPassword` callback is configured.

**Architecture:** Use better-auth's NATIVE endpoints (no custom API routes): `POST /auth/api/request-password-reset` + `POST /auth/api/reset-password`, driven from the FE via `authClient.requestPasswordReset()` / `authClient.resetPassword()`. Server side only needs: a `sendResetPassword` callback in `auth.ts` (with the same `/auth` URL-rewrite as `sendVerificationEmail`), a new `@bibs/emails` template, and fixing the DEAD rate-limit rule (`"/forget-password"` matches nothing in better-auth 1.6.14 — the real route is `/request-password-reset`). FE: two new routes (`/forgot-password`, `/reset-password`) in customer + seller, byte-identical like the existing `verify-email.tsx`, plus de-`as any`-ing the banner and adding a login-page link.

**Tech Stack:** better-auth 1.6.14, @bibs/emails (react-email 6 + Mailpit in dev), TanStack Start file routes, Paraglide i18n, @bibs/ui (Card/Button/Input/PasswordInput/useCooldown/toast).

**Scope:** customer + seller. Admin is OUT (greenfield: no link, no `auth_*` messages, no `ADMIN_APP_URL` — defer until someone asks).

**Key facts (from recon, verified against installed better-auth 1.6.14):**
- `sendResetPassword({ user, url, token })`, `revokeSessionsOnPasswordReset`, `resetPasswordTokenExpiresIn` (default 3600s) live INSIDE the `emailAndPassword` block.
- Unknown email → better-auth returns `{ status: true }` (anti-enumeration built-in). `requireEmailVerification` does NOT gate reset (intended: the banner serves unverified users).
- `GET /reset-password/:token?callbackURL=…` (the email link) redirects to `callbackURL?token=…` or `callbackURL?error=INVALID_TOKEN`. `redirectTo`/`callbackURL` pass `originCheck` — localhost:3001/3002 are already in `trustedOrigins`.
- Rate-limit `customRules` match by EXACT path equality; an explicit rule overrides the built-in 60s/3 default for `/request-password-reset`.

---

## Pre-flight

- [ ] **Step 0.1: Create the feature branch**

```bash
git checkout main && git pull && git checkout -b feat/forgot-password
```

---

### Task 1: Reset-password email template (`@bibs/emails`)

**Files:**
- Create: `packages/emails/emails/reset-password-email.tsx`
- Modify: `packages/emails/src/index.tsx`
- Test: `packages/emails/tests/render.test.tsx`

- [ ] **Step 1.1: Write the failing render test**

Append to `packages/emails/tests/render.test.tsx` (import `renderResetPasswordEmail` from `../src/index` alongside the existing imports):

```tsx
describe("renderResetPasswordEmail", () => {
	it("renders subject, greeting and reset url", async () => {
		const { subject, html } = await renderResetPasswordEmail({
			name: "Mario Rossi",
			resetUrl:
				"http://localhost:3000/auth/api/reset-password/tok123?callbackURL=http%3A%2F%2Flocalhost%3A3001%2Freset-password",
		});
		expect(subject).toBe("Reimposta la tua password su bibs");
		// react-email 6 inserts <!-- --> comment nodes around interpolations
		const normalized = html.replaceAll("<!-- -->", "");
		expect(normalized).toContain("Ciao Mario Rossi");
		expect(normalized).toContain("/auth/api/reset-password/tok123");
	});

	it("escapes HTML in the name", async () => {
		const { html } = await renderResetPasswordEmail({
			name: "Mario <b>&</b> Rossi",
			resetUrl: "http://localhost:3000/auth/api/reset-password/tok",
		});
		expect(html).toContain("&amp;");
		expect(html).not.toContain("<b>&</b>");
	});
});
```

- [ ] **Step 1.2: Run to verify RED**

Run: `cd packages/emails && bun test`
Expected: FAIL — `renderResetPasswordEmail` is not exported.

- [ ] **Step 1.3: Create the template**

`packages/emails/emails/reset-password-email.tsx` (clone of `verification-email.tsx` — note the react-email 6 convention: unified imports from `"react-email"`, `lang="it"` on both `Html` and `Body`, `PreviewProps` required for the preview server):

```tsx
import { Body, Html, Link, Text } from "react-email";

export interface ResetPasswordEmailProps {
	name: string;
	resetUrl: string;
}

export default function ResetPasswordEmail({
	name,
	resetUrl,
}: ResetPasswordEmailProps) {
	return (
		<Html lang="it">
			<Body lang="it">
				<Text>Ciao {name},</Text>
				<Text>
					Abbiamo ricevuto una richiesta di reimpostazione della password.
					Clicca sul link per sceglierne una nuova:
				</Text>
				<Text>
					<Link href={resetUrl}>{resetUrl}</Link>
				</Text>
				<Text>
					Se non hai richiesto tu il reset puoi ignorare questa email. Il link
					scade tra un'ora.
				</Text>
			</Body>
		</Html>
	);
}

ResetPasswordEmail.PreviewProps = {
	name: "Mario Rossi",
	resetUrl: "http://localhost:3000/auth/api/reset-password/esempio",
} satisfies ResetPasswordEmailProps;
```

- [ ] **Step 1.4: Export the renderer**

In `packages/emails/src/index.tsx`, add the import + renderer + type export, mirroring `renderVerificationEmail`:

```tsx
import ResetPasswordEmail, {
	type ResetPasswordEmailProps,
} from "../emails/reset-password-email";
```

```tsx
export async function renderResetPasswordEmail(
	props: ResetPasswordEmailProps,
): Promise<RenderedEmail> {
	return {
		subject: "Reimposta la tua password su bibs",
		html: await render(<ResetPasswordEmail {...props} />),
	};
}
```

and add `ResetPasswordEmailProps` to the `export type { ... }` line.

- [ ] **Step 1.5: Run to verify GREEN**

Run: `cd packages/emails && bun test`
Expected: PASS (all tests, old + new)

- [ ] **Step 1.6: Commit**

```bash
git add packages/emails
git commit -m "feat(auth): add reset-password email template to @bibs/emails"
```

---

### Task 2: Enable password reset in better-auth config

**Files:**
- Modify: `apps/api/src/lib/auth.ts`

- [ ] **Step 2.1: Configure `sendResetPassword`**

In `apps/api/src/lib/auth.ts`, extend the import from `@bibs/emails` (currently imports `renderVerificationEmail`) to also import `renderResetPasswordEmail`. Then replace the current block (lines ~51-54):

```ts
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
	},
```

with:

```ts
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		// Il token di reset scade in 1h (default better-auth). Revochiamo le
		// sessioni attive al reset così un eventuale attaccante con una sessione
		// rubata viene disconnesso quando l'utente reimposta la password.
		revokeSessionsOnPasswordReset: true,
		sendResetPassword: async ({ user, url }) => {
			// better-auth generates URLs using basePath "/api", but the handler
			// is mounted at "/auth" in Elysia, so the public path is "/auth/api/..."
			const fixed = new URL(url);
			fixed.pathname = `/auth${fixed.pathname}`;
			const resetUrl = fixed.toString();

			const { subject, html } = await renderResetPasswordEmail({
				name: user.name,
				resetUrl,
			});
			await sendEmail({ to: user.email, subject, html });
		},
	},
```

(The URL-rewrite is copied verbatim from `sendVerificationEmail` at lines ~73-78 — same mounting quirk, same fix.)

- [ ] **Step 2.2: Fix the dead rate-limit rule**

In the same file, `rateLimit.customRules` currently contains a rule that matches NOTHING in better-auth 1.6.14 (custom rules match by exact path equality and the route was renamed):

```ts
			"/forget-password": { window: 3600, max: 5 },
```

Replace with:

```ts
			// "/forget-password" era il nome pre-1.x: la route reale è
			// /request-password-reset (match per uguaglianza esatta del path).
			"/request-password-reset": { window: 3600, max: 5 },
			"/reset-password": { window: 3600, max: 10 },
```

- [ ] **Step 2.3: Typecheck + API tests**

```bash
bun run typecheck && cd apps/api && bun run test:unit
```
Expected: both PASS. (No integration harness exercises better-auth native endpoints — known gap tracked separately as P2.3 in `docs/audit/2026-06-07-followup-gap-analysis.md`; the e2e behavior is covered by the manual Mailpit smoke in Task 5.)

- [ ] **Step 2.4: Commit**

```bash
git add apps/api/src/lib/auth.ts
git commit -m "feat(auth): enable better-auth password reset + fix dead forget-password rate-limit rule"
```

---

### Task 3: Customer FE — `/forgot-password` + `/reset-password` routes

**Files:**
- Create: `apps/customer/src/routes/forgot-password.tsx`
- Create: `apps/customer/src/routes/reset-password.tsx`
- Modify: `apps/customer/src/features/auth/components/pending-verification-banner-connected.tsx:48-55`
- Modify: `apps/customer/src/routes/login.tsx` (add forgot-password link)
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

- [ ] **Step 3.1: Add the Paraglide keys**

Add to `apps/customer/messages/it.json` (flat snake_case keys, next to the existing `auth_*` block):

```json
	"auth_login_forgot_password": "Hai dimenticato la password?",
	"auth_forgot_password_title": "Password dimenticata",
	"auth_forgot_password_body": "Inserisci la tua email: se corrisponde a un account, ti invieremo un link per reimpostare la password.",
	"auth_forgot_password_submit": "Invia link di reset",
	"auth_forgot_password_sending": "Invio in corso...",
	"auth_forgot_password_cooldown": "Re-invia tra {seconds}s",
	"auth_forgot_password_sent_toast": "Email inviata. Controlla la tua casella.",
	"auth_forgot_password_sent_body": "Se l'email corrisponde a un account, riceverai un link a breve. Controlla anche lo spam.",
	"auth_reset_password_title": "Reimposta la password",
	"auth_reset_password_body": "Scegli una nuova password per il tuo account.",
	"auth_reset_password_new_label": "Nuova password",
	"auth_reset_password_confirm_label": "Conferma password",
	"auth_reset_password_submit": "Reimposta password",
	"auth_reset_password_submitting": "Invio in corso...",
	"auth_reset_password_too_short": "La password deve avere almeno 8 caratteri",
	"auth_reset_password_mismatch": "Le password non corrispondono",
	"auth_reset_password_invalid_token": "Link non valido o scaduto.",
	"auth_reset_password_request_new": "Richiedi un nuovo link",
	"auth_reset_password_success_toast": "Password aggiornata. Accedi con la nuova password."
```

And to `apps/customer/messages/en.json`:

```json
	"auth_login_forgot_password": "Forgot your password?",
	"auth_forgot_password_title": "Forgot password",
	"auth_forgot_password_body": "Enter your email: if it matches an account, we'll send you a link to reset your password.",
	"auth_forgot_password_submit": "Send reset link",
	"auth_forgot_password_sending": "Sending...",
	"auth_forgot_password_cooldown": "Resend in {seconds}s",
	"auth_forgot_password_sent_toast": "Email sent. Check your inbox.",
	"auth_forgot_password_sent_body": "If the email matches an account, you'll receive a link shortly. Check your spam folder too.",
	"auth_reset_password_title": "Reset your password",
	"auth_reset_password_body": "Choose a new password for your account.",
	"auth_reset_password_new_label": "New password",
	"auth_reset_password_confirm_label": "Confirm password",
	"auth_reset_password_submit": "Reset password",
	"auth_reset_password_submitting": "Submitting...",
	"auth_reset_password_too_short": "Password must be at least 8 characters",
	"auth_reset_password_mismatch": "Passwords don't match",
	"auth_reset_password_invalid_token": "Invalid or expired link.",
	"auth_reset_password_request_new": "Request a new link",
	"auth_reset_password_success_toast": "Password updated. Sign in with your new password."
```

- [ ] **Step 3.2: Create `/forgot-password`**

`apps/customer/src/routes/forgot-password.tsx` — modeled byte-for-byte on the `verify-email.tsx` structure (Card layout, useCooldown, toast, Paraglide). Note the cooldown arms ONLY after a successful send (`lastSentAt` starts `null` — deliberately avoiding the arm-on-mount bug verify-email has, tracked in the gap analysis):

```tsx
import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { Input } from "@bibs/ui/components/input";
import { toast } from "@bibs/ui/components/sonner";
import { useCooldown } from "@bibs/ui/hooks/use-cooldown";
import { createFileRoute, Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

const searchSchema = z.object({
	email: z.string().optional(),
});

export const Route = createFileRoute("/forgot-password")({
	validateSearch: searchSchema,
	component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
	const { email: emailParam } = Route.useSearch();
	const [email, setEmail] = useState(emailParam ?? "");
	const [sending, setSending] = useState(false);
	const [sentOnce, setSentOnce] = useState(false);
	const [lastSentAt, setLastSentAt] = useState<number | null>(null);
	const { secondsRemaining, ready } = useCooldown(lastSentAt ?? 0, 60_000);
	const cooldownActive = lastSentAt !== null && !ready && secondsRemaining > 0;

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (!email || sending || cooldownActive) return;
		setSending(true);
		try {
			await authClient.requestPasswordReset({
				email,
				redirectTo: `${window.location.origin}/reset-password`,
			});
			setLastSentAt(Date.now());
			setSentOnce(true);
			toast.success(m.auth_forgot_password_sent_toast());
		} catch {
			toast.error(m.auth_generic_error());
		} finally {
			setSending(false);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						<KeyRound className="size-6" />
					</div>
					<CardTitle className="text-xl">
						{m.auth_forgot_password_title()}
					</CardTitle>
					<CardDescription>{m.auth_forgot_password_body()}</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<form onSubmit={handleSubmit} className="flex flex-col gap-4">
						<Input
							type="email"
							required
							autoComplete="email"
							placeholder="email@esempio.it"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
						<Button
							type="submit"
							className="w-full"
							disabled={sending || cooldownActive || !email}
						>
							{sending
								? m.auth_forgot_password_sending()
								: cooldownActive
									? m.auth_forgot_password_cooldown({
											seconds: String(secondsRemaining),
										})
									: m.auth_forgot_password_submit()}
						</Button>
					</form>

					{sentOnce && (
						<p className="text-center text-sm text-muted-foreground">
							{m.auth_forgot_password_sent_body()}
						</p>
					)}

					<div className="border-t pt-4">
						<Link to="/login" className="block">
							<Button variant="ghost" className="w-full">
								Torna al login
							</Button>
						</Link>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 3.3: Create `/reset-password`**

`apps/customer/src/routes/reset-password.tsx`. The email link hits better-auth's `GET /auth/api/reset-password/:token`, which redirects here with `?token=…` (valid) or `?error=INVALID_TOKEN` (invalid/expired):

```tsx
import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { PasswordInput } from "@bibs/ui/components/password-input";
import { toast } from "@bibs/ui/components/sonner";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

const searchSchema = z.object({
	token: z.string().optional(),
	error: z.string().optional(),
});

export const Route = createFileRoute("/reset-password")({
	validateSearch: searchSchema,
	component: ResetPasswordPage,
});

function ResetPasswordPage() {
	const navigate = useNavigate();
	const { token, error } = Route.useSearch();
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const invalidToken = !token || error === "INVALID_TOKEN";

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (submitting || !token) return;
		if (password.length < 8) {
			setFormError(m.auth_reset_password_too_short());
			return;
		}
		if (password !== confirmPassword) {
			setFormError(m.auth_reset_password_mismatch());
			return;
		}
		setFormError(null);
		setSubmitting(true);
		try {
			const res = await authClient.resetPassword({
				newPassword: password,
				token,
			});
			if (res.error) {
				setFormError(m.auth_reset_password_invalid_token());
				return;
			}
			toast.success(m.auth_reset_password_success_toast());
			void navigate({ to: "/login" });
		} catch {
			toast.error(m.auth_generic_error());
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						<KeyRound className="size-6" />
					</div>
					<CardTitle className="text-xl">
						{m.auth_reset_password_title()}
					</CardTitle>
					<CardDescription>
						{invalidToken
							? m.auth_reset_password_invalid_token()
							: m.auth_reset_password_body()}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{invalidToken ? (
						<Link to="/forgot-password" className="block">
							<Button className="w-full">
								{m.auth_reset_password_request_new()}
							</Button>
						</Link>
					) : (
						<form onSubmit={handleSubmit} className="flex flex-col gap-4">
							<PasswordInput
								required
								autoComplete="new-password"
								placeholder={m.auth_reset_password_new_label()}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
							/>
							<PasswordInput
								required
								autoComplete="new-password"
								placeholder={m.auth_reset_password_confirm_label()}
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
							/>
							{formError && (
								<p className="text-sm text-destructive">{formError}</p>
							)}
							<Button type="submit" className="w-full" disabled={submitting}>
								{submitting
									? m.auth_reset_password_submitting()
									: m.auth_reset_password_submit()}
							</Button>
						</form>
					)}

					<div className="border-t pt-4">
						<Link to="/login" className="block">
							<Button variant="ghost" className="w-full">
								Torna al login
							</Button>
						</Link>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
```

Note: if `PasswordInput`'s props differ (check `packages/ui/src/components/password-input.tsx` — it is already used by `apps/customer/src/routes/login.tsx`), align `value`/`onChange`/`placeholder` usage with the login page's usage.

- [ ] **Step 3.4: Fix the banner navigation (remove `as any`)**

In `apps/customer/src/features/auth/components/pending-verification-banner-connected.tsx`, replace the handler (lines ~48-55):

```tsx
	const onForgotPassword = () => {
		// La route /forgot-password non esiste ancora (out of scope dello spec).
		// Il link punta al placeholder per quando la feature arriverà.
		void navigate({
			to: "/forgot-password" as any,
			search: { email } as any,
		});
	};
```

with:

```tsx
	const onForgotPassword = () => {
		void navigate({
			to: "/forgot-password",
			search: { email },
		});
	};
```

- [ ] **Step 3.5: Add the login-page link**

In `apps/customer/src/routes/login.tsx`, add below the submit button (inside the form layout; add `import { m } from "@/paraglide/messages";` if not present):

```tsx
					<Link
						to="/forgot-password"
						className="text-center text-sm text-muted-foreground hover:underline"
					>
						{m.auth_login_forgot_password()}
					</Link>
```

- [ ] **Step 3.6: Regenerate the route tree + typecheck**

Start `bun run dev:customer` briefly (the TanStack plugin regenerates `routeTree.gen.ts` on boot — the new routes must be in the tree or the banner's typed `to: "/forgot-password"` fails), stop it, then:

Run: `bun run typecheck`
Expected: PASS — note that the `as any` removal in Step 3.4 only compiles AFTER the route tree includes `/forgot-password`.

- [ ] **Step 3.7: Commit**

```bash
git add apps/customer
git commit -m "feat(auth): customer forgot/reset password pages + banner link fix"
```

---

### Task 4: Seller FE — mirror of Task 3

**Files:**
- Create: `apps/seller/src/routes/forgot-password.tsx` (byte-identical to customer's)
- Create: `apps/seller/src/routes/reset-password.tsx` (byte-identical to customer's)
- Modify: `apps/seller/src/features/auth/components/pending-verification-banner-connected.tsx:48-55` (same fix as Step 3.4 — the two files are byte-identical)
- Modify: `apps/seller/src/routes/login.tsx` (link below `<LoginForm>`, same snippet as Step 3.5)
- Modify: `apps/seller/messages/it.json`, `apps/seller/messages/en.json` (same key blocks as Step 3.1)

- [ ] **Step 4.1: Apply all five changes**

Copy the two route files from customer verbatim (this mirrors the existing convention: `verify-email.tsx` is already byte-identical across the two apps; both use the same `@/lib/auth-client` and `@/paraglide/messages` aliases so no edits are needed). Add the message keys to both seller locale files. Apply the banner fix. Add the login link in `apps/seller/src/routes/login.tsx` below the `<LoginForm …/>` element.

- [ ] **Step 4.2: Regenerate route tree + typecheck**

Start `bun run dev:seller` briefly, stop it, then run from root:

```bash
bun run typecheck && bun run lint
```
Expected: both PASS

- [ ] **Step 4.3: Commit**

```bash
git add apps/seller
git commit -m "feat(auth): seller forgot/reset password pages + banner link fix"
```

---

### Task 5: End-to-end verification (manual, Mailpit)

UI changes require a real browser pass (repo rule: typecheck alone does not verify UI).

- [ ] **Step 5.1: Boot the stack**

```bash
docker compose up -d   # postgres + minio + mailpit (porta 8025)
bun run dev            # api :3000, customer :3001, seller :3002
```
(Memory gotcha: if postgres fails to bind, check the 5432 contention with area-postgres — Docker Desktop may need a container recreate.)

- [ ] **Step 5.2: Happy path (customer)**

1. Open `http://localhost:3001/login` → click "Hai dimenticato la password?" → lands on `/forgot-password` (NOT a 404).
2. Enter the seeded customer email → submit → success toast; button shows the 60s cooldown.
3. Open Mailpit `http://localhost:8025` → "Reimposta la tua password su bibs" email → click the link.
4. Browser lands on `http://localhost:3001/reset-password?token=…` → form visible (not the invalid-token state).
5. Set a new password (≥8 chars, matching confirm) → success toast → redirected to `/login`.
6. Log in with the NEW password → works. Old password → fails.

- [ ] **Step 5.3: Sad paths**

1. `http://localhost:3001/reset-password` (no token) → invalid-token state with "Richiedi un nuovo link".
2. Re-use the SAME email link from step 5.2 → better-auth redirects with `?error=INVALID_TOKEN` (token consumed) → invalid-token state.
3. Mismatched confirm password → inline "Le password non corrispondono", no request fired.
4. Unknown email on `/forgot-password` → SAME success toast (anti-enumeration — no account-existence leak).

- [ ] **Step 5.4: Seller spot-check**

Repeat 5.2 steps 1-5 on `http://localhost:3002` with the seller (`seller@dev.bibs`); also verify the pending-verification banner's "Hai dimenticato la password?" navigates correctly with the email prefilled.

- [ ] **Step 5.5: API regression + push + PR**

```bash
cd apps/api && bun run test && cd ../..
git push -u origin feat/forgot-password
```

Open the PR (`/commit-commands:commit-push-pr` or `gh pr create`) with title:
`feat(auth): forgot/reset password flow (customer + seller)`

PR body must cover: the 404 bug + `RESET_PASSWORD_DISABLED`, native-endpoints architecture (no custom API routes), the dead `"/forget-password"` rate-limit rule fix, `revokeSessionsOnPasswordReset: true` rationale, anti-enumeration behavior, and admin explicitly out of scope.

---

## Notes & gotchas for the implementer

- The reset URL MUST be `/auth`-rewritten in `sendResetPassword` (better-auth builds it with `basePath: "/api"` but the handler is mounted at `/auth`) — otherwise the email link 404s. The rewrite is copied from `sendVerificationEmail`.
- Client methods are `authClient.requestPasswordReset(...)` / `authClient.resetPassword(...)` — NOT `forgetPassword` (that name exists only on the email-otp plugin).
- The FE uses `authClient` (better-auth fetch), NOT the Eden treaty `api()` — no Eden date-hydration concerns here.
- `useCooldown(lastSentAt ?? 0, 60_000)` with `lastSentAt` starting `null`: cooldown arms only after a real send (do NOT copy verify-email's arm-on-mount `useState(() => Date.now())` — that's a known bug, P4 in the gap analysis).
- No FE test infra exists (zero FE tests in the repo) — Task 5's manual pass IS the verification gate for the routes.
- `greeting` uses `user.name`, which can be empty at signup (memory: no name field) — the email then reads "Ciao ,". Accept for now: the greeting-local-part fix is a separate tracked follow-up (P6 in the gap analysis); don't fold it in here.
