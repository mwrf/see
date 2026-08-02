// Entry point for the native test binary.
//
//   ./skypanel-tests            run everything
//   ./skypanel-tests scroll     run tests whose name contains "scroll"
#include "TestFramework.h"

int main(int argc, char **argv) { return skytest::run(argc, argv); }
