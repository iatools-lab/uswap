const fs = require('fs');
const p = 'd:/PROJETS/Uswap/uswap-danielle/uswap-danielle/src/users-import.service.ts';
let s = fs.readFileSync(p, 'utf8');

const oldBlock = `          await this.prisma.user.create({ data: { fullName: row.fullName, email: row.email, role: row.role as Role,
            phoneNumber: row.phoneNumber || null, address: row.address || null, stationId: row.stationId || null,
            isActive: false, password,
            invitationTokenHash: crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),
            invitationTokenExpires: new Date(Date.now() + authSettings().invitationMs) });`;

const newBlock = `          // One real, per-user invitation token is generated, stored hashed and emailed by
          // AuthService.register: same path as a manual invite, so the account stays activable.
          const result = await this.auth.register({
            fullName: row.fullName, email: row.email, role: row.role as Role,
            phoneNumber: row.phoneNumber || undefined, address: row.address || undefined,
            stationId: row.stationId || undefined,
            accountStatus: 'PENDING', sendInvite: true,
          });`;

if (!s.includes(oldBlock)) { console.error('OLD BLOCK NOT FOUND'); process.exit(2); }
s = s.replace(oldBlock, newBlock);

const oldReason = `          row.status = 'CREATED'; row.reason = 'Compte créé en attente d\u2019activation';`;
const newReason = `          row.status = 'CREATED';
          row.reason = (result as { invitationStatus?: string }).invitationStatus === 'DELIVERY_FAILED'
            ? 'Compte créé, invitation non remise'
            : 'Compte créé et invitation envoyée';`;
if (!s.includes(oldReason)) { console.error('OLD REASON NOT FOUND'); process.exit(3); }
s = s.replace(oldReason, newReason);

fs.writeFileSync(p, s, 'utf8');
console.log('OK');
