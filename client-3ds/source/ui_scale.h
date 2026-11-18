// Escalas de texto de la fuente del sistema (celda de 30 px a escala 1), una sola tabla para toda la consola.
// Regla: nada se dibuja por debajo de 0.36 (unos 11 px de celda); más pequeño la hoja de glifos, reducida con filtro
// lineal, se emborrona en la pantalla real. S_MIN es el piso al que ui_text_draw baja una línea que no cabe: si aun así
// no cabe, la recorta con "…" en vez de encogerla más.
// Ancho medio de glifo: unos 13 px por escala (38 caracteres a 0.36 miden unos 180 px).
#ifndef UI_SCALE_H
#define UI_SCALE_H

#define S_HEAD 0.52f   // título centrado de las tarjetas de aviso
#define S_TITLE 0.48f  // títulos de pantalla y de barra (siempre más grandes que el cuerpo)
#define S_BODY 0.40f   // cuerpo: etiquetas, nombres, botones, guía, menú, diagnóstico
#define S_READER 0.42f // letra del lector: 48 caracteres por línea ocupan unos 265 de los 306 px útiles
#define S_SMALL 0.36f  // texto secundario: ayudas, estados, subtítulos, pregunta y último mensaje del detalle
#define S_TINY S_SMALL // antes 0.30; igual que S_SMALL para no bajar del piso
#define S_MIN 0.36f    // piso del auto-ajuste de ui_text_draw

#endif
