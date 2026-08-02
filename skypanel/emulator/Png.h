// Minimal PNG read/write for snapshot tests.
//
// Only the subset SkyPanel produces is supported: 8-bit truecolour, no alpha,
// no interlace, filter type 0. That is a deliberate narrowing -- the golden
// images are written by this same code, and a decoder that accepts everything
// would be a lot of surface area for no benefit.
//
// Reading matters as much as writing: comparing PNG files byte-for-byte would
// make the suite fail whenever zlib changes its compression tables, so the
// snapshot test decodes both sides and compares pixels.
#pragma once

#include <string>

#include "PanelSim.h"

namespace skypanel {

/// Write ``image`` to ``path``. Returns false with ``error`` set on failure.
bool writePng(const std::string &path, const Image &image, std::string &error);

/// Read an 8-bit RGB PNG. Returns false with ``error`` set on failure.
bool readPng(const std::string &path, Image &image, std::string &error);

}  // namespace skypanel
