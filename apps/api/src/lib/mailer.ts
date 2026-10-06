import nodemailer from "nodemailer";
import type { FastifyBaseLogger } from "fastify";

/** fromName : nom d'expéditeur propre au site (Forever Roster ou Roster) ; sinon celui de MAIL_FROM. */
export interface Mail { to: string; subject: string; text: string; html?: string; fromName?: string }
export interface Mailer { send(mail: Mail): Promise<void> }

export function createMailer(smtpUrl: string, from: string, log: FastifyBaseLogger, devEcho = false): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  const address = from.match(/<([^>]+)>/)?.[1] ?? from.trim();
  return {
    async send({ fromName, ...mail }) {
      // En développement uniquement : affiche l'e-mail dans la console (pratique sans serveur SMTP).
      if (devEcho) log.info({ to: mail.to, from: fromName, subject: mail.subject }, `E-mail (dev)\n${mail.text}`);
      try {
        // Auto-Submitted (RFC 3834) : évite les réponses automatiques (absences, etc.) vers no-reply.
        await transport.sendMail({ from: fromName ? { name: fromName, address } : from, ...mail, headers: { "Auto-Submitted": "auto-generated" } });
      } catch (err) {
        // Un e-mail qui échoue ne doit pas révéler d'information à l'utilisateur : on journalise côté serveur.
        log.error({ err, subject: mail.subject }, "Échec d'envoi d'e-mail");
      }
    },
  };
}

/** Mailer en mémoire pour les tests. */
export function memoryMailer(): Mailer & { outbox: Mail[] } {
  const outbox: Mail[] = [];
  return { outbox, async send(mail) { outbox.push(mail); } };
}
