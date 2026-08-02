# The native test binary: render path, app logic and golden images.

add_executable(skypanel-tests
  main.cpp
  test_json.cpp
  test_frame_parser.cpp
  test_render.cpp
  test_app.cpp
  test_snapshots.cpp
)

target_link_libraries(skypanel-tests PRIVATE skypanel_emu_support)

target_compile_definitions(skypanel-tests PRIVATE
  SKYPANEL_FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../../emulator/fixtures"
  SKYPANEL_SNAPSHOT_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../../emulator/snapshots"
)

add_test(NAME render COMMAND skypanel-tests)

# Snapshot failures write a .actual.png next to the golden, so run the tests
# from a directory where those paths resolve.
set_tests_properties(render PROPERTIES
  WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
)
