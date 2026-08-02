// Adafruit_GFX.h includes the BusIO headers unconditionally, but only
// Adafruit_SPITFT (which SkyPanel does not build) actually uses them. Empty
// stubs keep the native build free of the whole BusIO dependency.
#pragma once
