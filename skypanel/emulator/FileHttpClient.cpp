#include "FileHttpClient.h"

#include <cstring>
#include <fstream>
#include <sstream>

namespace skypanel {

bool FileHttpClient::loadFrame(const std::string &path, std::string &error) {
  std::ifstream file(path);
  if (!file) {
    error = "cannot open " + path;
    return false;
  }
  std::ostringstream contents;
  contents << file.rdbuf();
  frames_.clear();
  frames_.push_back(contents.str());
  if (frames_.back().empty()) {
    error = path + " is empty";
    frames_.clear();
    return false;
  }
  return true;
}

bool FileHttpClient::loadScenario(const std::string &path, std::string &error) {
  std::ifstream file(path);
  if (!file) {
    error = "cannot open " + path;
    return false;
  }
  frames_.clear();
  std::string line;
  while (std::getline(file, line)) {
    //  Blank lines and #-comments make hand-written scenarios readable.
    const std::size_t start = line.find_first_not_of(" \t\r");
    if (start == std::string::npos || line[start] == '#') {
      continue;
    }
    frames_.push_back(line.substr(start));
  }
  if (frames_.empty()) {
    error = path + " contained no frames (expected one JSON document per line)";
    return false;
  }
  return true;
}

std::size_t FileHttpClient::currentIndex() const {
  if (frames_.size() <= 1) {
    return 0;
  }
  const std::size_t step = virtualMs_ / stepMs_;
  if (loop_) {
    return step % frames_.size();
  }
  return step >= frames_.size() ? frames_.size() - 1 : step;
}

bool FileHttpClient::exhausted() const {
  return !loop_ && frames_.size() > 1 &&
         (virtualMs_ / stepMs_) >= frames_.size();
}

HttpResponse FileHttpClient::get(const char *url, char *buffer,
                                 std::size_t capacity) {
  (void)url;
  HttpResponse response;
  if (buffer == nullptr || capacity == 0) {
    response.error = "no buffer";
    return response;
  }
  buffer[0] = '\0';
  if (frames_.empty()) {
    response.error = "no frames loaded";
    return response;
  }

  const std::string &frame = frames_[currentIndex()];
  if (frame.size() + 1 > capacity) {
    response.error = "frame larger than the device buffer";
    return response;
  }
  std::memcpy(buffer, frame.data(), frame.size());
  buffer[frame.size()] = '\0';

  response.ok = true;
  response.status = 200;
  response.body = buffer;
  response.length = frame.size();
  return response;
}

}  // namespace skypanel
