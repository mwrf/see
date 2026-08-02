// Optional browser view.
//
// `--web 8080` starts a tiny HTTP server that serves one self-contained page and pushes
// every rendered frame to it over a WebSocket. Useful for showing someone the panel
// without screen-sharing, and for working on a headless box.
//
// What crosses the wire is the *emitted* colour of each of the 2048 LEDs — brightness
// and gamma already applied by `PanelPainter`. The browser only draws circles. That way
// the view can't drift away from the SDL window and the PNG snapshots, which remain the
// reference rendering.

#pragma once

#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "Frame.h"
#include "PanelPainter.h"

namespace skypanel {

class WebView {
public:
  ~WebView();

  bool start(int port);
  void stop();

  /// Push a frame to every connected browser. Cheap and non-blocking when nobody is
  /// watching, which is the usual case.
  void broadcast(const DisplayFrame &frame, const Image &image);

  bool running() const { return running_.load(); }
  const char *error() const { return error_.c_str(); }

private:
  std::atomic<bool> running_{false};
  std::thread acceptor_;
  int listenFd_ = -1;
  std::mutex clientsMutex_;
  std::vector<int> clients_;
  std::string error_;
  int scale_ = 0;

  void acceptLoop();
  void serveHttp(int fd, const std::string &request);
  bool handshake(int fd, const std::string &request);
  void sendText(int fd, const std::string &payload);
};

/// Exposed for testing: the RFC 6455 `Sec-WebSocket-Accept` value for a client key.
std::string websocketAccept(const std::string &key);

/// Exposed for testing.
std::string base64(const uint8_t *data, size_t length);

} // namespace skypanel
