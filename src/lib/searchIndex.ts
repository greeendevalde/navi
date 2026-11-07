/**
 * GLOBAL SEARCH (Ctrl+K): what can be found and where Enter goes. `buildSearchIndex` lists pages and tabs, the
 * settings, QMK config params, and the open project's layers, keys, encoders, combos, tap dances, tap-hold settings,
 * key lists, macros, aliases, custom keycodes, key overrides, leader sequences and unicode entries; `searchItems`
 * ranks them against a query. Titles of the app's own things are searched in both languages.
 */
import { friendlyName } from '../core/keycodes/friendly';
import { modsLabel, type LabelContext } from '../core/keycodes/labels';
import type { KeycodeSpec } from '../core/keycodes/spec';
import { sequenceText } from '../core/keycodes/sequence';
import { comboRefOf } from '../core/features/advanced';
import { aliasCName } from '../core/project/aliases';
import { languageKeycodes } from '../core/project/languages';
import { activeGeometry, activeKeymap } from '../core/project/ops';
import type { Combo, CustomKeycodeAction, KeyGeom, Language, MatrixPos, Project, ProjectSummary } from '../core/project/types';
import { configParams, groupTitle } from '../core/qmk/configParams';
import { bothLanguages, t } from '../i18n';
import { customKeycodeValue } from './projectContext';
import type { Route } from './router';
import { SECTIONS, tabRoute, type Section } from './sections';
import { PROJECT_SETTING_ITEMS, SETTING_ITEMS } from './settingsIndex';
import { normalize } from './find';

export type SearchKind =
  | 'page'
  | 'setting'
  | 'param'
  | 'layer'
  | 'key'
  | 'encoder'
  | 'combo'
  | 'tapdance'
  | 'taphold'
  | 'keylist'
  | 'macro'
  | 'alias'
  | 'custom'
  | 'override'
  | 'leader'
  | 'unicode'
  | 'language'
  | 'project';

/** Where Enter goes for a key or an encoder: the Keyboard page on that layer, pointing at it. */
export type KeyboardTarget = { layer: number; pos?: MatrixPos; encoder?: { index: number; dir: 'cw' | 'ccw' } };

export interface SearchItem {
  kind: SearchKind;
  /** The line shown: what it is, in the current language. */
  title: string;
  /** The second line: where it is ("layer Nav · left half, row 2, column 3"). */
  detail?: string;
  /** Everything it can be found by (title and detail included). */
  text: string;
  route: Route;
  /** `data-find-id` of the element to show there. */
  findId?: string;
  keyboard?: KeyboardTarget;
}

export function kindLabel(kind: SearchKind): string {
  switch (kind) {
    case 'page':
      return t('page', 'страница');
    case 'setting':
      return t('setting', 'настройка');
    case 'param':
      return t('QMK setting', 'настройка QMK');
    case 'layer':
      return t('layer', 'слой');
    case 'key':
      return t('key', 'клавиша');
    case 'encoder':
      return t('encoder', 'энкодер');
    case 'combo':
      return t('combo', 'комбо');
    case 'tapdance':
      return 'tap dance';
    case 'taphold':
      return t('tap-hold', 'тап-холд');
    case 'keylist':
      return t('key list', 'список клавиш');
    case 'macro':
      return t('macro', 'макрос');
    case 'alias':
      return t('alias', 'псевдоним');
    case 'custom':
      return t('custom keycode', 'свой keycode');
    case 'override':
      return t('key override', 'подмена');
    case 'leader':
      return t('leader', 'лидер');
    case 'unicode':
      return t('unicode', 'юникод');
    case 'language':
      return t('language', 'язык');
    case 'project':
      return t('project', 'проект');
  }
}

const join = (...parts: (string | number | null | undefined | false)[]) => parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '').join(' ');

/** "left half, row 2, column 3": the half from the geometry, row and column from the matrix (1-based, per half). */
export function keyPlace(project: Project, key: KeyGeom): string {
  if (!key.matrix) return '';
  const [r, c] = key.matrix;
  const rows = project.hardware.matrix.rows;
  const splitRow = project.hardware.split.enabled && key.half === 'right' && r >= rows / 2 ? r - rows / 2 : r;
  const half = key.half === 'left' ? t('left half', 'левая половина') : key.half === 'right' ? t('right half', 'правая половина') : '';
  const place = t(`row ${splitRow + 1}, column ${c + 1}`, `ряд ${splitRow + 1}, столбец ${c + 1}`);
  return half ? `${half}, ${place}` : place;
}

