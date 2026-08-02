// Turn the backend's /api/frame body into a DisplayFrame.
//
// Deliberately forgiving in one direction only: unknown fields and missing
// optional fields are fine (the backend may grow), but a malformed document or
// an unknown mode is an error the caller has to handle, because rendering
// half a frame looks like a bug in the panel rather than in the network.
#pragma once

#include "DisplayFrame.h"

namespace skypanel {

struct ParseResult {
  bool ok = false;
  const char *error = "";

  explicit operator bool() const { return ok; }
};

/// Parse a frame document into ``out``. On failure ``out`` is left untouched.
ParseResult parseFrame(const char *json, DisplayFrame &out);

/// Parse "#RRGGBB" (or "RRGGBB", or "#RGB"). Unparseable input yields white,
/// matching the backend's "we don't know this airline" convention.
Colour parseColour(const char *text);

}  // namespace skypanel
