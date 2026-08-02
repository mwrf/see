// A ~90-line test framework, so the render path's tests need no dependency.
//
// PlatformIO's native environment can run Unity, and CMake could pull in
// GoogleTest, but both would have to be fetched at build time -- and a suite
// that cannot run offline is not much of a regression net for a project whose
// whole point is working without the network.
#pragma once

#include <cmath>
#include <cstdio>
#include <cstring>
#include <functional>
#include <string>
#include <vector>

namespace skytest {

struct TestCase {
  const char *name;
  std::function<void()> body;
};

inline std::vector<TestCase> &registry() {
  static std::vector<TestCase> cases;
  return cases;
}

inline int &failures() {
  static int count = 0;
  return count;
}

inline std::string &currentTest() {
  static std::string name;
  return name;
}

struct Registrar {
  Registrar(const char *name, std::function<void()> body) {
    registry().push_back({name, std::move(body)});
  }
};

inline void reportFailure(const char *file, int line, const std::string &message) {
  ++failures();
  std::printf("  FAIL %s\n    %s:%d: %s\n", currentTest().c_str(), file, line,
              message.c_str());
}

inline int run(int argc, char **argv) {
  const char *filter = argc > 1 ? argv[1] : nullptr;
  int ran = 0;
  int failed = 0;

  for (const TestCase &test : registry()) {
    if (filter != nullptr && std::strstr(test.name, filter) == nullptr) {
      continue;
    }
    currentTest() = test.name;
    const int before = failures();
    ++ran;
    test.body();
    if (failures() > before) {
      ++failed;
    }
  }

  if (failed == 0) {
    std::printf("%d tests passed\n", ran);
    return 0;
  }
  std::printf("\n%d of %d tests failed\n", failed, ran);
  return 1;
}

}  // namespace skytest

#define TEST(name)                                                            \
  static void name();                                                         \
  static skytest::Registrar registrar_##name(#name, name);                    \
  static void name()

#define CHECK(condition)                                                      \
  do {                                                                        \
    if (!(condition)) {                                                       \
      skytest::reportFailure(__FILE__, __LINE__, "expected: " #condition);    \
    }                                                                         \
  } while (0)

#define CHECK_EQ(actual, expected)                                            \
  do {                                                                        \
    const auto actual_ = (actual);                                            \
    const auto expected_ = (expected);                                        \
    if (!(actual_ == expected_)) {                                            \
      skytest::reportFailure(__FILE__, __LINE__,                              \
                             std::string(#actual " == " #expected            \
                                                 "\n      actual:   ") +      \
                                 std::to_string(actual_) +                    \
                                 "\n      expected: " + std::to_string(expected_)); \
    }                                                                         \
  } while (0)

#define CHECK_STR(actual, expected)                                           \
  do {                                                                        \
    const char *actual_ = (actual);                                           \
    const char *expected_ = (expected);                                       \
    if (actual_ == nullptr || std::strcmp(actual_, expected_) != 0) {         \
      skytest::reportFailure(                                                 \
          __FILE__, __LINE__,                                                 \
          std::string(#actual "\n      actual:   \"") +                       \
              (actual_ == nullptr ? "(null)" : actual_) +                     \
              "\"\n      expected: \"" + expected_ + "\"");                   \
    }                                                                         \
  } while (0)

#define CHECK_NEAR(actual, expected, tolerance)                               \
  do {                                                                        \
    const double actual_ = static_cast<double>(actual);                       \
    const double expected_ = static_cast<double>(expected);                   \
    if (std::fabs(actual_ - expected_) > (tolerance)) {                       \
      skytest::reportFailure(__FILE__, __LINE__,                              \
                             std::string(#actual " ~= " #expected            \
                                                 "\n      actual:   ") +      \
                                 std::to_string(actual_) +                    \
                                 "\n      expected: " + std::to_string(expected_)); \
    }                                                                         \
  } while (0)
