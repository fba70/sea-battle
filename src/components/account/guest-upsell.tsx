'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { useSession } from '@/lib/auth-client';

/**
 * The nudge after a guest finishes a match (spec §7.5: "a prompt to save my
 * progress after a good game").
 *
 * Renders nothing for anyone who already has an account, and nothing while the
 * session is still resolving — a prompt that appears and then vanishes is worse
 * than one that arrives a moment late.
 *
 * Deliberately a sentence and a link, not a dialog. The person has just finished a
 * game and is looking at their result; interrupting that to sell them an account is
 * how the nudge becomes a nuisance.
 */
export function GuestUpsell() {
  const t = useTranslations('account.upsell');
  const { data, isPending } = useSession();

  if (isPending || data?.user === undefined || data.user.isAnonymous !== true) {
    return null;
  }

  return (
    <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
      {t('body')}{' '}
      <Link
        href="/account"
        className="rounded-sm font-medium text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {t('cta')}
      </Link>
    </p>
  );
}
