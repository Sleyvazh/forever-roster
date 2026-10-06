import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { users } from "./schema";

/**
 * Accès anticipé à Roster (WoW Retail) tant que le site est fermé : toi et les officiers de la guilde.
 *   node dist/roster-preview.js list
 *   node dist/roster-preview.js add flo@example.com
 *   node dist/roster-preview.js remove flo@example.com
 * Le compte doit exister (inscription sur l'une des deux adresses). La personne se reconnecte, ou recharge la page.
 */
const [cmd, email] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL manquant");
const { db, pool } = createDb(url);
try {
  if (cmd === "list") {
    const rows = await db.select({ email: users.email, name: users.displayName }).from(users).where(eq(users.rosterPreview, true));
    console.log(rows.length ? rows.map(r => `${r.name} <${r.email ?? "sans e-mail"}>`).join("\n") : "Personne n'a l'accès anticipé.");
  } else if ((cmd === "add" || cmd === "remove") && email) {
    const on = cmd === "add";
    const rows = await db.update(users).set({ rosterPreview: on, updatedAt: new Date() }).where(eq(users.email, email.trim().toLowerCase())).returning({ name: users.displayName });
    if (!rows.length) { console.error(`Aucun compte avec l'e-mail ${email}.`); process.exitCode = 1; }
    else console.log(`${rows[0]!.name} : accès anticipé à Roster ${on ? "donné" : "retiré"}.`);
  } else {
    console.error("Usage : roster-preview.js list | add <e-mail> | remove <e-mail>");
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
