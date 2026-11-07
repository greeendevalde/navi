/**
 * Per-language actions of own keycodes (`CustomKeycode.action.type === 'by-language'`): the key does the action of
 * the language that is on when it fires; a language without an entry of its own plays `other`. The C is a
 * `switch (navi_language())` in generate.ts (`ownActionLines`). Entries point at languages by id, so moving languages
 * changes nothing; removing one drops its entries (languages.ts `removeLanguage`).
 */
import type { AdvancedIssue } from '../features/advanced';
import type { ByLanguageAction, CustomAction, CustomKeycode, CustomKeycodeAction, Language, Project } from './types';

/** A fresh per-language action: every language's own entry empty, everything falls to `other`. */
export const newByLanguageAction = (other: CustomAction = { type: 'none' }): ByLanguageAction => ({ type: 'by-language', byLanguage: [], other });

/** The action a language plays (its own entry, else `other`). */
export function actionInLanguage(action: CustomKeycodeAction, languageId: string | undefined): CustomAction {
  if (action.type !== 'by-language') return action;
  return action.byLanguage.find((e) => e.language === languageId)?.action ?? action.other;
}

/** What the key does in the first language (power-on): firmware tests type in it, labels show it. */
export const firstLanguageAction = (project: Pick<Project, 'languages'>, action: CustomKeycodeAction): CustomAction =>
  actionInLanguage(action, project.languages[0]?.id);

/** Does the key do anything in some language? */
export function ownActionDoesSomething(action: CustomKeycodeAction): boolean {
  const some = (a: CustomAction) => a.type !== 'none';
  return action.type === 'by-language' ? some(action.other) || action.byLanguage.some((e) => some(e.action)) : some(action);
}

/** Every action inside (one, or each language's and `other`). */
export const innerActions = (action: CustomKeycodeAction): CustomAction[] => (action.type === 'by-language' ? [...action.byLanguage.map((e) => e.action), action.other] : [action]);

/** The keycodes an own keycode's action taps. */
export const ownActionKeycodes = (action: CustomKeycodeAction): number[] => innerActions(action).flatMap((a) => (a.type === 'tap' ? [a.keycode] : []));

/** The action with every tapped keycode passed through `fix`. */
export function mapOwnActionKeycodes(action: CustomKeycodeAction, fix: (v: number) => number): CustomKeycodeAction {
  const one = (a: CustomAction): CustomAction => (a.type === 'tap' ? { ...a, keycode: fix(a.keycode) } : a);
  return action.type === 'by-language' ? { ...action, byLanguage: action.byLanguage.map((e) => ({ ...e, action: one(e.action) })), other: one(action.other) } : one(action);
}

/** Set (or clear, with `undefined`) one language's own entry. */
export function setLanguageEntry(action: ByLanguageAction, languageId: string, entry: CustomAction | undefined): ByLanguageAction {
  const rest = action.byLanguage.filter((e) => e.language !== languageId);
  if (!entry) return { ...action, byLanguage: rest };
  const at = action.byLanguage.findIndex((e) => e.language === languageId);
  const byLanguage = [...rest];
  byLanguage.splice(at < 0 ? byLanguage.length : at, 0, { language: languageId, action: entry });
  return { ...action, byLanguage };
}

/** The languages a per-language action has its own entry for, in list order. */
export const languagesWithEntries = (languages: readonly Language[], action: ByLanguageAction): Language[] =>
  languages.filter((l) => action.byLanguage.some((e) => e.language === l.id));

export function checkLanguageActions(project: Pick<Project, 'languages' | 'customKeycodes'>): AdvancedIssue[] {
  const out: AdvancedIssue[] = [];
  project.customKeycodes.forEach((ck: CustomKeycode) => {
    if (ck.action.type !== 'by-language') return;
    const where = `custom keycode · ${ck.name}`;
    if (!project.languages.length) {
      out.push({
        level: 'warning',
        where,
        message: {
          en: 'Per-language action with no languages in the project: the key plays its “other languages” action. Add languages on Advanced → Languages.',
          ru: 'Действие по языкам без языков в проекте: клавиша играет действие «другие языки». Добавьте языки в Расширенное → Языки.',
        },
      });
    } else if (!ownActionDoesSomething(ck.action)) {
      out.push({ level: 'warning', where, message: { en: 'The key does nothing in any language.', ru: 'Клавиша ничего не делает ни в одном языке.' } });
    }
  });
  return out;
}
