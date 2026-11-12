/**
 * Vérifie le parcours mot de passe du profil :
 *   1. le titulaire peut lire l'état de son mot de passe ;
 *   2. il peut le changer SANS saisir l'ancien ;
 *   3. la connexion fonctionne ensuite avec le nouveau ;
 *   4. on restaure le mot de passe d'origine.
 */
const BASE = 'http://127.0.0.1:3000';
const email = process.env.SWAPPER_EMAIL;
const original = process.env.DEMO_PASSWORD;
const temporary = 'Profil!Test2026';

async function login(password) {
  const r = await fetch(`${BASE}/auth/login/swapper`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, token: body.accessToken };
}

const session = await login(original);
if (!session.token) {
  console.log('[FAIL] connexion initiale', session.status);
  process.exit(1);
}

// 1. Lecture de l'état du mot de passe par son titulaire.
const own = await fetch(`${BASE}/auth/own-password`, {
  headers: { authorization: `Bearer ${session.token}` },
});
const ownBody = await own.json().catch(() => ({}));
console.log(
  `${own.status === 200 ? '[OK]  ' : '[FAIL]'} lecture du profil -> ${own.status} (password="${ownBody.password ?? ''}")`,
);

// 2. Changement SANS ancien mot de passe.
const change = await fetch(`${BASE}/auth/change-password`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${session.token}`,
  },
  body: JSON.stringify({ newPassword: temporary }),
});
console.log(
  `${change.status === 200 ? '[OK]  ' : '[FAIL]'} changement sans ancien mot de passe -> ${change.status}`,
);

// 3. Reconnexion avec le nouveau mot de passe.
const again = await login(temporary);
console.log(
  `${again.status === 200 ? '[OK]  ' : '[FAIL]'} connexion avec le nouveau mot de passe -> ${again.status}`,
);

// 4. Restauration.
const restore = await fetch(`${BASE}/auth/change-password`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${again.token}`,
  },
  body: JSON.stringify({ newPassword: original }),
});
const back = await login(original);
console.log(
  `${restore.status === 200 && back.status === 200 ? '[OK]  ' : '[FAIL]'} restauration -> ${restore.status}, reconnexion ${back.status}`,
);
