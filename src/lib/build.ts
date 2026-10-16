import { execSync } from 'node:child_process';

// Evaluated once at build time.
function commit(): string | undefined {
	const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA;
	if (fromEnv) return fromEnv.slice(0, 7);
	try {
		return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch {
		return undefined;
	}
}

export const build = {
	// en-CA formats as YYYY-MM-DD.
	date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' }),
	commit: commit(),
};
