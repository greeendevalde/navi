/**
 * A per-language own keycode (Advanced → Custom keycodes, action “per language”): one line per language under the
 * keycode's row, then the “other languages” line every language without its own action plays.
 * Logic: core/project/languageActions.ts; C: generate.ts (`ownActionLines`).
 */
import type { ByLanguageAction, CustomAction, CustomKeycodeAction, Project } from '../../core/project/types';
import { newByLanguageAction, setLanguageEntry } from '../../core/project/languageActions';
import { t } from '../../i18n';
import { href } from '../../lib/router';
import { ActionEditor, type ActionChoice } from './common';
import { HeldModsSelect } from './HeldModsControls';
import { Hint } from '../InfoTip';

/** The “per language” choice of an own keycode's action list. */
export function perLanguageChoice(project: Project, action: CustomKeycodeAction, onChange: (a: CustomKeycodeAction) => void): ActionChoice {
  return {
    value: 'by-language',
    label: project.languages.length ? t('per language', 'по языкам') : t('per language (no languages)', 'по языкам (языков нет)'),
    on: action.type === 'by-language',
    reason: !project.languages.length && action.type !== 'by-language' && t('Add languages first (Advanced → Languages)', 'Сначала добавьте языки (Расширенное → Языки)'),
    onPick: () => onChange(newByLanguageAction(action.type === 'by-language' ? action.other : action)),
    hint: t('set for each language below', 'задаётся для каждого языка ниже'),
  };
}

function ActionLine({ project, label, tip, action, inherit, onChange, coalesceKey }: { project: Project; label: string; tip?: string; action: CustomAction | undefined; inherit?: ActionChoice; onChange: (a: CustomAction, coalesce?: string) => void; coalesceKey: string }) {
  const shown = action ?? { type: 'none' as const };
  return (
    <div className="row-sub">
      <span className="kicker" style={{ minWidth: 176 }}>{tip ? <Hint tip={tip}>{label}</Hint> : label}</span>
      <ActionEditor action={shown} coalesceKey={coalesceKey} extra={inherit} onChange={onChange} />
      {action?.type === 'send-string' && (
        <HeldModsSelect
          showLabel={false}
          value={action.heldMods}
          global={project.firmware.liftHeldMods}
          onChange={(heldMods) => onChange({ type: 'send-string', text: action.text, ...(heldMods ? { heldMods } : {}) })}
        />
      )}
    </div>
  );
}

export function LanguageActionRows({ project, action, keyId, onChange }: { project: Project; action: ByLanguageAction; keyId: string; onChange: (a: ByLanguageAction, coalesce?: string) => void }) {
  const ownEntry = (id: string) => action.byLanguage.find((e) => e.language === id)?.action;
  return (
    <>
      {project.languages.length === 0 && (
        <div className="row-sub">
          <span className="field-hint">
            {t('No languages in the project: the key plays the “other languages” action.', 'В проекте нет языков: клавиша играет действие «другие языки».')}{' '}
            <a href={href({ section: 'advanced', tab: 'languages' })}>{t('Languages', 'Языки')}</a>
          </span>
        </div>
      )}
      {project.languages.map((l) => {
        const own = ownEntry(l.id);
        const inherit: ActionChoice = {
          value: 'other',
          label: t('as other languages', 'как другие языки'),
          on: own === undefined,
          onPick: () => onChange(setLanguageEntry(action, l.id, undefined)),
          hint: t('plays the “other languages” action', 'играет действие «другие языки»'),
        };
        return (
          <ActionLine
            key={l.id}
            project={project}
            label={l.name || l.code}
            action={own}
            inherit={inherit}
            coalesceKey={`ck:${keyId}:${l.id}`}
            onChange={(a, coalesce) => onChange(setLanguageEntry(action, l.id, a), coalesce)}
          />
        );
      })}
      <ActionLine
        project={project}
        label={t('other languages', 'другие языки')}
        tip={t(
          'What the key does in a language with “as other languages”, and in every language added later.',
          'Что клавиша делает в языке с «как другие языки» и в каждом языке, добавленном позже.',
        )}
        action={action.other}
        coalesceKey={`ck:${keyId}:other`}
        onChange={(other, coalesce) => onChange({ ...action, other }, coalesce)}
      />
    </>
  );
}
