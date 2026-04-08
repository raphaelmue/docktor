import {parse as parseYaml, stringify as stringifyYaml} from "yaml";

export interface VolumeSelection {
	originalPath: string;
	newPath: string;
	convert: boolean; // true = copy and rewrite, false = leave as-is
}

export interface RewriteResult {
	rewrittenCompose: string;
	extractedEnv: string;
	envVars: Record<string, string>;
}

export class ComposeRewriter {
	/**
	 * Rewrite compose file:
	 * 1. Update volume paths based on selections
	 * 2. Extract inline environment variables to .env format
	 * 3. Mark unconverted named volumes as external
	 */
	rewrite(
		originalCompose: string,
		volumeSelections: VolumeSelection[],
		namedVolumeSelections: Map<string, boolean>, // volumeName -> convert (true = bind mount, false = keep as named)
	): RewriteResult {
		const doc = parseYaml(originalCompose);
		const extractedEnvVars: Record<string, string> = {};

		// Create lookup for volume path rewrites
		const pathRewrites = new Map<string, string>();
		for (const sel of volumeSelections) {
			if (sel.convert) {
				pathRewrites.set(sel.originalPath, sel.newPath);
			}
		}

		// Rewrite service volumes and extract environment variables
		for (const [serviceName, service] of Object.entries(doc.services || {})) {
			const svc = service as any;

			// Rewrite volume paths
			if (Array.isArray(svc.volumes)) {
				svc.volumes = svc.volumes.map((vol: string | object) => {
					if (typeof vol !== "string") return vol; // Skip long-form syntax

					const parts = vol.split(":");
					const hostPath = parts[0];
					const rest = parts.slice(1);

					// Check if this is a named volume reference
					if (!hostPath.startsWith(".") && !hostPath.startsWith("/")) {
						const shouldConvert = namedVolumeSelections.get(hostPath);
						if (shouldConvert) {
							// Convert named volume to bind mount
							return [`./volumes/${hostPath}`, ...rest].join(":");
						}
						// Keep as named volume (will mark as external below)
						return vol;
					}

					// Rewrite bind mount path if selected for conversion
					const newPath = pathRewrites.get(hostPath);
					if (newPath) {
						return [newPath, ...rest].join(":");
					}

					return vol;
				});
			}

			// Extract inline environment variables (object form)
			if (svc.environment && typeof svc.environment === "object" && !Array.isArray(svc.environment)) {
				const inlineEnv = svc.environment;
				const envRefs: string[] = [];

				for (const [key, value] of Object.entries(inlineEnv)) {
					extractedEnvVars[key] = String(value);
					envRefs.push(key); // Will reference via ${KEY} in array form
				}

				// Replace object form with array form referencing .env
				svc.environment = envRefs.map(k => `\${${k}}`);
			}
		}

		// Update top-level volumes: mark unconverted named volumes as external
		if (doc.volumes) {
			const newVolumes: Record<string, any> = {};
			for (const [volName, volDef] of Object.entries(doc.volumes)) {
				const shouldConvert = namedVolumeSelections.get(volName);
				if (shouldConvert) {
					// Remove from volumes section (now a bind mount)
					continue;
				}
				// Keep as external named volume
				newVolumes[volName] = {external: true};
			}
			if (Object.keys(newVolumes).length > 0) {
				doc.volumes = newVolumes;
			} else {
				delete doc.volumes;
			}
		}

		const rewrittenCompose = stringifyYaml(doc, {
			lineWidth: 0, // Prevent line wrapping
		});

		const extractedEnv = Object.entries(extractedEnvVars)
			.map(([key, value]) => `${key}=${value}`)
			.join("\n");

		return {
			rewrittenCompose,
			extractedEnv,
			envVars: extractedEnvVars,
		};
	}

	/**
	 * Generate unified diff for preview
	 */
	generateDiff(originalCompose: string, rewrittenCompose: string): string {
		// Simple line-by-line diff for preview
		const origLines = originalCompose.split("\n");
		const newLines = rewrittenCompose.split("\n");

		const diffLines: string[] = [];
		const maxLen = Math.max(origLines.length, newLines.length);

		for (let i = 0; i < maxLen; i++) {
			const orig = origLines[i];
			const newL = newLines[i];

			if (orig === newL) {
				if (orig !== undefined) diffLines.push(`  ${orig}`);
			} else {
				if (orig !== undefined) diffLines.push(`- ${orig}`);
				if (newL !== undefined) diffLines.push(`+ ${newL}`);
			}
		}

		return diffLines.join("\n");
	}
}

export const composeRewriter = new ComposeRewriter();
