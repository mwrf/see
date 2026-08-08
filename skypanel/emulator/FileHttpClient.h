// An IHttpClient that serves frames from disk instead of the network.
//
// This is what makes --frame and --scenario work without special-casing
// anything inside PanelApp: as far as the app is concerned it is polling a
// backend, and the poll interval, the parse path and the error handling are
// all the real ones.
#pragma once

#include <string>
#include <vector>

#include "IHttpClient.h"

namespace skypanel {

class FileHttpClient : public IHttpClient {
 public:
  /// Load a single frame document.
  bool loadFrame(const std::string &path, std::string &error);

  /// Load a scenario: one frame document per line (JSON Lines).
  bool loadScenario(const std::string &path, std::string &error);

  HttpResponse get(const char *url, char *buffer, std::size_t capacity) override;
  void setTimeout(uint32_t) override {}

  /// Point the client at a virtual timestamp; a scenario advances one frame
  /// per ``stepMs`` of virtual time, so --speed just scales the clock.
  void setTime(uint32_t virtualMs) { virtualMs_ = virtualMs; }
  void setStepMs(uint32_t stepMs) { stepMs_ = stepMs == 0 ? 1 : stepMs; }

  std::size_t frameCount() const { return frames_.size(); }

  /// Which frame the virtual clock currently selects. Scenarios always loop --
  /// the emulator is something you leave running.
  std::size_t currentIndex() const;

 private:
  std::vector<std::string> frames_;
  uint32_t virtualMs_ = 0;
  uint32_t stepMs_ = 1000;
};

}  // namespace skypanel
