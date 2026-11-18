// Hace repetible la generación de datos de prueba: el almacén del puente pone un UUID al azar a cada aviso y pregunta,
// y sin esto cada ejecución de gen-view-fixtures.ts cambiaría los .h y los .json. Con una cuenta fija sale siempre lo mismo.
// Debe importarse antes que `../src/store.ts` (los módulos se evalúan en el orden de los import).
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";

let contador = 0;
(crypto as { randomUUID: () => string }).randomUUID = () => `00000000-0000-4000-8000-${String(++contador).padStart(12, "0")}`;
syncBuiltinESMExports();
