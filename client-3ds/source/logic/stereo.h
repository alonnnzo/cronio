// 3D estereoscópico de la pantalla de arriba: cuánto se desplaza horizontalmente cada capa en cada ojo. Sin libctru:
// el deslizador (osGet3DSliderState, de 0.0 a 1.0) llega como número y se prueba en el PC.
//
// Cada capa tiene una profundidad en píxeles; positiva queda delante de la pantalla. El ojo izquierdo desplaza la capa
// a la derecha (+) y el derecho a la izquierda (-): dx = s * profundidad * deslizador, con s = +1 / -1. La capa de
// profundidad 0 no se mueve (el plano de la pantalla).
#ifndef LOGIC_STEREO_H
#define LOGIC_STEREO_H

typedef enum { STEREO_LEFT = 0, STEREO_RIGHT = 1 } StereoEye;

// Profundidades (px) de las capas de la cara.
#define STEREO_DEPTH_FACE 0.0f   // fondo del agente a pantalla completa: el plano de la pantalla, no se mueve
#define STEREO_DEPTH_EYES 5.0f   // ojos y boca: sobresalen un poco
#define STEREO_DEPTH_GLINT 6.0f  // brillo de los ojos
#define STEREO_DEPTH_BUBBLE 9.0f // globo con su borde, su punta y su texto: lo más cerca
// Tope de una capa a deslizador lleno (para no cansar la vista).
#define STEREO_MAX_DEPTH 10.0f

// Deslizador acotado a 0..1 (también sanea NaN: 0).
float stereo_slider_clamp(float slider);
// Desplazamiento horizontal (px) de una capa de profundidad `depth_px` para el ojo dado. Deslizador 0: siempre 0.
float stereo_offset(StereoEye eye, float depth_px, float slider);

#endif
