import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { users } from "./schema";

/**
 * Admins du site (page des signalements, réponses, /signalements-lier sur Discord) : toi, puis qui tu veux.
 *   node dist/site-admin.js list
 *   node dist/site-admin.js add flo@example.com
 *   node dist/site-admin.js remove flo@example.com
 * Le compte doit exister (inscription sur l'une des deux adresses). La personne recharge la page.
 */
const [cmd, email] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL manquant");
const { db, pool } = createDb(url);
try {
  if (cmd === "list") {
    const rows = await db.select({ email: users.email, name: users.displayName }).from(users).where(eq(users.siteAdmin, true));
    console.log(rows.length ? rows.map(r => `${r.name} <${r.email ?? "sans e-mail"}>`).join("\n") : "Aucun admin du site.");
  } else if ((cmd === "add" || cmd === "remove") && email) {
    const on = cmd === "add";
    const rows = await db.update(users).set({ siteAdmin: on, updatedAt: new Date() }).where(eq(users.email, email.trim().toLowerCase())).returning({ name: users.displayName });
    if (!rows.length) { console.error(`Aucun compte avec l'e-mail ${email}.`); process.exitCode = 1; }
    else console.log(`${rows[0]!.name} : admin du site ${on ? "ajouté" : "retiré"}.`);
  } else {
    console.error("Usage : site-admin.js list | add <e-mail> | remove <e-mail>");
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
