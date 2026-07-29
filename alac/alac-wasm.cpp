// A minimal C interface over Apple's ALAC decoder, for compiling to WebAssembly.
//
// Apple's decoder is a C++ class; this exposes just enough of it to decode packets, with a
// flat C ABI that Emscripten can export and JavaScript can call. Decoder only: none of the
// encoder sources are compiled in.
//
// Output layout, which is not uniform and is the easiest thing to get wrong:
//
//   16-bit -> interleaved int16          (2 bytes per sample)
//   20-bit -> interleaved packed 3-byte  (3 bytes per sample)
//   24-bit -> interleaved packed 3-byte  (3 bytes per sample)
//   32-bit -> interleaved int32          (4 bytes per sample)
//
// So 24-bit is packed, NOT sign-extended into 32-bit containers. A caller that assumes
// otherwise reads garbage that still looks like plausible audio.

#include <stdlib.h>
#include <string.h>

#include "ALACDecoder.h"
#include "ALACBitUtilities.h"

extern "C" {

struct AlacCtx {
	ALACDecoder *decoder;
	uint32_t channels;
	uint32_t bitDepth;
	uint32_t frameLength;
	uint32_t sampleRate;
};

void alac_destroy(AlacCtx *ctx);

/** Bytes each sample occupies in the decoder's output, per bit depth. */
static uint32_t alac_bytes_per_sample(uint32_t bitDepth) {
	switch (bitDepth) {
		case 16: return 2;
		case 20: return 3;
		case 24: return 3;
		case 32: return 4;
		default: return 0;
	}
}

/**
 * Create a decoder from the ALACSpecificConfig magic cookie (the 24 bytes from the sample
 * entry's nested 'alac' box). Returns null if the cookie is unusable.
 */
AlacCtx *alac_create(const uint8_t *cookie, uint32_t cookieSize) {
	if (cookie == NULL || cookieSize < 24) {
		return NULL;
	}

	ALACDecoder *decoder = new ALACDecoder();
	// Init does not modify the cookie, but takes it as void*.
	if (decoder->Init((void *)cookie, cookieSize) != 0) {
		delete decoder;
		return NULL;
	}

	AlacCtx *ctx = (AlacCtx *)calloc(1, sizeof(AlacCtx));
	if (ctx == NULL) {
		delete decoder;
		return NULL;
	}

	ctx->decoder = decoder;
	ctx->channels = decoder->mConfig.numChannels;
	ctx->bitDepth = decoder->mConfig.bitDepth;
	ctx->frameLength = decoder->mConfig.frameLength;
	// The config stores sample rate big-endian-swapped already by Init.
	ctx->sampleRate = decoder->mConfig.sampleRate;

	if (alac_bytes_per_sample(ctx->bitDepth) == 0) {
		alac_destroy(ctx);
		return NULL;
	}
	return ctx;
}

uint32_t alac_channels(AlacCtx *ctx) { return ctx ? ctx->channels : 0; }
uint32_t alac_bit_depth(AlacCtx *ctx) { return ctx ? ctx->bitDepth : 0; }
uint32_t alac_frame_length(AlacCtx *ctx) { return ctx ? ctx->frameLength : 0; }
uint32_t alac_sample_rate(AlacCtx *ctx) { return ctx ? ctx->sampleRate : 0; }

/** Bytes one full frame of output occupies, so the caller can size its buffer. */
uint32_t alac_bytes_per_frame(AlacCtx *ctx) {
	return ctx ? ctx->channels * alac_bytes_per_sample(ctx->bitDepth) : 0;
}

/**
 * Decode one packet into `out`, which must hold at least
 * alac_bytes_per_frame() * alac_frame_length() bytes. Returns the number of frames
 * decoded, or a negative value on error.
 */
int32_t alac_decode(
	AlacCtx *ctx,
	const uint8_t *packet,
	uint32_t packetSize,
	uint8_t *out,
	uint32_t outCapacityFrames
) {
	if (ctx == NULL || packet == NULL || out == NULL) {
		return -1;
	}
	if (outCapacityFrames < ctx->frameLength) {
		return -2;
	}

	BitBuffer bits;
	// BitBufferInit takes a mutable pointer but only reads.
	BitBufferInit(&bits, (uint8_t *)packet, packetSize);

	uint32_t decoded = 0;
	int32_t status = ctx->decoder->Decode(&bits, out, ctx->frameLength, ctx->channels, &decoded);
	if (status != 0) {
		return -3;
	}
	return (int32_t)decoded;
}

void alac_destroy(AlacCtx *ctx) {
	if (ctx == NULL) {
		return;
	}
	delete ctx->decoder;
	free(ctx);
}

} // extern "C"
