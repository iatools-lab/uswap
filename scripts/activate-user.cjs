/**
 * Active manuellement un compte en attente, sans dépendre de l'e-mail.
 *
 * Usage :
 *   node scripts/activate-user.cjs <email> [motDePasse]
 *
 * Sans mot de passe, le mot de passe de démonstration est appliqué
 * (DEMO_PASSWORD ou "Uswap2026!Demo"). À utiliser lorsque le service e-mail
 * n'est pas configuré et que l'invitation n'a pas pu être délivrée.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const password = process.argv[3] || process.env.DEMO_PASSWORD || 'Uswap2026!Demo';

  if (!email) {
    console.error('Usage : node scripts/activate-user.cjs <email> [motDePasse]');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Aucun compte pour "${email}".`);
    process.exit(1);
  }

  if (user.isActive) {
    console.log(`Le compte ${email} est déjà actif.`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hash,
      isActive: true,
      // Le jeton d'invitation devient inutile une fois le compte actif.
      invitationTokenHash: null,
      invitationTokenExpires: null,
    },
  });

  console.log('Compte active.');
  console.log(`  Nom      : ${user.fullName}`);
  console.log(`  E-mail   : ${user.email}`);
  console.log(`  Role     : ${user.role}`);
  console.log(`  Mot de passe : ${password}`);
}

main()
  .catch((error) => {
    console.error('Erreur :', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
