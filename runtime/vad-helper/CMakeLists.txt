set(TARGET whisper-vad-helper)
add_executable(${TARGET} main.cpp)

include(DefaultTargetOptions)

target_link_libraries(${TARGET} PRIVATE whisper)

install(TARGETS ${TARGET} RUNTIME)
