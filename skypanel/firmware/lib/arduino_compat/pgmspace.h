// PROGMEM is an AVR flash-addressing concept. On the ESP32 and on a desktop it
// is a no-op, but Adafruit_GFX's font tables are declared with it, so the
// macros have to exist for the native build to compile.
#pragma once

#include <cstring>

#ifndef PROGMEM
#define PROGMEM
#endif
#ifndef PGM_P
#define PGM_P const char *
#endif

#ifndef pgm_read_byte
#define pgm_read_byte(addr) (*(const unsigned char *)(addr))
#endif
#ifndef pgm_read_word
#define pgm_read_word(addr) (*(const unsigned short *)(addr))
#endif
#ifndef pgm_read_dword
#define pgm_read_dword(addr) (*(const unsigned long *)(addr))
#endif
// pgm_read_pointer is deliberately left to Adafruit_GFX.cpp, which picks a
// width based on __INT_MAX__ and would otherwise warn about a redefinition.

#ifndef memcpy_P
#define memcpy_P memcpy
#endif
#ifndef strlen_P
#define strlen_P strlen
#endif
