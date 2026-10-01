import path from "node:path";
import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Shared Vitest config for the three frontends. It keeps from vite.base.ts
 * only what a test needs to compile code the way the app does: path aliases
 * and React with the React Compiler (a component can behave differently once
 * compiled). TanStack Start, devtools (which opens a port), Tailwind and
 * Paraglide's plugin stay out: `pretest` compiles the Paraglide messages to
 * src/paraglide, which tests import as plain modules.
 *
 * Tests run in `node` by default; a file that renders components opts into
 * the DOM with a `// @vitest-environment jsdom` comment, so logic-only tests
 * don't pay for jsdom. Like vite.base.ts it resolves its imports from the
 * root node_modules, so `vitest` is also a root devDependency.
 */
export function makeVitestConfig() {
	return defineConfig({
		resolve: {
			tsconfigPaths: true,
			alias: {
				"~/": `${path.resolve(process.cwd(), "../../packages/ui/src")}/`,
			},
		},
		plugins: [viteReact(), babel({ presets: [reactCompilerPreset()] })],
		test: {
			environment: "node",
			include: ["src/**/*.test.{ts,tsx}"],
		},
	});
}
