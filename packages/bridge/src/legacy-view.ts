// Vista mínima para una consola que solo habla la v1 (sin cifrado): el puente la admite únicamente para que pueda actualizarse.
//
// Por la v1 nunca viaja contenido: ni sesiones, ni solicitudes, ni textos de Claude. Es lo justo para que la app 0.2.9 (y cualquier
// consola anterior a la v2) pase su parser, dibuje el aviso en la cara y muestre la tarjeta de actualización (`update`), que aparece
// cuando no hay solicitud ni aviso (`update_card_visible`, client-3ds/source/logic/update.c).
import type { BridgeMessage, UpdateView } from "@companion/protocol";

/** Lo que dice el globo de la cara de una consola v1 (dos líneas de hasta 38 caracteres). */
export const LEGACY_FACE_LINES = ["Actualiza Cronio", "para seguir"] as const;

/** La única vista que recibe una consola v1; `update` es la oferta del .cia si el puente tiene uno más nuevo. `rev` fijo: no hay nada que actualizar después. */
export function legacyView(update?: UpdateView): BridgeMessage {
  return {
    t: "view",
    rev: 1,
    view: {
      sessions: [],
      request: null,
      pendingCount: 0,
      mode: "queue",
      face: { kind: null, mood: "idle", lines: [...LEGACY_FACE_LINES] },
      detail: null,
      led: "off",
      ...(update ? { update } : {}),
    },
  };
}
