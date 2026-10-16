import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'> | CollectionEntry<'books'>;

const byDateDesc = (a: Post, b: Post) => b.data.date.valueOf() - a.data.date.valueOf();

export async function getWriting(): Promise<Post[]> {
	return (await getCollection('blog', ({ data }) => !data.draft)).sort(byDateDesc);
}

export async function getBooks(): Promise<Post[]> {
	return (await getCollection('books', ({ data }) => !data.draft)).sort(byDateDesc);
}

/** Blog posts and book notes together, newest first. */
export async function getPosts(): Promise<Post[]> {
	return [...(await getWriting()), ...(await getBooks())].sort(byDateDesc);
}

export const postUrl = (post: Post) => (post.collection === 'books' ? `/books/${post.id}` : `/blog/${post.id}`);

export async function getTags(): Promise<Map<string, Post[]>> {
	const tags = new Map<string, Post[]>();
	for (const post of await getPosts()) {
		for (const tag of post.data.tags) {
			tags.set(tag, [...(tags.get(tag) ?? []), post]);
		}
	}
	return new Map([...tags].sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b)));
}

export const formatDate = (d: Date) => d.toISOString().slice(0, 10);
