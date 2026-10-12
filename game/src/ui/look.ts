// Small presentation helpers: the game's name, emoji for people, flags and kinds of events.

/** The game's name, in one place (index.html only carries a fallback shown while loading). */
export const GAME_TITLE = { vi: 'Lifesim', en: 'Lifesim' } as const;
/** Source code (change together with the game's name). */
export const REPO_URL = 'https://github.com/thaihuynhatquang/life-sim';

import type { Sex } from '../model/types.ts';
import type { LogKind } from '../sim/person.ts';

/** A flag emoji from a two-letter ISO code (regional indicator letters). */
export function flag(iso2: string | undefined): string {
  if (!iso2 || !/^[A-Za-z]{2}$/.test(iso2)) return '🏳️';
  return String.fromCodePoint(...[...iso2.toUpperCase()].map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** A face that grows up with the person. */
export function avatar(sex: Sex, age: number): string {
  const f = sex === 'F';
  if (age < 3) return '👶';
  if (age < 13) return f ? '👧' : '🧒';
  if (age < 60) return f ? '👩' : '🧑';
  return f ? '👵' : '🧓';
}

export const KIND_ICON: Record<LogKind, string> = {
  birth: '👶', family: '🏠', school: '📚', love: '💍', work: '💼', health: '🩺', loss: '🕯️', death: '🌸', choice: '✨',
};

/** HTML for an emoji that screen readers skip. */
export const ico = (e: string, cls = 'ico') => `<span class="${cls}" aria-hidden="true">${e}</span>`;
