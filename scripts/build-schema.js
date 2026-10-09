// scripts/build-schema.js — از OpenAPI سوپابیس (export/_schema.json) فایل lib/localdb/schema.json را می‌سازد.
// اجرا: node scripts/build-schema.js scripts/_supabase_openapi.json
const fs = require("fs"), path = require("path");
const src = process.argv[2] || path.join(__dirname, "_supabase_openapi.json");
const spec = JSON.parse(fs.readFileSync(src, "utf8"));
const out = { tables: {} };
const typeOf = (p) => {
  if (p.type === "array") return "arr";
  if (p.type === "boolean") return "bool";
  if (p.type === "integer") return "int";
  if (p.type === "number") return "num";
  if (/json/.test(p.format || "")) return "json";
  if (/timestamp|date/.test(p.format || "")) return "ts";
  return "text";
};
const defOf = (p) => {
  if (!("default" in p)) return undefined;
  const d = p.default;
  if (typeof d === "string" && /uuid_generate|gen_random_uuid/.test(d)) return { uuid: true };
  if (typeof d === "string" && /^(now\(\)|timezone\(|CURRENT_TIMESTAMP)/i.test(d)) return { now: true };
  return { value: d };
};
for (const [t, def] of Object.entries(spec.definitions)) {
  const req = def.required || [], cols = {}, pk = [];
  for (const [c, p] of Object.entries(def.properties)) {
    const col = { t: typeOf(p) };
    if (req.includes(c)) col.nn = true;
    const d = defOf(p); if (d) col.def = d;
    if (/Primary Key/i.test(p.description || "")) pk.push(c);
    cols[c] = col;
  }
  if (pk.length === 1 && cols[pk[0]].t === "int" && !cols[pk[0]].def) cols[pk[0]].auto = true;
  out.tables[t] = { pk, cols };
}
fs.writeFileSync(path.join(__dirname, "..", "lib", "localdb", "schema.json"), JSON.stringify(out, null, 1));
console.log("tables:", Object.keys(out.tables).length);
