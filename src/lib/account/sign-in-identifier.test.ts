import { describe, expect, it, vi } from 'vitest';

import { looksLikeEmail, resolveSignInEmail, unresolvableEmail } from './sign-in-identifier';

describe('signing in with an email or a username (spec §7.5)', () => {
  it('treats anything with an @ as an address', () => {
    expect(looksLikeEmail('someone@example.test')).toBe(true);
    // Display names are letters, digits and underscores, so this is unambiguous.
    expect(looksLikeEmail('Captain_Nemo')).toBe(false);
  });

  it('passes an address straight through, untouched but trimmed', async () => {
    const lookup = vi.fn();

    await expect(resolveSignInEmail('  someone@example.test ', lookup)).resolves.toBe(
      'someone@example.test',
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('looks a username up and signs in as the address behind it', async () => {
    const lookup = vi.fn(async () => 'nemo@example.test');

    await expect(resolveSignInEmail('Captain_Nemo', lookup)).resolves.toBe('nemo@example.test');
  });

  it('folds case and whitespace the same way registration does', async () => {
    const lookup = vi.fn(async () => 'nemo@example.test');

    await resolveSignInEmail('  CAPTAIN_nemo  ', lookup);

    expect(lookup).toHaveBeenCalledWith('captain_nemo');
  });

  it('turns an unknown username into an address nobody can hold', async () => {
    // So the answer is "those details do not match an account" — the same answer,
    // after the same work, as a wrong password. Never "no such player".
    const resolved = await resolveSignInEmail('Nobody_At_All', async () => null);

    expect(resolved).toMatch(/^[0-9a-f-]{36}@username\.invalid$/);
  });

  it('never produces the same unresolvable address twice', () => {
    expect(unresolvableEmail()).not.toBe(unresolvableEmail());
  });
});
