# Key press counts

“Count key presses” (Firmware → flash, `firmware.keyCounts`) feeds the heatmap on the Keyboard page. Two routes:

- **On the keyboard** (`board`): the firmware counts into a table in RAM and saves it to the keyboard's own memory;
  NAVI reads it over Raw HID and keeps the totals in `<userData>/key-counts/<projectId>.json`.
- **Through your program** (`program`): the firmware calls a function you write, `navi_key_count_user()`; a program
  of yours on the PC keeps the counts and writes the counts file at the path set on Firmware → flash. NAVI only
  reads that file.

What counts, on both routes:

- A press of a key, on the layer its action came from (with “layer keys bring their layer to the top”, the layer
  that showed). Keys NAVI plays itself (tap dance steps, macros, combo results) don't count.
- A tap-hold key (`MT`, `LT`, NAVI's stand-ins) counts its tap and its hold apart; other keys count a press.
- A combo counts as itself, by its index; its keys don't count.
- On a split, the half connected to the PC (the master) counts.
- Only counts are kept, never the order of keys, so no text can be rebuilt from them.

## The program route

NAVI's generated C declares, and calls on every counted press:

```c
enum navi_count_kinds { NAVI_COUNT_PRESS, NAVI_COUNT_TAP, NAVI_COUNT_HOLD, NAVI_COUNT_COMBO };

// You define this (in the keymap's own code, or a file of your own pipeline).
void navi_key_count_user(uint8_t layer, uint8_t row, uint8_t col, uint8_t kind);

// NAVI defines these: the names the counts file uses.
const char *navi_layer_name(uint8_t layer);       // the layer's C name (L_BASE, or its own cName), NULL past the end
const char *navi_combo_name(uint16_t combo_index); // the combo's name, else its id; NULL past the end
```

- `row`, `col`: the key's position in the firmware matrix.
- `kind == NAVI_COUNT_COMBO`: `row` is the combo's index (`navi_combo_name(row)`), `col` is 0, and `layer` is the
  highest layer on when it fired.
- It runs inside key processing: keep it short (no `wait_ms`, no long loops). A build without it doesn't link; NAVI
  warns on Firmware → files when it can't find the function in the keymap's own code.

Where the counts go from there is up to you. A common way is a Raw HID packet to a program that is already running
(QMK has one Raw HID interface; with VIA on, share it as `docs/companion.md` describes). The example uses
command `'C'`, which NAVI's own `0x4E` packets don't use:

```c
// keymap's own code (rules.mk: RAW_ENABLE = yes when VIA is off)
#include "raw_hid.h"

void navi_key_count_user(uint8_t layer, uint8_t row, uint8_t col, uint8_t kind) {
    uint8_t packet[32] = {0x4E, 'C', layer, row, col, kind};
    raw_hid_send(packet, sizeof(packet));
}
```

The program on the PC adds each packet into the counts file. It can ask the keyboard for the names once, or keep
its own copy of them from the generated `keymap.c` (`navi_layer_names`, `navi_combo_names`).

## The counts file

One JSON document; the board route's file and the program route's file are the same format:

```json
{
  "format": "navi.keyCounts",
  "version": 1,
  "since": "2026-11-07T09:00:00.000Z",
  "layers": {
    "L_BASE": { "0,0": { "press": 812 }, "0,1": { "tap": 2040, "hold": 377 } },
    "L_NAV": { "2,3": { "press": 95 } }
  },
  "combos": { "copy": 41 }
}
```

- `since`: when counting started (ISO date-time). To start over, write a new file with a new `since`.
- `layers`: the layer's C name (`navi_layer_name`) → `"row,col"` → counts. A plain key has `press`; a tap-hold key
  has `tap` and `hold`. A spot never pressed may be left out.
- `combos`: the combo's name (`navi_combo_name`) → times it fired.
- Names, not numbers, so a moved layer or combo keeps its counts as long as its name stays.

A minimal program in Node.js that turns the packets above into the file (the `node-hid` package):

```js
const fs = require('node:fs');
const HID = require('node-hid');

const FILE = 'C:\\Users\\me\\key-counts.json';
const LAYERS = ['L_BASE', 'L_NAV']; // navi_layer_names in the generated keymap.c
const COMBOS = ['copy'];            // navi_combo_names
const KINDS = ['press', 'tap', 'hold'];

const counts = fs.existsSync(FILE)
  ? JSON.parse(fs.readFileSync(FILE, 'utf8'))
  : { format: 'navi.keyCounts', version: 1, since: new Date().toISOString(), layers: {}, combos: {} };

const info = HID.devices().find((d) => d.usagePage === 0xff60 && d.usage === 0x61); // RAW_USAGE_PAGE / RAW_USAGE_ID
const kb = new HID.HID(info.path);
kb.on('data', (data) => {
  if (data[0] !== 0x4e || data[1] !== 'C'.charCodeAt(0)) return;
  const [layer, row, col, kind] = data.subarray(2, 6);
  if (kind === 3) {
    const name = COMBOS[row];
    counts.combos[name] = (counts.combos[name] ?? 0) + 1;
  } else {
    const spots = (counts.layers[LAYERS[layer]] ??= {});
    const spot = (spots[`${row},${col}`] ??= {});
    spot[KINDS[kind]] = (spot[KINDS[kind]] ?? 0) + 1;
  }
});
setInterval(() => fs.writeFileSync(FILE, JSON.stringify(counts, null, 2)), 60_000);
```

NAVI reads the file when the project opens and when its settings change.

## The board route

- Counts are 16-bit; when one reaches its top, the whole table is halved, so the proportions the heatmap shows stay.
- The table is saved to the keyboard's EEPROM (QMK's user datablock) every N minutes (a setting, 30 by default) and
  when the PC goes to sleep, only when something was counted. Counts since the last save are lost when the
  keyboard loses power. Your own C must not use `eeconfig_*_user` then: NAVI warns when it finds it.
- On an RP2040, QMK's EEPROM is flash with a write log: each changed count takes up to 6 bytes of the 4 KB log
  (`quantum/wear_leveling/wear_leveling.c`), so about 680 changed counts fill it, and then the 8 KB area is erased
  and rewritten once.
- NAVI checks that the table fits the board's EEPROM and RAM and names the size on Firmware → files.
- NAVI reads the table when the keyboard connects and on “read counts now”: Raw HID `0x4E 'K'`, INFO first (the
  table's hash must match the project's build, else nothing is read), then READ chunks; each chunk is zeroed on the
  keyboard as it is read and added to the totals file before the next one.
