// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';

// Book reviews that lived under /blog/ on the old Zola site before moving to /books/.
const legacyBooks = [
	'1984',
	'am',
	'animal-farm',
	'frankenstien',
	'no-longer-human',
	'post-office',
	'the-catcher-in-the-rye',
	'the-death-of-ivan-ilyich',
	'the-sailor-who-fell-from-grace-with-the-sea',
	'the-stranger',
	'white-nights',
];

// https://astro.build/config
export default defineConfig({
	// The site's public URL: canonical links, RSS links and feed image URLs all derive from this.
	// Switch it to the custom domain once one is set up.
	site: 'https://aashu10sh.github.io',
	// Keep links to the old Zola site working. (Its feed at /blog/feed.xml is served by src/pages/blog/feed.xml.ts.)
	redirects: {
		'/blog': '/blogs',
		'/categories': '/tags',
		'/categories/books': '/books',
		'/categories/events': '/tags/events',
		'/categories/tech': '/tags/tech',
		...Object.fromEntries(legacyBooks.map((slug) => [`/blog/${slug}`, `/books/${slug}`])),
	},
	markdown: {
		shikiConfig: {
			themes: { light: 'github-light', dark: 'github-dark' },
		},
	},
	integrations: [react(), mdx()],
	vite: {
		// @astrojs/react 7.1.7 on astro 7.4.1 doesn't pre-bundle React's CJS entry points in dev,
		// which breaks hydration with "does not provide an export named 'createRoot'".
		optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'] },
	},
});
