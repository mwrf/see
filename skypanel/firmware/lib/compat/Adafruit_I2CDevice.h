// Stub. Adafruit_GFX.h includes the BusIO headers for Adafruit_SPITFT's benefit; the
// canvas path never touches a bus. The native build gets these empty declarations so it
// doesn't need the whole Adafruit_BusIO library to draw into memory.
#pragma once
#include <cstdint>

class Adafruit_I2CDevice {
public:
  explicit Adafruit_I2CDevice(uint8_t = 0) {}
};
