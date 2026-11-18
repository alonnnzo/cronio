// Versión nueva de la app (Fase 7): la vista trae `update` ({ version, url }) cuando el puente tiene un .cia más nuevo que el de la
// consola. Módulo puro (sin DOM ni red), espejo de client-3ds/source/logic/update.c SOLO como aviso: el simulador no tiene app que
// instalar, así que «Actualizar» no hace nada más que decir que eso solo se hace en la consola.
//
// Reglas (las mismas que en la consola):
//  - La tarjeta aparece solo si nada más pide atención: ni solicitud (permiso, pregunta o instrucción) ni aviso con "Visto".
//  - «Ahora no» la oculta hasta recargar la página (en la consola, hasta el próximo arranque).
//  - Mientras el menú, el lector o una tarjeta ocupan la pantalla, no se ve (app.js y bottom.js usan `updateShown`).

export const UPDATE_ONLY_CONSOLE = 'Solo en la consola';

// ¿Hay que mostrar la tarjeta? `dismissed`: se pulsó «Ahora no».
export const updateShown = (view, dismissed = false) => !!(view && view.update && !view.request && !view.notice && !dismissed);

// Textos de la tarjeta (los mismos de la consola; el simulador no sabe qué versión «tiene»).
export function updateLines(view) {
  if (!view || !view.update) return [];
  return [`Hay una versión nueva de Cronio (${view.update.version}).`, 'La actualización se hace desde la consola 3DS: aquí es solo un aviso.'];
}