function actionText(spec: KeycodeSpec, action: CustomKeycodeAction, ctx: LabelContext, languages: readonly Language[] = []): string {
  if (action.type === 'by-language') {
    // Per-language: each language's own action, then the rest's (“en: “'s” · other: “'””).
    const own = languages.flatMap((l) => {
      const e = action.byLanguage.find((x) => x.language === l.id);
      return e ? [`${l.code}: ${actionText(spec, e.action, ctx) || '—'}`] : [];
    });
    return `${t('per language', 'по языкам')}: ${[...own, `${t('other', 'другие')}: ${actionText(spec, action.other, ctx) || '—'}`].join(' · ')}`;
  }
  if (action.type === 'send-string') return `“${action.text}”`;
  if (action.type === 'tap') return friendlyName(spec, action.keycode, ctx).text;
  return '';
}

function pageItems(): SearchItem[] {
  const out: SearchItem[] = [];
  for (const s of SECTIONS) {
    const title = s.title();
    out.push({ kind: 'page', title, text: bothLanguages(s.title), route: { section: s.id } });
    for (const tab of s.tabs ?? []) {
      const tabTitle = tab.title();
      out.push({
        kind: 'page',
        title: `${title} › ${tabTitle}`,
        text: join(bothLanguages(s.title), bothLanguages(tab.title), tab.group && bothLanguages(tab.group), tab.tip && bothLanguages(tab.tip)),
        route: tabRoute(s.id, tab.id),
      });
    }
  }
  return out;
}

function settingItems(): SearchItem[] {
  const settings = SECTIONS.find((s) => s.id === 'settings')!.title();
  return [...SETTING_ITEMS, ...PROJECT_SETTING_ITEMS].map((s) => ({
    kind: 'setting' as const,
    title: s.label(),
    detail: s.route ? s.section() : `${settings} › ${s.section()}`,
    text: join(bothLanguages(s.label), bothLanguages(s.section), s.hint && bothLanguages(s.hint), s.keywords, s.key),
    route: s.route ?? { section: 'settings' as Section },
    findId: `setting:${s.key}`,
  }));
}

let paramCache: SearchItem[] | null = null;
let paramLang = '';

function paramItems(): SearchItem[] {
  const lang = t('en', 'ru');
  if (paramCache && paramLang === lang) return paramCache;
  paramLang = lang;
  paramCache = configParams().map((p) => {
    const g = groupTitle(p.group);
    return {
      kind: 'param',
      title: t(p.title.en, p.title.ru),
      detail: `${p.define} · ${t(g.en, g.ru)}`,
      text: join(p.title.en, p.title.ru, p.define, p.hint?.en, p.hint?.ru, g.en, g.ru),
      route: tabRoute('advanced', 'behavior'),
      findId: `cfg:${p.define}`,
    };
  });
  return paramCache;
}

/** Name and QMK expression of a keycode, for search text. */
function keyText(spec: KeycodeSpec, v: number, ctx: LabelContext): { text: string; qmk: string } {
  return friendlyName(spec, v, ctx);
}

