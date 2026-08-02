// A 60-line test harness.
//
// The firmware's tests run in three places — this CMake build, PlatformIO's `native`
// env, and CI — and none of them should need a package manager to do it.

#pragma once

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace testing {

struct TestCase {
  const char *name;
  void (*fn)();
};

inline std::vector<TestCase> &registry() {
  static std::vector<TestCase> cases;
  return cases;
}

inline int &failures() {
  static int count = 0;
  return count;
}

inline const char *&currentTest() {
  static const char *name = "";
  return name;
}

struct Registrar {
  Registrar(const char *name, void (*fn)()) { registry().push_back({name, fn}); }
};

inline void report(const char *file, int line, const std::string &message) {
  std::printf("  FAIL %s\n       %s:%d: %s\n", currentTest(), file, line, message.c_str());
  failures()++;
}

inline std::string quote(const std::string &s) { return "\"" + s + "\""; }
inline std::string show(const std::string &s) { return quote(s); }
inline std::string show(const char *s) { return quote(s == nullptr ? "(null)" : s); }
inline std::string show(bool b) { return b ? "true" : "false"; }
template <typename T> std::string show(T value) { return std::to_string(value); }

inline int run() {
  std::printf("running %zu tests\n", registry().size());
  for (const auto &test : registry()) {
    currentTest() = test.name;
    test.fn();
  }
  if (failures() == 0) {
    std::printf("all %zu tests passed\n", registry().size());
    return 0;
  }
  std::printf("%d assertion(s) failed\n", failures());
  return 1;
}

} // namespace testing

#define TEST(name)                                                                       \
  static void name();                                                                    \
  static testing::Registrar registrar_##name(#name, name);                               \
  static void name()

#define CHECK(condition)                                                                 \
  do {                                                                                   \
    if (!(condition)) {                                                                  \
      testing::report(__FILE__, __LINE__, "expected " #condition);                       \
    }                                                                                    \
  } while (0)

#define CHECK_EQ(actual, expected)                                                       \
  do {                                                                                   \
    const auto actual_ = (actual);                                                       \
    const auto expected_ = (expected);                                                   \
    if (!(actual_ == expected_)) {                                                        \
      testing::report(__FILE__, __LINE__,                                                \
                      std::string(#actual " == " #expected " — got ") +                  \
                          testing::show(actual_) + ", want " + testing::show(expected_)); \
    }                                                                                    \
  } while (0)

#define CHECK_STREQ(actual, expected)                                                    \
  do {                                                                                   \
    const char *actual_ = (actual);                                                      \
    const char *expected_ = (expected);                                                  \
    if (actual_ == nullptr || std::strcmp(actual_, expected_) != 0) {                    \
      testing::report(__FILE__, __LINE__,                                                \
                      std::string(#actual " — got ") + testing::show(actual_) +          \
                          ", want " + testing::show(expected_));                         \
    }                                                                                    \
  } while (0)

#define CHECK_NEAR(actual, expected, tolerance)                                          \
  do {                                                                                   \
    const double actual_ = static_cast<double>(actual);                                  \
    const double expected_ = static_cast<double>(expected);                              \
    if (std::fabs(actual_ - expected_) > (tolerance)) {                                  \
      testing::report(__FILE__, __LINE__,                                                \
                      std::string(#actual " — got ") + testing::show(actual_) +          \
                          ", want " + testing::show(expected_) + " ± " +                 \
                          testing::show(static_cast<double>(tolerance)));                \
    }                                                                                    \
  } while (0)
