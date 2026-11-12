// Operation explicite : ne jamais appeler depuis le deploiement automatique.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
  if (process.argv[2] !== '--apply') {
    throw new Error('Ajouter --apply pour remplacer le mot de passe et fermer les sessions.');
  }
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password || password.length < 12 || /CHANGER-|Demo/.test(password)) {
    throw new Error('Renseigner SUPERADMIN_EMAIL et un nouveau SUPERADMIN_PASSWORD de 12 caracteres minimum.');
  }
  const db = new PrismaClient();
  try {
    const user = await db.user.findUnique({ where: { email } });
    if (!user || user.role !== 'SUPER_ADMIN') {
      throw new Error('Compte SUPER_ADMIN introuvable : aucune modification.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { passwordHash, passwordChangedAt: new Date(), lockedUntil: null },
      }),
      db.refreshToken.deleteMany({ where: { userId: user.id } }),
      db.loginAttempt.deleteMany({ where: { userId: user.id } }),
    ]);
    console.log('Mot de passe du super administrateur remplace ; sessions et tentatives fermees.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