function projectItems(project: Project, spec: KeycodeSpec, ctx: LabelContext): SearchItem[] {
  const out: SearchItem[] = [];
  const km = activeKeymap(project);
  const geo = activeGeometry(project);
  const cols = project.hardware.matrix.cols;
  const layerName = (n: number) => km.layers[n]?.name || String(n);
  const kn = (v: number) => keyText(spec, v, ctx);
  const names = (vs: readonly number[]) => vs.map((v) => kn(v));
  const advanced = (tab: string) => tabRoute('advanced', tab);

  // Layers and the keys on them.
  km.layers.forEach((layer, n) => {
    out.push({
      kind: 'layer',
      title: layer.name || t(`Layer ${n}`, `Слой ${n}`),
      detail: t(`layer ${n}`, `слой ${n}`),
      text: join(layer.name, layer.cName, `L${n}`, bothLanguages(() => t(`layer ${n}`, `слой ${n}`))),
      route: { section: 'keyboard' },
      keyboard: { layer: n },
    });
    for (const key of geo.keys) {
      if (!key.matrix) continue;
      const v = layer.keys[key.matrix[0] * cols + key.matrix[1]] ?? 0;
      if (v <= 1) continue; // KC_NO, KC_TRNS: thousands of empty hits
      const name = kn(v);
      const place = keyPlace(project, key);
      out.push({
        kind: 'key',
        title: name.text,
        detail: `${t('layer', 'слой')} ${layerName(n)} · ${place}`,
        text: join(name.text, name.qmk, key.label),
        route: { section: 'keyboard' },
        keyboard: { layer: n, pos: key.matrix },
      });
    }
    layer.encoders.forEach((enc, index) => {
      for (const dir of ['ccw', 'cw'] as const) {
        const v = enc[dir];
        if (v <= 1) continue;
        const name = kn(v);
        const turn = dir === 'cw' ? t('clockwise', 'по часовой') : t('counterclockwise', 'против часовой');
        out.push({
          kind: 'encoder',
          title: name.text,
          detail: `${t('layer', 'слой')} ${layerName(n)} · ${t(`encoder ${index + 1}`, `энкодер ${index + 1}`)}, ${turn}`,
          text: join(name.text, name.qmk),
          route: { section: 'keyboard' },
          keyboard: { layer: n, encoder: { index, dir } },
        });
      }
    });
  });

  // Combos: "J + K → Esc", keys read on the layer combos use on layer 0 (as the Combos tab does).
  const refLayer = comboRefOf(km, 0);
  const comboKey = ([r, c]: MatrixPos) => kn(km.layers[refLayer]?.keys[r * cols + c] ?? 0);
  const comboTitle = (c: Combo) => `${c.keys.map((k) => comboKey(k).text).join(' + ') || '—'} → ${c.result ? kn(c.result).text : '—'}`;
  for (const c of project.combos) {
    out.push({
      kind: 'combo',
      title: comboTitle(c),
      detail: c.name,
      text: join(comboTitle(c), c.name, ...c.keys.map((k) => comboKey(k).qmk), c.result ? kn(c.result).qmk : ''),
      route: advanced('combos'),
      findId: `combo:${c.id}`,
    });
  }

  for (const td of project.tapDances) {
    const slots = [
      [t('tap', 'нажатие'), td.tap],
      [t('hold', 'удержание'), td.hold],
      [t('double tap', 'двойное'), td.doubleTap],
      [t('tap + hold', 'нажатие + удержание'), td.tapHold],
    ] as const;
    const filled = slots.filter(([, v]) => v > 0).map(([w, v]) => `${w} ${kn(v).text}`);
    out.push({
      kind: 'tapdance',
      title: td.name,
      detail: filled.join(' · ') || `TD(${td.name})`,
      text: join(td.name, `TD(${td.name})`, ...filled, ...slots.map(([, v]) => (v > 0 ? kn(v).qmk : ''))),
      route: advanced('tapdance'),
      findId: `tapdance:${td.id}`,
    });
  }

  for (const s of project.tapHolds) {
    const keys = names(s.keycodes);
    const title = keys.map((k) => k.text).join(', ') || t('(no keys)', '(без клавиш)');
    const flavor = s.flavor ?? '';
    out.push({
      kind: 'taphold',
      title,
      detail: join(flavor, s.tappingTerm ? `${s.tappingTerm} ms` : ''),
      text: join(title, ...keys.map((k) => k.qmk), flavor),
      route: advanced('taphold'),
      findId: `taphold:${s.id}`,
    });
  }

  for (const l of project.keyLists) {
    const keys = names(l.keys);
    out.push({
      kind: 'keylist',
      title: l.name,
      detail: keys.map((k) => k.text).join(', '),
      text: join(l.name, ...keys.map((k) => `${k.text} ${k.qmk}`)),
      route: advanced('taphold'),
      findId: `keylist:${l.id}`,
    });
  }

  for (const m of project.macros) {
    const steps = m.steps.flatMap((st) => (st.type === 'text' ? [st.text] : st.type === 'secret' ? [st.name] : st.type === 'delay' ? [] : [kn(st.keycode).text]));
    out.push({
      kind: 'macro',
      title: m.name || `MC_${m.index}`,
      detail: `MC_${m.index}`,
      text: join(m.name, `MC_${m.index}`, ...steps),
      route: { section: 'macros' },
      findId: `macro:${m.index}`,
    });
  }

  for (const a of project.keyAliases) {
    if (!a.label.trim()) continue;
    const k = kn(a.keycode);
    const cName = aliasCName(a.label.trim());
    out.push({
      kind: 'alias',
      title: a.label,
      detail: join(cName, '=', k.qmk),
      text: join(a.label, cName, k.qmk),
      route: advanced('aliases'),
      findId: `alias:${a.id}`,
    });
  }

  project.customKeycodes.forEach((c, i) => {
    const hex = `0x${customKeycodeValue(spec, i).toString(16).toUpperCase()}`;
    const action = actionText(spec, c.action, ctx, project.languages);
    out.push({
      kind: 'custom',
      title: c.name,
      detail: join(c.description, action && `→ ${action}`),
      text: join(c.name, c.description, action, hex),
      route: advanced('custom'),
      findId: `custom:${c.id}`,
    });
  });

  for (const o of project.keyOverrides) {
    const title = `${modsLabel(o.mods, ctx.os)} + ${kn(o.trigger).text} → ${kn(o.replacement).text}`;
    out.push({
      kind: 'override',
      title,
      detail: o.name,
      text: join(title, o.name, kn(o.trigger).qmk, kn(o.replacement).qmk),
      route: advanced('overrides'),
      findId: `override:${o.id}`,
    });
  }

  for (const s of project.leaderSequences) {
    const seq = sequenceText(spec, s.keys);
    const action = actionText(spec, s.action, ctx);
    out.push({
      kind: 'leader',
      title: `${t('Leader', 'Лидер')}, ${seq}${action ? ` → ${action}` : ''}`,
      text: join(seq, action, 'leader', 'лидер'),
      route: advanced('leader'),
      findId: `leader:${s.id}`,
    });
  }

  for (const u of project.unicodeMap) {
    const hex = `U+${u.codepoint.toString(16).toUpperCase().padStart(4, '0')}`;
    const char = u.codepoint > 0 && u.codepoint <= 0x10ffff ? String.fromCodePoint(u.codepoint) : '';
    out.push({
      kind: 'unicode',
      title: join(char, u.name),
      detail: hex,
      text: join(char, u.name, hex),
      route: advanced('unicode'),
      findId: `unicode:${u.id}`,
    });
  }

  project.languages.forEach((l, i) => {
    const keys = languageKeycodes(spec, i);
    const to = kn(keys.to);
    const toggle = kn(keys.toggle);
    out.push({
      kind: 'language',
      title: l.name || l.code,
      detail: join(l.code, l.plainKeys && t('plain keys', 'обычные клавиши'), l.layer !== undefined && layerName(l.layer), to.qmk),
      text: join(l.name, l.code, to.text, to.qmk, toggle.text, toggle.qmk, 'language язык'),
      route: advanced('languages'),
      findId: `language:${l.id}`,
    });
  });
  return out;
}

