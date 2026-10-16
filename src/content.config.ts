import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const schema = z.object({
	title: z.string(),
	date: z.coerce.date(),
	description: z.string().default(''),
	tags: z.array(z.string()).default([]),
	draft: z.boolean().default(false),
});

const blog = defineCollection({
	loader: glob({ base: './src/content/blog', pattern: '**/*.md' }),
	schema,
});

const books = defineCollection({
	loader: glob({ base: './src/content/books', pattern: '**/*.md' }),
	schema,
});

export const collections = { blog, books };
