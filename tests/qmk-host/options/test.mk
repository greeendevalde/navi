# Builds the NAVI-generated keymap files of the options suite in $(NAVI_QMK_OUT) (see ../README.md).
include $(NAVI_QMK_OUT)/rules.mk

VPATH += $(NAVI_QMK_OUT)
OPT_DEFS += -DNAVI_CONFIG=\"$(abspath $(NAVI_QMK_OUT))/config.h\"
