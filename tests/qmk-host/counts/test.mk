# Builds the NAVI-generated keymap files of the key counts suite in $(NAVI_QMK_OUT) (see ../README.md).
include $(NAVI_QMK_OUT)/rules.mk
# The test platform's own EEPROM is 32 bytes; QMK's RAM-backed driver is sized to eeconfig with its user datablock.
EEPROM_DRIVER = transient

VPATH += $(NAVI_QMK_OUT)
OPT_DEFS += -DNAVI_CONFIG=\"$(abspath $(NAVI_QMK_OUT))/config.h\"
# The table NAVI expects (fixture.test.ts writes it from keyCountsLayout): its size and hash.
OPT_DEFS += -DNAVI_EXPECT=\"$(abspath $(NAVI_QMK_OUT))/counts_expect.h\"
