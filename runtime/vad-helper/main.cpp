#include "whisper.h"

#include <cerrno>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <locale.h>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

constexpr int kFrameSamples = 512;
constexpr size_t kReadBytes = 64 * 1024;

void log_callback(enum ggml_log_level level, const char * text, void *) {
    if (level == GGML_LOG_LEVEL_WARN || level == GGML_LOG_LEVEL_ERROR) {
        std::fputs(text ? text : "", stderr);
        std::fflush(stderr);
    }
}

bool parse_positive_int(const char * value, int * result) {
    if (!value || !*value) return false;
    char * end = nullptr;
    errno = 0;
    const long parsed = std::strtol(value, &end, 10);
    if (errno || !end || *end != '\0' || parsed < 1 || parsed > 512) return false;
    *result = static_cast<int>(parsed);
    return true;
}

int fail(const char * message) {
    std::fprintf(stderr, "whisper-vad-helper: %s\n", message);
    return 1;
}

bool emit_batch(whisper_vad_context * context, const std::vector<float> & samples,
                int frame_count, uint64_t * frame_index) {
    if (frame_count <= 0) return true;
    const int sample_count = frame_count * kFrameSamples;
    if (!whisper_vad_detect_speech_no_reset(context, samples.data(), sample_count)) {
        std::fputs("whisper-vad-helper: VAD computation failed\n", stderr);
        return false;
    }
    if (whisper_vad_n_probs(context) != frame_count) {
        std::fputs("whisper-vad-helper: VAD returned an unexpected probability count\n", stderr);
        return false;
    }
    const float * probabilities = whisper_vad_probs(context);
    if (!probabilities) {
        std::fputs("whisper-vad-helper: VAD returned no probabilities\n", stderr);
        return false;
    }
    for (int i = 0; i < frame_count; ++i) {
        const float probability = probabilities[i];
        if (!std::isfinite(probability) || probability < 0.0f || probability > 1.0f) {
            std::fputs("whisper-vad-helper: VAD returned an invalid probability\n", stderr);
            return false;
        }
        if (std::printf("{\"frame\":%llu,\"speechProbability\":%.6f}\n",
                        static_cast<unsigned long long>((*frame_index)++),
                        static_cast<double>(probability)) < 0) {
            std::fputs("whisper-vad-helper: stdout write failed\n", stderr);
            return false;
        }
    }
    if (std::fflush(stdout) != 0) {
        std::fputs("whisper-vad-helper: stdout flush failed\n", stderr);
        return false;
    }
    return true;
}

} // namespace

int main(int argc, char ** argv) {
    const char * model_path = nullptr;
    int threads = 1;
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--model") == 0) {
            if (model_path || i + 1 >= argc || argv[i + 1][0] == '\0')
                return fail("--model requires one path");
            model_path = argv[++i];
        } else if (std::strcmp(argv[i], "--threads") == 0) {
            if (i + 1 >= argc || !parse_positive_int(argv[++i], &threads))
                return fail("--threads requires an integer from 1 to 512");
        } else {
            return fail("usage: whisper-vad-helper --model <path> [--threads <n>]");
        }
    }
    if (!model_path) return fail("usage: whisper-vad-helper --model <path> [--threads <n>]");

#ifdef _WIN32
    if (_setmode(_fileno(stdin), _O_BINARY) == -1 || _setmode(_fileno(stdout), _O_BINARY) == -1)
        return fail("could not set stdin/stdout to binary mode");
#endif
    setlocale(LC_NUMERIC, "C");

    whisper_log_set(log_callback, nullptr);
    ggml_log_set(log_callback, nullptr);
    whisper_vad_context_params params = whisper_vad_default_context_params();
    params.n_threads = threads;
    params.use_gpu = false;
    whisper_vad_context * context = whisper_vad_init_from_file_with_params(model_path, params);
    if (!context) return fail("could not load VAD model");

    std::vector<unsigned char> pending;
    std::vector<unsigned char> input(kReadBytes);
    std::vector<float> samples;
    uint64_t frame_index = 0;
    int exit_code = 0;
    for (;;) {
#ifdef _WIN32
        const int read_result = _read(_fileno(stdin), input.data(), static_cast<unsigned int>(input.size()));
        if (read_result < 0) {
            std::fputs("whisper-vad-helper: stdin read failed\n", stderr);
            exit_code = 1;
            break;
        }
        const size_t bytes_read = static_cast<size_t>(read_result);
        const bool input_eof = read_result == 0;
#else
        const size_t bytes_read = std::fread(input.data(), 1, input.size(), stdin);
        const bool input_eof = std::feof(stdin) != 0;
#endif
        if (bytes_read) pending.insert(pending.end(), input.begin(), input.begin() + bytes_read);
#ifndef _WIN32
        if (std::ferror(stdin)) {
            std::fputs("whisper-vad-helper: stdin read failed\n", stderr);
            exit_code = 1;
            break;
        }
#endif

        const size_t complete_samples = pending.size() / sizeof(int16_t);
        const int frame_count = static_cast<int>(complete_samples / kFrameSamples);
        if (frame_count > 0) {
            const size_t samples_to_process = static_cast<size_t>(frame_count) * kFrameSamples;
            samples.resize(samples_to_process);
            for (size_t i = 0; i < samples_to_process; ++i) {
                const uint16_t bits = static_cast<uint16_t>(pending[i * 2]) |
                                      (static_cast<uint16_t>(pending[i * 2 + 1]) << 8);
                const int16_t value = static_cast<int16_t>(bits);
                samples[i] = static_cast<float>(value) / 32768.0f;
            }
            if (!emit_batch(context, samples, frame_count, &frame_index)) {
                exit_code = 1;
                break;
            }
            pending.erase(pending.begin(), pending.begin() + samples_to_process * 2);
        }

        if (input_eof) {
            if (pending.size() % 2 != 0) {
                std::fputs("whisper-vad-helper: input ended with an incomplete PCM sample\n", stderr);
                exit_code = 1;
                break;
            }
            const size_t trailing_samples = pending.size() / 2;
            if (trailing_samples) {
                samples.assign(kFrameSamples, 0.0f);
                for (size_t i = 0; i < trailing_samples; ++i) {
                    const uint16_t bits = static_cast<uint16_t>(pending[i * 2]) |
                                          (static_cast<uint16_t>(pending[i * 2 + 1]) << 8);
                    samples[i] = static_cast<float>(static_cast<int16_t>(bits)) / 32768.0f;
                }
                if (!emit_batch(context, samples, 1, &frame_index)) exit_code = 1;
            }
            break;
        }
        if (bytes_read == 0) {
            std::fputs("whisper-vad-helper: stdin stopped without EOF\n", stderr);
            exit_code = 1;
            break;
        }
    }

    whisper_vad_free(context);
    return exit_code;
}
