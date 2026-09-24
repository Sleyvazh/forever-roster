import type { FastifyReply } from "fastify";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const unauthorized = (msg = "Connexion requise.") => new HttpError(401, msg);
export const forbidden = (msg = "Action non autorisée.") => new HttpError(403, msg);
export const notFound = (msg = "Introuvable.") => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

/** Valide une entrée avec zod ; renvoie un 400 lisible au lieu d'une trace. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path.length ? ` (${first.path.join(".")})` : "";
    throw badRequest(`Données invalides${where} : ${first?.message ?? "format incorrect"}`);
  }
  return r.data;
}

export const noStore = (reply: FastifyReply) => reply.header("Cache-Control", "no-store");
