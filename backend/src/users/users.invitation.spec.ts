import { describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';

function fixture(status = 'SENT') {
  const target = { id: 'user-1', isActive: false, disabledAt: null, invitationStatus: 'FAILED' };
  const prisma = {
    user: { findUnique: vi.fn(async () => target), update: vi.fn(async () => target) },
    accountAudit: { create: vi.fn() },
  };
  const auth = { sendInvitation: vi.fn(async () => ({ invitationStatus: status })) };
  const service = new UsersService(prisma as never, {} as never, auth as never, {} as never, {} as never);
  return { service, prisma, auth, actor: { id: 'admin' } as never };
}

describe('invitations utilisateurs', () => {
  it('envoie le lien apres activation sans le refuser comme deja actif', async () => {
    const f = fixture();
    await expect(f.service.activate('user-1', f.actor)).resolves.toEqual({ ok: true });
    expect(f.auth.sendInvitation).toHaveBeenCalledWith('user-1', { resend: true });
    expect(f.prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isActive: false }),
    }));
  });

  it('signale un echec de livraison apres activation', async () => {
    const f = fixture('FAILED');
    await expect(f.service.activate('user-1', f.actor)).rejects.toMatchObject({ code: 'INVITATION_DELIVERY_FAILED' });
  });

  it('ne confirme pas un renvoi lorsque le mail a echoue', async () => {
    const f = fixture('FAILED');
    await expect(f.service.resendInvitation('user-1', f.actor)).rejects.toMatchObject({ code: 'INVITATION_DELIVERY_FAILED' });
    expect(f.prisma.accountAudit.create).not.toHaveBeenCalled();
  });

  it('confirme et journalise un renvoi reussi', async () => {
    const f = fixture();
    await expect(f.service.resendInvitation('user-1', f.actor)).resolves.toEqual({ ok: true });
    expect(f.prisma.accountAudit.create).toHaveBeenCalledOnce();
  });
});