function projectListItems(list: readonly ProjectSummary[], currentId: string | undefined): SearchItem[] {
  return list
    .filter((p) => p.id !== currentId)
    .map((p) => ({
      kind: 'project' as const,
      title: p.name,
      detail: p.keyboard,
      text: join(p.name, p.keyboard),
      route: { section: 'projects' as Section },
      findId: `project:${p.id}`,
    }));
}

export function buildSearchIndex(input: { project: Project | null; spec: KeycodeSpec; ctx: LabelContext | null; projects: readonly ProjectSummary[] }): SearchItem[] {
  const { project, spec, ctx } = input;
  return [
    ...pageItems(),
    ...settingItems(),
    ...paramItems(),
    ...(project && ctx ? projectItems(project, spec, ctx) : []),
    ...projectListItems(input.projects, project?.id),
  ];
}

/** Things of the project come first on equal scores; pages before settings before QMK's 70 params. */
const KIND_ORDER: Record<SearchKind, number> = {
  page: 9,
  layer: 8,
  combo: 7,
  tapdance: 7,
  macro: 7,
  alias: 7,
  custom: 7,
  keylist: 6,
  taphold: 6,
  override: 6,
  leader: 6,
  unicode: 6,
  language: 6,
  setting: 5,
  key: 4,
  encoder: 3,
  param: 2,
  project: 1,
};

/**
 * Score of one query word in an item: whole title > title start > a title word's start > inside the title > the
 * searched text > the detail line (where it is: "left half" matches half the keys, a name match should win).
 */
function wordScore(word: string, title: string, text: string, detail: string): number {
  if (title === word) return 100;
  if (title.startsWith(word)) return 60;
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(title)) return 40;
  if (title.includes(word)) return 20;
  if (text.includes(word)) return 8;
  if (detail.includes(word)) return 3;
  return 0;
}

/**
 * Items matching every word of the query, best first: by score, then kind, then the index order. An empty query
 * gives the pages (a map of the app). Keys are capped: one keycode on 12 layers shouldn't push everything else out.
 */
export function searchItems(items: readonly SearchItem[], query: string, limit = 60): SearchItem[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return items.filter((i) => i.kind === 'page' && !i.title.includes('›')).slice(0, limit);
  const scored: { item: SearchItem; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const title = normalize(item.title);
    const text = normalize(item.text);
    const detail = normalize(item.detail ?? '');
    let score = 0;
    for (const w of words) {
      const s = wordScore(w, title, text, detail);
      if (!s) return;
      score += s;
    }
    if (words.length > 1 && title.includes(words.join(' '))) score += 30;
    scored.push({ item, score, order });
  });
  scored.sort((a, b) => b.score - a.score || KIND_ORDER[b.item.kind] - KIND_ORDER[a.item.kind] || a.order - b.order);
  const out: SearchItem[] = [];
  let keys = 0;
  for (const s of scored) {
    if (s.item.kind === 'key' || s.item.kind === 'encoder') {
      if (keys >= 30) continue;
      keys++;
    }
    out.push(s.item);
    if (out.length >= limit) break;
  }
  return out;
}
