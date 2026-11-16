import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GOOGLE_CLIENT_ID_DEFAULT,
  googleClientId,
  isGoogleClientId,
} from './google-client';

/**
 * Verrouille l'identifiant OAuth Google.
 *
 * Régression corrigée : la connexion Google répondait « OAuth client not
 * found » en production parce que le client n'était défini que dans un `.env`
 * qui pouvait manquer. L'identifiant est désormais une valeur par défaut du
 * code — et le backend et le frontend DOIVENT utiliser le même, sinon le jeton
 * Google est rejeté (audience différente).
 */
describe('identifiant OAuth Google', () => {
  it('est un identifiant client valide', () => {
    expect(isGoogleClientId(GOOGLE_CLIENT_ID_DEFAULT)).toBe(true);
  });

  it('retombe sur la valeur par défaut si la variable est absente ou vide', () => {
    expect(googleClientId(undefined)).toBe(GOOGLE_CLIENT_ID_DEFAULT);
    expect(googleClientId('')).toBe(GOOGLE_CLIENT_ID_DEFAULT);
    expect(googleClientId('   ')).toBe(GOOGLE_CLIENT_ID_DEFAULT);
  });

  it('respecte une valeur explicitement configurée', () => {
    const custom = '123456789-abc.apps.googleusercontent.com';
    expect(googleClientId(custom)).toBe(custom);
  });

  it('n’accepte pas un simple numéro de projet comme identifiant', () => {
    expect(isGoogleClientId('739196811493')).toBe(false);
  });

  /**
   * Le backend vérifie l'audience du jeton (`aud` = client ID). Si le frontend
   * construit son bundle avec un AUTRE identifiant, Google émet un jeton que le
   * backend refuse : la connexion échoue en 401. Ce test compare les deux
   * constantes de code.
   */
  it('est identique côté backend et côté frontend', () => {
    const frontend = readFileSync(
      resolve(__dirname, '../../../frontend/src/config/google.ts'),
      'utf8',
    );
    const match = /GOOGLE_CLIENT_ID_DEFAULT\s*=\s*\n?\s*"([^"]+)"/.exec(frontend);
    expect(match?.[1]).toBe(GOOGLE_CLIENT_ID_DEFAULT);
  });
});
