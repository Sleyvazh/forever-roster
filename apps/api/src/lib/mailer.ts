import nodemailer from "nodemailer";
import type { FastifyBaseLogger } from "fastify";

export interface Mail { to: string; subject: string; text: string }
export interface Mailer { send(mail: Mail): Promise<void> }

export function createMailer(smtpUrl: string, from: string, log: FastifyBaseLogger, devEcho = false): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(mail) {
      // En développement uniquement : affiche l'e-mail dans la console (pratique sans serveur SMTP).
      if (devEcho) log.info({ to: mail.to, subject: mail.subject }, `E-mail (dev)\n${mail.text}`);
      try {
        await transport.sendMail({ from, ...mail });
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
