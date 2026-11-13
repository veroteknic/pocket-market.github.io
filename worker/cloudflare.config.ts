import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "pocket-market-worker",
		compatibilityDate: "2026-11-10",
		entrypoint,
		env: {
			WORLD: bindings.text("World"),
			MARKET: bindings.durableObject({
				worker: "pocket-market-worker",
				exportName: "Market",
			}),
		},
		exports: {
			Market: exports.durableObject({ storage: "sqlite" }),
		},
	},
});
