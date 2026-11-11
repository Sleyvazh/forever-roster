import type { FastifyReply } from "fastify";
import type { z } from "zod";
import { fill, N } from "./i18n";

type Vars = Record<string, string | number>;

/**
 * Erreur renvoyée au client : `key`, le texte français avec ses {variables} (clé du catalogue anglais, lib/i18n.ts),
 * `message`, ce texte rempli (journaux, tests) ; le gestionnaire d'erreurs (app.ts) l'envoie dans la langue de la requête.
 * `code` : repère stable pour le client (le texte change avec la langue), par exemple « csrf ».
 */
export class HttpError extends Error {
  constructor(public status: number, public key: string, public vars?: Vars, public code?: string) { super(fill(key, vars)); }
}

export const badRequest = (msg: string, vars?: Vars) => new HttpError(400, msg, vars);
export const unauthorized = (msg = N("Connexion requise."), vars?: Vars) => new HttpError(401, msg, vars);
export const forbidden = (msg = N("Action non autorisée."), vars?: Vars) => new HttpError(403, msg, vars);
export const notFound = (msg = N("Introuvable."), vars?: Vars) => new HttpError(404, msg, vars);
export const conflict = (msg: string, vars?: Vars) => new HttpError(409, msg, vars);

/** Valide une entrée avec zod ; renvoie un 400 lisible au lieu d'une trace (le message de zod est traduit s'il est connu). */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path.length ? ` (${first.path.join(".")})` : "";
    throw badRequest("Données invalides{where} : {message}", { where, message: first?.message ?? N("format incorrect") });
  }
  return r.data;
}

export const noStore = (reply: FastifyReply) => reply.header("Cache-Control", "no-store");
