'use client';

import { useTranslations } from 'next-intl';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

/**
 * The question set comes from spec §7.9. Answers describe what this build
 * actually does today — anything not built yet says so plainly rather than
 * promising it.
 */
export const FAQ_KEYS = [
  'registration',
  'free',
  'bot',
  'friend',
  'mobile',
  'rating',
  'data',
] as const;

export type FaqKey = (typeof FAQ_KEYS)[number];

export function FaqAccordion() {
  const t = useTranslations('faq');

  return (
    <Accordion type="single" collapsible className="w-full">
      {FAQ_KEYS.map((key) => (
        <AccordionItem key={key} value={key}>
          <AccordionTrigger className="text-left text-base font-medium">
            {t(`items.${key}.q`)}
          </AccordionTrigger>
          <AccordionContent className="text-sm leading-relaxed text-pretty text-muted-foreground">
            {t(`items.${key}.a`)}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
