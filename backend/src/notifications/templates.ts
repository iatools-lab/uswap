/**
 * Gabarits d'e-mail transactionnels.
 *
 * Chaque gabarit expose un sujet, une version texte (fallback) et une version
 * HTML sobre, compatible avec les clients de messagerie.
 */

export type MailTemplate =
  | 'INVITATION'
  | 'PASSWORD_RESET'
  | 'ACCOUNT_ACTIVATED'
  | 'NOTIFICATION'
  | 'SCHEDULED_REPORT';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const escape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function layout(title: string, paragraphs: string[], cta?: { label: string; url: string }): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escape(title)}</title></head>
<body style="margin:0;padding:24px;background:#f5f7fa;font-family:Poppins,Segoe UI,Arial,sans-serif;color:#16223a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border-radius:14px;padding:32px;box-shadow:0 6px 24px rgba(0,26,112,.08);">
        <tr><td style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7a99;">uSwap</td></tr>
        <tr><td style="padding-top:12px;font-size:21px;font-weight:600;color:#001a70;">${escape(title)}</td></tr>
        ${paragraphs
          .map(
            (paragraph) =>
              `<tr><td style="padding-top:14px;font-size:15px;line-height:1.6;color:#33415c;">${paragraph}</td></tr>`,
          )
          .join('')}
        ${
          cta
            ? `<tr><td style="padding-top:24px;">
                 <a href="${escape(cta.url)}"
                    style="display:inline-block;background:#2d6cdf;color:#fff;text-decoration:none;
                           padding:13px 22px;border-radius:10px;font-weight:600;font-size:15px;">
                   ${escape(cta.label)}
                 </a>
               </td></tr>
               <tr><td style="padding-top:14px;font-size:13px;color:#6b7a99;">
                 Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br/>
                 <span style="word-break:break-all;color:#2d6cdf;">${escape(cta.url)}</span>
               </td></tr>`
            : ''
        }
        <tr><td style="padding-top:28px;font-size:12px;color:#8794ab;">
          Cet e-mail est envoye automatiquement. Merci de ne pas y repondre.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function renderTemplate(
  template: MailTemplate,
  variables: Record<string, string>,
): RenderedMail {
  const appUrl = variables.appUrl ?? '';
  switch (template) {
    case 'INVITATION': {
      const subject = 'Activez votre compte uSwap';
      const text = [
        `Bonjour ${variables.fullName},`,
        '',
        `Votre compte uSwap (${variables.roleLabel}) a ete cree.`,
        'Choisissez votre mot de passe pour activer votre acces :',
        variables.url,
        '',
        `Ce lien expire le ${variables.expiresAt}.`,
      ].join('\n');
      return {
        subject,
        text,
        html: layout('Activez votre compte uSwap', [
          `Bonjour <strong>${escape(variables.fullName)}</strong>,`,
          `Votre compte uSwap (${escape(variables.roleLabel)}) a ete cree${
            variables.stationName ? ` pour la station <strong>${escape(variables.stationName)}</strong>` : ''
          }.`,
          'Choisissez votre mot de passe pour activer votre acces. Ce lien est personnel et a usage unique.',
          `<span style="color:#6b7a99;font-size:13px;">Expire le ${escape(variables.expiresAt)}.</span>`,
        ], { label: 'Activer mon compte', url: variables.url }),
      };
    }
    case 'PASSWORD_RESET': {
      return {
        subject: 'Reinitialisation de votre mot de passe uSwap',
        text: [
          `Bonjour ${variables.fullName},`,
          '',
          'Une reinitialisation de mot de passe a ete demandee.',
          variables.url,
          '',
          `Ce lien expire le ${variables.expiresAt}. Si vous n'etes pas a l'origine de cette demande, ignorez cet e-mail.`,
        ].join('\n'),
        html: layout('Nouveau mot de passe', [
          `Bonjour <strong>${escape(variables.fullName)}</strong>,`,
          'Une reinitialisation de mot de passe a ete demandee pour votre compte.',
          `<span style="color:#6b7a99;font-size:13px;">Expire le ${escape(variables.expiresAt)}. Si vous n'etes pas a l'origine de cette demande, ignorez cet e-mail.</span>`,
        ], { label: 'Choisir un nouveau mot de passe', url: variables.url }),
      };
    }
    case 'ACCOUNT_ACTIVATED': {
      return {
        subject: 'Votre acces uSwap est actif',
        text: [
          `Bonjour ${variables.fullName},`,
          '',
          'Votre mot de passe a ete defini et votre acces est desormais actif.',
          `Vous pouvez vous connecter : ${appUrl || variables.url}`,
        ].join('\n'),
        html: layout('Votre acces est actif', [
          `Bonjour <strong>${escape(variables.fullName)}</strong>,`,
          'Votre mot de passe a ete defini et votre acces est desormais actif.',
        ], { label: 'Ouvrir uSwap', url: appUrl || variables.url }),
      };
    }
    case 'SCHEDULED_REPORT': {
      const attachment = variables.filename
        ? `Le fichier ${variables.format ?? ''} est joint à ce message : ${variables.filename}`
        : '';
      return {
        subject: `Rapport uSwap · ${variables.reportName}`,
        text: [
          `Le rapport « ${variables.reportName} » est disponible.`,
          variables.period ? `Periode : ${variables.period}` : '',
          variables.summary ?? '',
          attachment,
        ]
          .filter(Boolean)
          .join('\n'),
        html: layout(`Rapport · ${variables.reportName}`, [
          `<strong>Periode :</strong> ${escape(variables.period ?? '')}`,
          escape(variables.summary ?? ''),
          attachment
            ? `<span style="color:#6b7a99;font-size:13px;">${escape(attachment)}</span>`
            : '',
        ].filter(Boolean)),
      };
    }
    case 'NOTIFICATION':
    default: {
      return {
        subject: variables.title,
        text: [variables.title, '', variables.body, variables.link ?? '']
          .filter(Boolean)
          .join('\n'),
        html: layout(
          variables.title,
          [escape(variables.body)],
          variables.link ? { label: 'Ouvrir dans uSwap', url: variables.link } : undefined,
        ),
      };
    }
  }
}
