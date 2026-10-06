/**
 * Modèles des e-mails transactionnels : chaque e-mail part en texte ET en HTML.
 * Un contenu complet (salutation, contexte, consigne en cas de doute, pied de page)
 * est mieux reçu par les filtres antispam qu'un simple lien, et rassure le destinataire.
 *
 * Sécurité : les routes passent toujours `null` comme nom. Le pseudo est choisi librement à
 * l'inscription, y compris par quelqu'un qui saisit l'adresse d'une autre personne : l'insérer
 * dans l'e-mail permettrait d'y glisser un texte d'hameçonnage envoyé depuis notre domaine.
 */

/** fromName : nom d'expéditeur affiché (celui du site), l'adresse reste celle de MAIL_FROM. */
export interface EmailContent { subject: string; text: string; html: string; fromName: string }
/** Site d'où part l'e-mail (un site, deux adresses) : son nom, sa phrase de présentation et son adresse. */
export interface MailSite { origin: string; name: string; tagline: string }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

interface Block { title: string; intro: string[]; action?: { label: string; url: string; note: string }; outro: string[] }

function render(subject: string, greetingName: string | null, b: Block, site: MailSite): EmailContent {
  const hello = greetingName ? `Bonjour ${greetingName},` : "Bonjour,";
  const appOrigin = site.origin;
  const footer = `${site.name} — ${site.tagline}\n${appOrigin}\nCet e-mail automatique a été envoyé suite à une action sur ton compte. Merci de ne pas y répondre.`;

  const text = [
    hello, "",
    ...b.intro, "",
    ...(b.action ? [`${b.action.label} :`, b.action.url, b.action.note, ""] : []),
    ...b.outro, "",
    "—", footer,
  ].join("\n");

  const p = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1f2433">${esc(s)}</p>`;
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef0f4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f4;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Segoe UI,Helvetica,Arial,sans-serif">
<tr><td style="background:#0e1427;padding:18px 28px;color:#e6bf57;font-size:18px;letter-spacing:.04em;font-family:Georgia,serif">${esc(site.name)}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;color:#0e1427;font-weight:600">${esc(b.title)}</h1>
${p(hello)}
${b.intro.map(p).join("\n")}
${b.action ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0"><tr><td style="background:#8f6310;border-radius:6px">
<a href="${esc(b.action.url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-weight:600;font-size:15px;text-decoration:none">${esc(b.action.label)}</a>
</td></tr></table>
<p style="margin:0 0 6px;font-size:13px;color:#5b6275">${esc(b.action.note)} Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :</p>
<p style="margin:0 0 18px;font-size:13px;word-break:break-all"><a href="${esc(b.action.url)}" style="color:#8f6310">${esc(b.action.url)}</a></p>` : ""}
${b.outro.map(p).join("\n")}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e3e6ec;font-size:12px;line-height:1.5;color:#7a8296">
${esc(site.name)} — ${esc(site.tagline)}<br>
<a href="${esc(appOrigin)}" style="color:#7a8296">${esc(appOrigin.replace(/^https?:\/\//, ""))}</a><br>
Cet e-mail automatique a été envoyé suite à une action sur ton compte. Merci de ne pas y répondre.
</td></tr>
</table></td></tr></table>
</body></html>`;

  return { subject, text, html, fromName: site.name };
}

export function verifyEmail(link: string, name: string | null, site: MailSite, welcome = true): EmailContent {
  return render("Confirme ton adresse e-mail", name, {
    title: welcome ? `Bienvenue sur ${site.name}` : "Confirme ton adresse e-mail",
    intro: [
      welcome
        ? "Ton compte est presque prêt. Il ne reste qu'à confirmer que cette adresse t'appartient."
        : "Voici un nouveau lien pour confirmer ton adresse e-mail.",
    ],
    action: { label: "Confirmer mon adresse", url: link, note: "Ce lien est valable 24 heures et ne fonctionne qu'une fois." },
    outro: [`Si tu n'as pas créé de compte sur ${site.name}, ignore simplement ce message : aucun compte ne sera activé.`],
  }, site);
}

export function resetPassword(link: string, name: string | null, site: MailSite): EmailContent {
  return render("Réinitialisation de ton mot de passe", name, {
    title: "Choisir un nouveau mot de passe",
    intro: [`Une réinitialisation du mot de passe a été demandée pour ton compte ${site.name}.`],
    action: { label: "Choisir un nouveau mot de passe", url: link, note: "Ce lien est valable 30 minutes et ne fonctionne qu'une fois. Toutes tes sessions ouvertes seront fermées." },
    outro: ["Si tu n'as rien demandé, ignore ce message : ton mot de passe actuel reste valable. Si tu reçois ces e-mails sans raison, change ton mot de passe par précaution."],
  }, site);
}

export function registerAttempt(name: string | null, site: MailSite): EmailContent {
  return render(`Tentative d'inscription sur ${site.name}`, name, {
    title: "Ton adresse a été utilisée pour une inscription",
    intro: [`Quelqu'un vient d'essayer de créer un compte ${site.name} avec ton adresse e-mail, qui a déjà un compte.`],
    action: { label: "Me connecter", url: `${site.origin}/login`, note: "Si c'est toi, connecte-toi ou utilise « Mot de passe oublié »." },
    outro: ["Si ce n'est pas toi, aucune action n'est nécessaire : ton compte n'a pas été modifié."],
  }, site);
}
