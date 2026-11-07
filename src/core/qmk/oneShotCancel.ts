/**
 * “A second tap of a one-shot mod cancels it” (firmware.oneShotCancel): the C for process_record.
 *
 * Pressing an OSM() key while all of its mods are already waiting as a one-shot lets them go and does nothing else;
 * the release of that press is swallowed too, or QMK would unregister a real modifier of the same kind. Every OSM
 * keycode that reaches process_record counts (a key of the keymap, and a tap dance / tap-hold slot NAVI plays through
 * navi_send). QMK's own lock (ONESHOT_TAP_TOGGLE > 1) needs the second tap, so with it NAVI writes nothing.
 */
import type { AdvancedIssue } from '../features/advanced';
import type { Project } from '../project/types';

/** QMK's lock of a one-shot mod is on (ONESHOT_TAP_TOGGLE > 1 in the build's config). */
export const oneShotToggleOn = (project: Project) => Number(project.firmware.buildConfig.ONESHOT_TAP_TOGGLE) > 1;

/** Is the cancel written? On, and QMK's lock is not. */
export const oneShotCancelActive = (project: Project) => project.firmware.oneShotCancel === true && !oneShotToggleOn(project);

export function oneShotCancelIssues(project: Project): AdvancedIssue[] {
  if (!project.firmware.oneShotCancel || !oneShotToggleOn(project)) return [];
  return [
    {
      level: 'warning',
      where: 'one-shot mods',
      message: {
        en: 'The one-shot cancel (a second tap lets the mod go) is not written: ONESHOT_TAP_TOGGLE is set, and QMK uses the second tap to lock the mod. Clear ONESHOT_TAP_TOGGLE to have the cancel.',
        ru: 'Отмена one-shot вторым нажатием не записана: задан ONESHOT_TAP_TOGGLE, и QMK использует второе нажатие для фиксации. Уберите ONESHOT_TAP_TOGGLE, чтобы отмена работала.',
      },
    },
  ];
}

/** File-level state (before the process_record hook). */
export const oneShotCancelState = (): string[] => [
  '#if !defined(NO_ACTION_ONESHOT) && !defined(NO_ACTION_TAPPING)',
  'static uint8_t navi_osm_cancelled = 0; // one-shot mods whose key press NAVI handled, until its release',
  '#endif',
  '',
];

/** The lines at the top of the process_record hook. */
export const oneShotCancelLines = (): string[] => [
  '#if !defined(NO_ACTION_ONESHOT) && !defined(NO_ACTION_TAPPING)',
  '    // A second tap of a one-shot mod key cancels the one-shot (a hold is left to QMK).',
  '    if (IS_QK_ONE_SHOT_MOD(keycode)) {',
  '        uint8_t mods = QK_ONE_SHOT_MOD_GET_MODS(keycode);',
  '        mods         = mods & 0x10 ? (mods & 0x0F) << 4 : mods;',
  '        if (record->event.pressed) {',
  '            if (mods && record->tap.count > 0 && (get_oneshot_mods() & mods) == mods) {',
  '                del_oneshot_mods(mods);',
  '                navi_osm_cancelled |= mods;',
  '                return false;',
  '            }',
  '            if (mods && record->tap.count > 1) {',
  '                // QMK counts a quick third tap as a repeat of the second and does nothing: it sets the one-shot again.',
  '                add_oneshot_mods(mods);',
  '                navi_osm_cancelled |= mods;',
  '                return false;',
  '            }',
  '        } else if (navi_osm_cancelled & mods) {',
  '            navi_osm_cancelled &= ~mods;',
  '            return false;',
  '        }',
  '    }',
  '#endif',
];
