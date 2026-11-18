// Prueba 0.2: comprueba la cadena de compilación, citro2d y las dos pantallas.
// Arriba dibuja los cinco puntos de los agentes; abajo muestra texto. START para salir.
#include <3ds.h>
#include <citro2d.h>
#include <math.h>
#include <stdio.h>

int main(void) {
	gfxInitDefault();
	C3D_Init(C3D_DEFAULT_CMDBUF_SIZE);
	C2D_Init(C2D_DEFAULT_MAX_OBJECTS);
	C2D_Prepare();
	consoleInit(GFX_BOTTOM, NULL);
	C3D_RenderTarget *top = C2D_CreateScreenTarget(GFX_TOP, GFX_LEFT);

	const u32 bg = C2D_Color32(0x0d, 0x0e, 0x13, 0xff);
	const u32 colors[5] = {
		C2D_Color32(0xee, 0x74, 0x46, 0xff), // Claude
		C2D_Color32(0x5b, 0x8c, 0xff, 0xff), // Gemini
		C2D_Color32(0x2f, 0xd0, 0x8a, 0xff), // Codex
		C2D_Color32(0xd5, 0xd9, 0xe2, 0xff), // Cursor
		C2D_Color32(0xf6, 0xc5, 0x44, 0xff), // Hermes
	};

	bool isNew = false;
	APT_CheckNew3DS(&isNew);
	printf("\x1b[2;2H3DS Agent Companion - prueba 0.2");
	printf("\x1b[4;2HConsola: %s", isNew ? "New 3DS" : "Old 3DS / 2DS");
	printf("\x1b[10;2HSTART para salir");

	u32 frame = 0;
	while (aptMainLoop()) {
		hidScanInput();
		if (hidKeysDown() & KEY_START) break;

		printf("\x1b[6;2HCuadro %lu", (unsigned long)frame);
		printf("\x1b[7;2HCPU %5.1f%%  GPU %5.1f%%", C3D_GetProcessingTime() * 6.0f, C3D_GetDrawingTime() * 6.0f);

		C3D_FrameBegin(C3D_FRAME_SYNCDRAW);
		C2D_TargetClear(top, bg);
		C2D_SceneBegin(top);
		for (int i = 0; i < 5; i++) {
			float x = 56.0f + i * 72.0f;
			float y = 120.0f + sinf(frame / 54.0f + i * 1.7f) * 4.0f;
			C2D_DrawCircleSolid(x, y, 0.0f, 15.0f, colors[i]);
			C2D_DrawCircleSolid(x - 5.0f, y - 1.0f, 0.0f, 2.3f, bg);
			C2D_DrawCircleSolid(x + 5.0f, y - 1.0f, 0.0f, 2.3f, bg);
		}
		C3D_FrameEnd(0);
		frame++;
	}

	C2D_Fini();
	C3D_Fini();
	gfxExit();
	return 0;
}
