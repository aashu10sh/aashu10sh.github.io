import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPosts, postUrl } from '../lib/posts';

export async function GET(context: APIContext) {
	const site = context.site!;
	const posts = await getPosts();
	return rss({
		title: 'Aashutosh Pudasaini',
		description: 'Writing on software, systems, and books.',
		site,
		items: posts.map((post) => ({
			title: post.data.title,
			description: post.data.description,
			pubDate: post.data.date,
			link: postUrl(post),
			categories: post.data.tags,
			// Root-relative image paths don't resolve in feed readers.
			content: post.rendered?.html.replaceAll('src="/', `src="${site.origin}/`),
		})),
		customData: '<language>en</language>',
	});
}
