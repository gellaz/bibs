// Extract Eden treaty call chains: api()/apiNoDates() ... .<method>(
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const root = process.argv[2];
const files = execSync(
  `grep -rlE '\\b(api|apiNoDates)\\(\\)' --include='*.ts' --include='*.tsx' apps/admin/src apps/customer/src apps/seller/src packages/ui/src`,
  { cwd: root, encoding: "utf8" },
).trim().split("\n").filter(Boolean);
const out = [];
for (const f of files) {
  const src = readFileSync(`${root}/${f}`, "utf8");
  const re = /\b(api|apiNoDates)\(\)/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length;
    // walk forward collecting the chain: .ident, (args) balanced, ["x"], until .get/.post/... (
    let i = m.index + m[0].length;
    const segs = [];
    let method = null;
    while (i < src.length) {
      while (/\s/.test(src[i])) i++;
      if (src[i] === "." ) {
        i++;
        while (/\s/.test(src[i])) i++;
        const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
        if (!id) break;
        i += id[0].length;
        while (/\s/.test(src[i])) i++;
        const name = id[0];
        if (["get","post","put","patch","delete","head","subscribe"].includes(name) && src[i] === "(") { method = name; break; }
        if (src[i] === "(") {
          // path param call: skip balanced parens
          let d = 0; const s = i;
          do { if (src[i] === "(") d++; else if (src[i] === ")") d--; i++; } while (d > 0 && i < src.length);
          segs.push(name + "(:param)");
        } else segs.push(name);
      } else if (src[i] === "[") {
        let d = 0; const s = i;
        do { if (src[i] === "[") d++; else if (src[i] === "]") d--; i++; } while (d > 0 && i < src.length);
        segs.push(src.slice(s + 1, i - 1).replace(/["'`]/g, ""));
      } else if (src[i] === "(" && segs.length) {
        let d = 0;
        do { if (src[i] === "(") d++; else if (src[i] === ")") d--; i++; } while (d > 0 && i < src.length);
        segs[segs.length - 1] += "(:param)";
      } else break;
    }
    out.push({ file: f, line, client: m[1], path: "/" + segs.join("/"), method });
  }
}
console.log(JSON.stringify(out));
