#include "stereo.h"

float stereo_slider_clamp(float slider) {
  if (!(slider > 0.0f)) return 0.0f; // también atrapa NaN
  if (slider > 1.0f) return 1.0f;
  return slider;
}

float stereo_offset(StereoEye eye, float depth_px, float slider) {
  if (depth_px > STEREO_MAX_DEPTH) depth_px = STEREO_MAX_DEPTH;
  if (depth_px < -STEREO_MAX_DEPTH) depth_px = -STEREO_MAX_DEPTH;
  float s = eye == STEREO_LEFT ? 1.0f : -1.0f;
  float dx = s * depth_px * stereo_slider_clamp(slider);
  return dx == 0.0f ? 0.0f : dx; // evita un -0.0
}
