// A deterministic PNG writer.
//
// Deterministic matters: the snapshot tests compare against committed golden files, so
// the same image must produce the same bytes on every machine. Every row uses filter 0
// and a fixed zlib level, which makes the output byte-identical run to run and trivially
// decodable by the comparison script.

#pragma once

#include <string>

#include "PanelPainter.h"

namespace skypanel {

/// Write `image` (RGBA8888) to `path`. Returns false and fills `error` on failure.
bool writePng(const Image &image, const std::string &path, std::string &error);

} // namespace skypanel
