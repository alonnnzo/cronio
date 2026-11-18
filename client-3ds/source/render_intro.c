#include "render_intro.h"

#include "cronio_palabra_t3x.h" // el .t3x de gfx/cronio_palabra.t3s, incrustado en el ejecutable
#include "logic/palette.h"
#include "ui_draw.h"
#include "ui_scale.h"
#include "ui_text.h"

#define ORANGE 0xEE7446u
#define INK 0x12131Au
#define LOGO_CX 160.0f
#define TAGLINE "Tu agente en la 3DS"

static C2D_SpriteSheet g_sheet;

int render_intro_init(void) {
  g_sheet = C2D_SpriteSheetLoadFromMem(cronio_palabra_t3x, cronio_palabra_t3x_size);
  return g_sheet != NULL;
}

void render_intro_exit(void) {
  if (g_sheet != NULL) C2D_SpriteSheetFree(g_sheet);
  g_sheet = NULL;
}

static void draw_eye(const IntroEye *e, float dx, float dxg) {
  float ry = e->ry * e->scale_y;
  if (ry < 0.3f || e->rx < 0.3f) return;
  float cx = e->cx + dx;
  C2D_DrawEllipseSolid(cx - e->rx, e->cy - ry, 0.0f, e->rx * 2.0f, ry * 2.0f, ui_rgb(INK, 1.0f));
  if (e->glint_r > 0.2f && e->scale_y > 0.3f) // el brillo se apaga cuando el ojo casi se cierra
    C2D_DrawCircleSolid(cx + dxg + e->glint_dx, e->cy + e->glint_dy * e->scale_y, 0.0f, e->glint_r, ui_rgb(0xffffff, 0.85f));
}

void render_intro_top(const IntroFrame *f, StereoEye eye, float slider, uint32_t face_rgb) {
  ui_rect(0, 0, 400, 240, ui_rgb(0x000000, 1.0f)); // negro: empalma con el logo de Homebrew
  if (!f->square_visible) return;
  float dx_bg = stereo_offset(eye, f->depth_bg, slider);
  float dx_eyes = stereo_offset(eye, f->depth_eyes, slider);
  float dx_glint = stereo_offset(eye, f->depth_glint, slider) - dx_eyes;
  uint32_t rgb = pal_lerp(ORANGE, face_rgb, (int)(f->color_mix * 256.0f + 0.5f));
  ui_rrect(f->x + dx_bg, f->y, f->w, f->h, f->radius, ui_rgb(rgb, 1.0f));
  if (!f->eyes_visible) return;
  for (int i = 0; i < 2; i++) draw_eye(&f->eye[i], dx_eyes, dx_glint);
}

void render_intro_bottom(const IntroFrame *f) {
  if (g_sheet != NULL && f->logo_alpha > 0.0f) {
    C2D_Image img = C2D_SpriteSheetGetImage(g_sheet, 0);
    C2D_ImageTint tint;
    C2D_AlphaImageTint(&tint, f->logo_alpha);
    float w = (float)img.subtex->width, h = (float)img.subtex->height;
    C2D_DrawImageAt(img, LOGO_CX - w / 2.0f, f->logo_y - h / 2.0f, 0.0f, &tint, 1.0f, 1.0f);
  }
  if (f->text_alpha > 0.0f) // ~13 px, centrado en y 150 (ui_text_draw pone y arriba de la celda de 30 px)
    ui_text_draw(TAGLINE, LOGO_CX, 150.0f - S_SMALL * UI_TEXT_CELL_H / 2.0f, S_SMALL, S_MIN, 300.0f, ui_rgb(pal()->mute, f->text_alpha),
                 UI_ALIGN_CENTER);
  if (f->bg_cover > 0.0f) ui_rect(0, 0, 320, 240, ui_rgb(0x000000, f->bg_cover));
}
