import path from "node:path";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Shared Vite config for the three TanStack Start frontends. They differ only
 * by the devtools event-bus port. The `~/` alias points at @bibs/ui/src,
 * resolved from `process.cwd()` — each app runs `vite` from its own directory,
 * so this is the app dir (same as `__dirname` was in the per-app configs).
 */
export function makeViteConfig(devtoolsPort: number) {
	return defineConfig({
		resolve: {
			tsconfigPaths: true,
			alias: {
				"~/": `${path.resolve(process.cwd(), "../../packages/ui/src")}/`,
			},
		},
		ssr: {
			noExternal: ["@bibs/ui"],
		},
		plugins: [
			devtools({ eventBusConfig: { port: devtoolsPort } }),
			paraglideVitePlugin({
				project: "./project.inlang",
				outdir: "./src/paraglide",
				strategy: ["url", "baseLocale"],
			}),
			tailwindcss(),
			tanstackStart(),
			viteReact(),
			babel({ presets: [reactCompilerPreset()] }),
		],
	});
}
