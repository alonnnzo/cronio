// Pantalla superior (400x240): toda la pantalla es la cara del agente (port de packages/simulator/public/face.js).
// Los números salen de logic/face_math.c; aquí solo se pinta con citro2d.
#ifndef RENDER_TOP_H
#define RENDER_TOP_H

#include "core/view.h"
#include "logic/stereo.h"

// Dibuja la cara con el destino de render ya activo (C2D_SceneBegin del ojo izquierdo o derecho de la pantalla superior).
// eye y slider (osGet3DSliderState, 0..1) fijan el desplazamiento de cada capa (logic/stereo.h): fondo en el plano de la
// pantalla, ojos y boca delante, globo más delante aún. Con el 3D activo hay que dibujar los dos ojos en cada cuadro, aunque
// el deslizador esté en 0 (mismo contenido, desplazamiento 0).
// t_ms: milisegundos desde el arranque. kind == AGENT_NONE: gris neutro (también sin conexión, con ojos cerrados
// si el ánimo es idle).
void render_top_draw(const FaceView *face, double t_ms, StereoEye eye, float slider);

#endif
