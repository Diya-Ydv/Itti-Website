/**
 * Writes `dist/sitemap.xml` and `dist/robots.txt` from the pages that were
 * actually built.
 *
 * Generated rather than kept by hand for the same reason the headers are: a
 * list of pages maintained separately from the pages is a list that goes wrong.
 * Add a page and it appears here; delete one and it leaves.
 *
 * Two things are read out of the pages themselves rather than listed here:
 *
 * A page that asks not to be indexed is left out. Putting an address in the
 * sitemap is asking for it to be crawled, and saying `noindex` on the page is
 * asking for the opposite; a site that does both is a site whose sitemap is not
 * worth reading.
 *
 * `lastmod` comes from the history of the files the page is actually built
 * from — its own source and everything it imports, followed down — rather than
 * from the clock. Stamping every address with the time of the build says every
 * page changed every time anything did, which is false, and a sitemap that
 * reports a date nobody can rely on is one whose dates get ignored.
 *
 * The not-found page is excluded — it answers every address that does not
 * exist, and is not an address itself.
 */
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SITE = 'https://itti.org.in';
const DIST = 'dist';
const PAGES = 'src/pages';
const EXCLUDE = new Set(['/404']);

/** Every index.html under dist, as the path a visitor would type. */
const walk = (dir, base = '') => {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			if (entry.startsWith('_')) continue; // build assets
			out.push(...walk(full, `${base}/${entry}`));
		} else if (entry === 'index.html') {
			out.push(base === '' ? '/' : base);
		}
	}
	return out;
};

/** Where a built address came from. */
const sourceOf = (path) => {
	const stem = path === '/' ? 'index' : path.replace(/^\//, '');
	for (const candidate of [`${PAGES}/${stem}.astro`, `${PAGES}/${stem}/index.astro`]) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
};

/**
 * The page's source and everything it pulls in, followed down. A change to the
 * marketplace data is a change to the marketplace page, and the sitemap should
 * say so; a change to the navigation is not a change to anything's content, but
 * the navigation is imported by the layout, so it is reached the same way. That
 * is the honest trade: a date that is occasionally early rather than one that is
 * always now.
 */
const partsOf = (entry) => {
	const seen = new Set();
	const queue = [resolve(entry)];
	while (queue.length) {
		const file = queue.pop();
		if (seen.has(file) || !existsSync(file)) continue;
		seen.add(file);
		const text = readFileSync(file, 'utf8');
		for (const [, spec] of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
			const from = resolve(dirname(file), spec);
			const tries = /\.[a-z]+$/.test(spec)
				? [from]
				: [`${from}.astro`, `${from}.ts`, `${from}.js`, join(from, 'index.ts')];
			for (const t of tries) if (existsSync(t)) queue.push(t);
		}
	}
	return [...seen];
};

/** When any of those files was last committed. */
const lastTouched = (files) => {
	let newest = '';
	for (const file of files) {
		try {
			const when = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], {
				encoding: 'utf8',
			}).trim();
			if (when > newest) newest = when;
		} catch {
			/* no history to read; the fallback below covers it */
		}
	}
	return newest.slice(0, 10);
};

const today = new Date().toISOString().slice(0, 10);

const entries = walk(DIST)
	.filter((p) => !EXCLUDE.has(p))
	.filter((p) => {
		const html = readFileSync(join(DIST, p === '/' ? '' : p, 'index.html'), 'utf8');
		return !/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html);
	})
	.sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)))
	.map((path) => {
		const source = sourceOf(path);
		return { path, lastmod: (source && lastTouched(partsOf(source))) || today };
	});

// The opening is the page worth finding; the documents are the tail.
const priority = (p) => (p === '/' ? '1.0' : p === '/join' ? '0.8' : '0.4');

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
	.map(
		({ path, lastmod }) =>
			`\t<url>\n\t\t<loc>${SITE}${path === '/' ? '/' : `${path}/`}</loc>\n` +
			`\t\t<lastmod>${lastmod}</lastmod>\n\t\t<priority>${priority(path)}</priority>\n\t</url>`,
	)
	.join('\n')}
</urlset>
`;

/**
 * The same addresses as plain text, which the sitemaps protocol allows: one URL
 * per line, UTF-8, nothing else. It carries no dates, so the XML stays the one
 * that is submitted; this is here because a text file has no parser to fail,
 * and when a search engine says it cannot read a sitemap, the quickest way to
 * learn whether it means the file or the fetch is to hand it one that cannot be
 * misread.
 */
const plain = `${entries.map(({ path }) => `${SITE}${path === '/' ? '/' : `${path}/`}`).join('\n')}\n`;

const robots = `# The Itti Foundation
#
# Everything here is public and may be crawled. To keep the site out of search
# while it is unfinished, replace the two lines under User-agent with:
#     Disallow: /

User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
Sitemap: ${SITE}/sitemap.txt
`;

writeFileSync(join(DIST, 'sitemap.xml'), sitemap);
writeFileSync(join(DIST, 'sitemap.txt'), plain);
writeFileSync(join(DIST, 'robots.txt'), robots);
console.log(
	`sitemap.xml written — ${entries.length} pages: ${entries
		.map((e) => `${e.path} (${e.lastmod})`)
		.join(' ')}`,
);
