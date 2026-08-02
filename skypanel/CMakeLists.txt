# Native build: the emulator and the render-path tests.
#
# The device is built with PlatformIO (firmware/platformio.ini). CMake exists
# because the emulator is the primary development target and has to build on a
# laptop with nothing but a compiler, zlib and -- optionally -- SDL2.
#
#   cmake -B build -DCMAKE_BUILD_TYPE=Release
#   cmake --build build -j
#   ctest --test-dir build --output-on-failure

cmake_minimum_required(VERSION 3.16)
project(skypanel LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

add_compile_options(-Wall -Wextra -Wpedantic)

find_package(ZLIB REQUIRED)

# SDL2 is optional on purpose: --snapshot, --record and the whole golden-image
# suite work headless, so CI needs no display libraries.
find_package(SDL2 QUIET)
if(SDL2_FOUND)
  message(STATUS "SDL2 found -- the emulator will open a window")
else()
  message(STATUS "SDL2 not found -- building headless (snapshots and recordings only)")
endif()

set(FIRMWARE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/firmware)
set(EMULATOR_DIR ${CMAKE_CURRENT_SOURCE_DIR}/emulator)

# -- Adafruit_GFX, built natively via the Arduino compatibility shims ---------

add_library(adafruit_gfx STATIC
  ${FIRMWARE_DIR}/lib/vendor/Adafruit_GFX/Adafruit_GFX.cpp
)
target_include_directories(adafruit_gfx PUBLIC
  ${FIRMWARE_DIR}/lib/arduino_compat
  ${FIRMWARE_DIR}/lib/vendor/Adafruit_GFX
)
target_compile_definitions(adafruit_gfx PUBLIC ARDUINO=10819)
# Vendored third-party code: keep its warnings out of our build output.
target_compile_options(adafruit_gfx PRIVATE -w)

# -- the shared render path (identical sources on both targets) --------------

add_library(skypanel_render STATIC
  ${FIRMWARE_DIR}/lib/render/Json.cpp
  ${FIRMWARE_DIR}/lib/render/FrameParser.cpp
  ${FIRMWARE_DIR}/lib/render/TextEngine.cpp
  ${FIRMWARE_DIR}/lib/render/Scroller.cpp
  ${FIRMWARE_DIR}/lib/render/Renderer.cpp
)
target_include_directories(skypanel_render PUBLIC ${FIRMWARE_DIR}/lib/render)
target_link_libraries(skypanel_render PUBLIC adafruit_gfx)

# -- display and app layers --------------------------------------------------

add_library(skypanel_device STATIC
  ${FIRMWARE_DIR}/lib/display/PanelSim.cpp
  ${FIRMWARE_DIR}/lib/display/EmulatorDisplay.cpp
  ${FIRMWARE_DIR}/lib/display/Hub75Display.cpp
  ${FIRMWARE_DIR}/lib/net/SocketHttpClient.cpp
  ${FIRMWARE_DIR}/lib/net/Esp32HttpClient.cpp
  # Device-only features. Their native stubs are compiled here on purpose:
  # a stub that does not link is a build break discovered on hardware.
  ${FIRMWARE_DIR}/lib/net/Provisioning.cpp
  ${FIRMWARE_DIR}/lib/net/Ota.cpp
  ${FIRMWARE_DIR}/lib/app/Buttons.cpp
  ${FIRMWARE_DIR}/lib/app/DeviceConfig.cpp
  ${FIRMWARE_DIR}/lib/app/PanelApp.cpp
)
target_include_directories(skypanel_device PUBLIC
  ${FIRMWARE_DIR}/lib/display
  ${FIRMWARE_DIR}/lib/net
  ${FIRMWARE_DIR}/lib/app
)
target_link_libraries(skypanel_device PUBLIC skypanel_render)

if(SDL2_FOUND)
  target_compile_definitions(skypanel_device PUBLIC SKYPANEL_HAVE_SDL)
  target_include_directories(skypanel_device PUBLIC ${SDL2_INCLUDE_DIRS})
  target_link_libraries(skypanel_device PUBLIC ${SDL2_LIBRARIES})
endif()

# -- emulator support: PNG, GIF, the browser view ----------------------------

file(READ ${EMULATOR_DIR}/web/viewer.html SKYPANEL_VIEWER_HTML)
configure_file(${EMULATOR_DIR}/WebViewer.cpp.in
               ${CMAKE_CURRENT_BINARY_DIR}/WebViewer.cpp @ONLY)

add_library(skypanel_emu_support STATIC
  ${EMULATOR_DIR}/Png.cpp
  ${EMULATOR_DIR}/Gif.cpp
  ${EMULATOR_DIR}/FileHttpClient.cpp
  ${EMULATOR_DIR}/WebSocketServer.cpp
  ${CMAKE_CURRENT_BINARY_DIR}/WebViewer.cpp
)
target_include_directories(skypanel_emu_support PUBLIC ${EMULATOR_DIR})
target_link_libraries(skypanel_emu_support PUBLIC skypanel_device ZLIB::ZLIB)

# -- the emulator itself -----------------------------------------------------

add_executable(skypanel-emu ${EMULATOR_DIR}/main.cpp)
target_link_libraries(skypanel-emu PRIVATE skypanel_emu_support)

# -- tests -------------------------------------------------------------------

enable_testing()
add_subdirectory(firmware/test)
