import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';

function fixture(error: Error) {
  const config = { get: (key: string) => key === 'mailDriver' ? 'smtp' : 'noreply@example.org' };
  const service = new NotificationsService({} as never, config as never, {} as never);
  const sendMail = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ accepted: ['user@example.org'] });
  service['transporter'] = { sendMail } as never;
  return { service, sendMail };
}

describe('refus SMTP temporaire', () => {
  it('ne relance pas immediatement un refus 421 EHLO', async () => {
    const error = Object.assign(new Error('421-4.7.0 Try again later (EHLO)'), { responseCode: 421 });
    const f = fixture(error);
    await expect(f.service['transmit']('user@example.org', 'Invitation', '', '')).rejects.toBe(error);
    expect(f.sendMail).toHaveBeenCalledOnce();
  });

  it('conserve une seconde tentative apres une coupure reseau', async () => {
    const f = fixture(new Error('ECONNRESET'));
    await expect(f.service['transmit']('user@example.org', 'Invitation', '', '')).resolves.toBe(true);
    expect(f.sendMail).toHaveBeenCalledTimes(2);
  });
});
