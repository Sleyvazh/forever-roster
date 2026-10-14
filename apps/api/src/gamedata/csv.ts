/** Valeur d'une colonne d'une ligne lue par parseCsv, quel que soit l'intitulé exact (« CommittedName » ou « Name », casse ignorée). */
export function col(row: Record<string, string>, ...names: string[]) {
  for (const n of names) {
    const key = Object.keys(row).find(k => k.toLowerCase() === n.toLowerCase());
    if (key !== undefined && row[key] !== "") return row[key]!;
  }
  return undefined;
}

/** Lecteur CSV (RFC 4180) : champs entre guillemets, guillemets doublés, retours à la ligne dans un champ. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", i = 0, quoted = false;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // BOM
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map(r => Object.fromEntries(header.map((h, j) => [h, r[j] ?? ""])));
}
