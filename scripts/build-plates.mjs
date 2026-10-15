/**
 * Rebuilds the served plate variants from the masters in `plates-master/`.
 *
 * The plates are full-bleed, so their widths are chosen by the screens we mean
 * to serve rather than by the size of the file we happen to hold: a laptop
 * should never pull the 2600-wide heron it has nowhere to put. Each width is
 * written as AVIF, WebP and JPEG, and `<picture>` in `src/pages/index.astro`
 * hands the browser the first one it understands.
 *
 * A master is never upscaled, and it is always offered at its own width so the
 * largest screens still get the whole of the art.
 *
 * The widths are written to `src/data/plates.json`, which the page reads to
 * build its srcsets. That file is the only record of which variants exist, so
 * the markup cannot come to disagree with what is on disk.
 */
import sharp from 'sharp';
import {
	existsSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';

const SRC = 'plates-master';
const OUT = 'public/plates';
// The band shows each plate full-bleed across the whole screen, not inside a
// column, so the width that matters is the viewport's — doubled, for the
// screens that draw two device pixels to the CSS one. 3840 covers a 1920-wide
// window on a retina display, which is about as large as this is worth
// serving. The old ceiling of 2560 was set when a plate only ever appeared
// briefly inside a moving frame, where softness had nowhere to show.
const STEPS = [1280, 1920, 2560, 3200, 3840];

// What a master has to hold to survive being thrown across a whole screen.
// Under it, the browser is upscaling and the drawing goes soft.
const TARGET = 3840;
const FORMATS = [
	['avif', { quality: 50, effort: 6 }],
	['webp', { quality: 76 }],
	['jpg', { quality: 80, mozjpeg: true }],
];

// A step within a whisker of the master is the master, and writing both would
// ship two files no screen can tell apart.
const CLOSE_ENOUGH = 1.08;

// Stale variants would otherwise linger after a master is replaced or a step
// changes, and be deployed for ever.
for (const f of readdirSync(OUT)) rmSync(`${OUT}/${f}`);

const manifest = {};
const shortfalls = [];
const unsourced = [];

for (const file of readdirSync(SRC).filter((f) => f.endsWith('.jpg'))) {
	const name = file.replace(/\.jpg$/, '');
	const { width: master, height: tall } = await sharp(`${SRC}/${file}`).metadata();

	// A plate is only ever as good as the file behind it, and no setting here
	// can add detail that was never scanned. Saying so at build time is the
	// only way the shortfall is ever noticed.
	if (master < TARGET) {
		const short = Math.round((1 - master / TARGET) * 100);
		shortfalls.push(`${name}: ${master}×${tall}, ${short}% under ${TARGET}`);
	}

	// Where a plate came from and what licence it carries. Without it there is
	// no way to check a credit, and a credit that cannot be checked is a claim.
	const sidecar = `${SRC}/${name}.json`;
	if (existsSync(sidecar)) {
		const { source, licence } = JSON.parse(readFileSync(sidecar, 'utf8'));
		console.log(`\n${name} — ${licence}\n  ${source}`);
	} else {
		unsourced.push(name);
	}

	const steps = STEPS.filter((w) => w * CLOSE_ENOUGH < master);
	const widths = [...steps, master];
	manifest[name] = widths;

	for (const width of widths) {
		for (const [ext, options] of FORMATS) {
			const out = `${OUT}/${name}-${width}.${ext}`;
			await sharp(`${SRC}/${file}`)
				.resize({ width })
				.toFormat(ext === 'jpg' ? 'jpeg' : ext, options)
				.toFile(out);
			console.log(`${(statSync(out).size / 1024).toFixed(0).padStart(5)} KB  ${out}`);
		}
	}
}

// Written the way the formatter would write it, so a generated file never
// turns up as an unformatted one in CI.
const body = Object.entries(manifest)
	.map(([name, widths]) => `\t${JSON.stringify(name)}: [${widths.join(', ')}]`)
	.join(',\n');
writeFileSync('src/data/plates.json', `{\n${body}\n}\n`);
console.log('\nsrc/data/plates.json →', JSON.stringify(manifest));

if (shortfalls.length) {
	console.log(`\nToo small to throw across a screen (want ${TARGET}px wide):`);
	for (const line of shortfalls) console.log(`  ${line}`);
}

if (unsourced.length) {
	console.log('\nNo source on record — add plates-master/<name>.json with');
	console.log('{ "source": "<url>", "licence": "<terms>" }:');
	for (const name of unsourced) console.log(`  ${name}`);
}
