// A one-purpose WebSocket server: push panel frames to a browser tab.
//
// Server-to-client only, no fragmentation, no compression, no client messages
// beyond the handshake and the occasional close. That is all `emulator/web`
// needs, and it keeps the whole thing under 250 lines with no dependency.
//
// Useful when you want the panel visible on a second screen or a phone while
// you work on the backend, and it is the only way to view the emulator over
// SSH.
#pragma once

#include <string>
#include <vector>

#include "PanelSim.h"

namespace skypanel {

class WebSocketServer {
 public:
  ~WebSocketServer();

  /// Start listening on ``port``. Non-blocking: no client is required.
  bool start(int port, std::string &error);

  /// Accept pending connections and drop dead ones. Call once per frame.
  void poll();

  /// Send a frame to every connected viewer as a binary message:
  /// [uint16 width][uint16 height][RGB bytes], little-endian.
  void broadcast(const Image &image);

  /// Serve the single-page viewer at "/" over the same port.
  void setPage(std::string html) { page_ = std::move(html); }

  int clientCount() const { return static_cast<int>(clients_.size()); }
  int port() const { return port_; }
  void stop();

 private:
  bool handshake(int fd);

  int listenFd_ = -1;
  int port_ = 0;
  std::vector<int> clients_;
  std::string page_;
};

/// The browser viewer, embedded so the binary is self-contained.
const char *webViewerHtml();

}  // namespace skypanel
