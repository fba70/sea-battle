/// <reference types="@cloudflare/vitest-pool-workers" />
import type { Env } from './env';

declare module 'cloudflare:test' {
  // Declaration merging is the only way to type `env` in worker tests, and it requires
  // an interface that adds no members of its own — which is exactly what the
  // no-empty-object-type rule flags. There is no alternative form here.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}
