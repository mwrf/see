cmake_minimum_required(VERSION 3.16)
project(skypanel_emulator CXX)

# The whole point of this build: `firmware/lib/render` and `firmware/lib/display` are
# compiled here from the same sources the ESP32 target uses. PlatformIO drives the
# hardware build; CMake drives this one. Neither owns a copy of the renderer.

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

set(FIRMWARE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../firmware)

find_package(PkgConfig REQUIRED)
pkg_check_modules(ZLIB REQUIRED zlib)
pkg_check_modules(SDL2 sdl2)

# ---------------------------------------------------------------- shared render code

add_library(skypanel_render STATIC
  ${FIRMWARE_DIR}/lib/third_party/Adafruit_GFX/Adafruit_GFX.cpp
  ${FIRMWARE_DIR}/lib/render/Text.cpp
  ${FIRMWARE_DIR}/lib/render/Scroller.cpp
  ${FIRMWARE_DIR}/lib/render/Renderer.cpp
  ${FIRMWARE_DIR}/lib/render/Json.cpp
  ${FIRMWARE_DIR}/lib/render/FrameParser.cpp
  ${FIRMWARE_DIR}/lib/render/fonts/Fonts.cpp
  ${FIRMWARE_DIR}/lib/display/PanelPainter.cpp
  ${FIRMWARE_DIR}/lib/display/EmulatorDisplay.cpp
  ${FIRMWARE_DIR}/lib/net/PosixHttpClient.cpp
  ${FIRMWARE_DIR}/lib/device/Buttons.cpp
  ${FIRMWARE_DIR}/lib/device/DeviceConfig.cpp
  ${FIRMWARE_DIR}/lib/display/Hub75Display.cpp
)

target_include_directories(skypanel_render PUBLIC
  ${FIRMWARE_DIR}/lib/compat
  ${FIRMWARE_DIR}/lib/third_party/Adafruit_GFX
  ${FIRMWARE_DIR}/lib/render
  ${FIRMWARE_DIR}/lib/display
  ${FIRMWARE_DIR}/lib/net
  ${FIRMWARE_DIR}/lib/device
)

# ARDUINO is tested by Adafruit_GFX.h before it includes Arduino.h, so it has to come
# from the command line rather than from the shim.
target_compile_definitions(skypanel_render PUBLIC ARDUINO=100 SKYPANEL_NATIVE=1)
target_compile_options(skypanel_render PRIVATE -Wall -Wextra)

if(SDL2_FOUND)
  target_compile_definitions(skypanel_render PUBLIC SKYPANEL_WITH_SDL=1)
  target_include_directories(skypanel_render PUBLIC ${SDL2_INCLUDE_DIRS})
  target_link_libraries(skypanel_render PUBLIC ${SDL2_LIBRARIES})
else()
  message(WARNING "SDL2 not found — building headless only (--snapshot/--record still work)")
endif()

# ------------------------------------------------------------------------ emulator

add_executable(skypanel-emu
  main.cpp
  src/Png.cpp
  src/Gif.cpp
  src/WebView.cpp
)
target_include_directories(skypanel-emu PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(skypanel-emu PRIVATE skypanel_render ${ZLIB_LIBRARIES} pthread)
target_compile_options(skypanel-emu PRIVATE -Wall -Wextra)

# --------------------------------------------------------------------------- tests

enable_testing()

add_executable(render_tests
  ${FIRMWARE_DIR}/test/test_main.cpp
  ${FIRMWARE_DIR}/test/test_text.cpp
  ${FIRMWARE_DIR}/test/test_json.cpp
  ${FIRMWARE_DIR}/test/test_frame_parser.cpp
  ${FIRMWARE_DIR}/test/test_scroller.cpp
  ${FIRMWARE_DIR}/test/test_renderer.cpp
  ${FIRMWARE_DIR}/test/test_painter.cpp
  ${FIRMWARE_DIR}/test/test_http.cpp
  ${FIRMWARE_DIR}/test/test_buttons.cpp
  ${FIRMWARE_DIR}/test/test_device.cpp
  ${FIRMWARE_DIR}/test/test_webview.cpp
  src/WebView.cpp
)
target_include_directories(render_tests PRIVATE
  ${FIRMWARE_DIR}/test ${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_link_libraries(render_tests PRIVATE skypanel_render pthread)
target_compile_options(render_tests PRIVATE -Wall -Wextra)

add_test(NAME render_tests COMMAND render_tests)
