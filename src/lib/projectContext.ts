/**
 * Links the project with labels and the catalog: names of layers, tap dances, macros, own keycodes.
 */
import { useMemo } from 'react';
import type { CatalogContext } from '../core/keycodes/catalog';
import { caseInsensitiveLookup, type ParseContext } from '../core/keycodes/codec';
import { layerIdentifiers } from '../core/qmk/generate';
import type { LabelContext } from '../core/keycodes/labels';
import type { KeycodeSpec } from '../core/keycodes/spec';
import { isTaskSwitcher, TASK_SWITCHER_NAME, taskSwitcherKeycode } from '../core/keycodes/taskSwitcher';
import { aliasLookup } from '../core/project/aliases';
import { languageKeycodes, languageKeyOf } from '../core/project/languages';
import { activeGeometry, activeKeymap, customKeycodeValue } from '../core/project/ops';
import { languageKeyName as languageKeyCName } from '../core/qmk/languages';
import { tapHoldActionLookup } from '../core/project/tapHoldActions';
import type { Project } from '../core/project/types';
import { useProjectStore, useSpec } from '../store/projectStore';
import { useSettingsStore } from '../store/settingsStore';

export { customKeycodeValue };

export function labelContext(project: Project, spec: KeycodeSpec, settings: { os: LabelContext['os']; hostLayout: string }): LabelContext {
  const km = activeKeymap(project);
  const custom = new Map(project.customKeycodes.map((c, i) => [customKeycodeValue(spec, i), c.name]));
  const aliases = aliasLookup(project.keyAliases);
  const tapHoldActions = tapHoldActionLookup(project);
  return {
    os: settings.os,
    hostLanguage: settings.hostLayout === 'none' ? undefined : settings.hostLayout,
    unicode: project.firmware.unicode,
    layerName: (l) => {
      const name = km.layers[l]?.name;
      return name && name.length <= 6 ? name : undefined;
    },
    layerTitle: (l) => km.layers[l]?.name || undefined,
    tapDanceName: (i) => project.tapDances.find((t) => t.index === i)?.name,
    macroName: (i) => {
      const m = project.macros.find((x) => x.index === i);
      return m?.name ? m.name.slice(0, 8) : undefined;
    },
    customName: (v) => custom.get(v) ?? (isTaskSwitcher(spec, v) ? TASK_SWITCHER_NAME : languageKeyCName(spec, project, v)),
    languageKey: (v) => {
      const k = languageKeyOf(spec, project, v);
      const l = k && project.languages[k.index];
      return k && l ? { name: l.name, code: l.code, toggle: k.toggle } : undefined;
    },
    alias: (v) => aliases.get(v),
    unicodeEntry: (i) => project.unicodeMap[i]?.codepoint,
    tapHoldAction: (v) => tapHoldActions.get(v),
  };
}

/**
 * Names a typed keycode box reads back: own keycodes and language keys by their C names, tap dances by name,
 * layers by their C name or by the name the boxes show (`labelContext.layerName`).
 */
export function parseContext(project: Project, spec: KeycodeSpec): ParseContext {
  const km = activeKeymap(project);
  const custom = new Map(project.customKeycodes.map((c, i) => [c.name, customKeycodeValue(spec, i)]));
  project.languages.forEach((_, i) => {
    const k = languageKeycodes(spec, i);
    for (const v of [k.to, k.toggle]) {
      const name = languageKeyCName(spec, project, v);
      if (name && !custom.has(name)) custom.set(name, v);
    }
  });
  if (!custom.has(TASK_SWITCHER_NAME)) custom.set(TASK_SWITCHER_NAME, taskSwitcherKeycode(spec));
  const layers = new Map<string, number>();
  layerIdentifiers(km).forEach((id, i) => layers.set(id, i));
  km.layers.forEach((l, i) => l.name && !layers.has(l.name) && layers.set(l.name, i));
  const tapDances = project.tapDances.map((t) => [t.name, t.index] as const);
  const ownNames = [...custom.keys(), ...layers.keys(), ...tapDances.map(([n]) => n)].filter((n) => /^[A-Za-z_]\w*$/.test(n));
  return {
    unicode: project.firmware.unicode,
    customByName: caseInsensitiveLookup(custom),
    layerByName: caseInsensitiveLookup(layers),
    tapDanceByName: caseInsensitiveLookup(tapDances),
    ownNames,
  };
}

export function catalogContext(project: Project, spec: KeycodeSpec, label: LabelContext, macroCount?: number): CatalogContext {
  const km = activeKeymap(project);
  return {
    ...label,
    layerCount: km.layers.length,
    tapDances: project.tapDances.map((t) => ({ index: t.index, name: t.name })),
    macroCount,
    customKeycodes: project.customKeycodes.map((c, i) => ({ value: customKeycodeValue(spec, i), name: c.name, description: c.description })),
    languageKeys: project.languages.flatMap((l, i) => {
      const k = languageKeycodes(spec, i);
      return [
        { value: k.to, name: l.name, code: l.code, toggle: false },
        { value: k.toggle, name: l.name, code: l.code, toggle: true },
      ];
    }),
    aliases: [...aliasLookup(project.keyAliases)].map(([value, a]) => ({ value, ...a })),
  };
}

export function useParseContext(): ParseContext {
  const project = useProjectStore((s) => s.project);
  const spec = useSpec();
  return useMemo(() => (project ? parseContext(project, spec) : {}), [project, spec]);
}

export function useLabelContext(): LabelContext | null {
  const project = useProjectStore((s) => s.project);
  const spec = useSpec();
  const os = useSettingsStore((s) => s.settings.keyboard.os);
  const hostLayout = useSettingsStore((s) => s.settings.keyboard.hostLayout);
  return useMemo(() => (project ? labelContext(project, spec, { os, hostLayout }) : null), [project, spec, os, hostLayout]);
}

export function useActive() {
  const project = useProjectStore((s) => s.project);
  return useMemo(() => (project ? { project, keymap: activeKeymap(project), geometry: activeGeometry(project) } : null), [project]);
}
