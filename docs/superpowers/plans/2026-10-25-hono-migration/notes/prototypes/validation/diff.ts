// Byte diff of {status, body} per case: before (Elysia) vs after (Hono). Usage: bun probe/diff.ts before.json after.json
const [a, b] = await Promise.all(
	process.argv.slice(2, 4).map((p) => Bun.file(p).json()),
);
let same = 0;
const diffs: string[] = [];
for (const k of Object.keys(a)) {
	if (!(k in b)) {
		diffs.push(`MISSING ${k}`);
		continue;
	}
	if (a[k].status === b[k].status && a[k].body === b[k].body) same++;
	else
		diffs.push(
			`≠ ${k}\n   before ${a[k].status} ${a[k].body}\n   after  ${b[k].status} ${b[k].body}`,
		);
}
console.log(`${same}/${Object.keys(a).length} byte-identical`);
for (const d of diffs) console.log(d);
