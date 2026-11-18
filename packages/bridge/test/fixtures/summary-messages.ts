/**
 * Mensajes finales de ejemplo, como los escribe Claude Code al terminar un turno (español, negritas, listas, títulos,
 * tablas, bloques de código, preguntas y líneas de "falta" o "sin probar"). Los usa `summary.test.ts` para fijar la salida
 * del resumen extractivo.
 */

/** Informe con viñetas en negrita y una línea de pendiente. */
export const REPORT_BULLETS = `Listo: migré la tabla \`users\` a identificadores UUID y todo el flujo de registro sigue funcionando.

**Qué cambió**

- **Migración 014:** agrega la columna \`uuid\` con valor por defecto y rellena las 48.213 filas existentes en lotes de mil. Se aplica sin bloquear la tabla.
- **Modelo \`User\`:** el id pasa a ser UUID; \`findById\` acepta ambos formatos durante la transición.
- **Rutas de la API:** \`/users/:id\` valida el formato antes de consultar la base, así que un id inválido responde 400 y no 500.
- **Pruebas:** agregué 14 casos nuevos en \`packages/api/test/users.test.ts\` y los 212 existentes siguen pasando.

**Lo que falta**

- Falta probar el rollback de la migración en staging; en local funciona, pero no tiene tantos datos.
- Todavía hay dos consumidores internos (el panel de admin y el exportador) que asumen ids numéricos.

Si quieres, sigo con el exportador.`;

/** Con títulos, tabla y bloque de código. */
export const REPORT_HEADINGS_TABLE_CODE = `# Resultado de la auditoría de rendimiento

Medí el tiempo de carga de las cinco páginas principales antes y después de optimizar las imágenes. La mejora promedio fue de un 38 %.

## Mediciones

| Página | Antes | Después |
| --- | --- | --- |
| Inicio | 3,4 s | 1,9 s |
| Catálogo | 4,1 s | 2,2 s |
| Pedidos | 2,8 s | 1,7 s |
| Contacto | 2,1 s | 1,5 s |
| Noticias | 3,9 s | 2,6 s |

## Qué hice

Convertí los \`.jpg\` a AVIF con un respaldo en WebP y agregué \`loading="lazy"\` a todo lo que está bajo el pliegue.

\`\`\`html
<picture>
  <source srcset="/img/hero.avif" type="image/avif">
  <source srcset="/img/hero.webp" type="image/webp">
  <img src="/img/hero.jpg" alt="Sala de exposiciones" loading="lazy">
</picture>
\`\`\`

## Pendiente

Las fotos de los vendedores siguen en su tamaño original porque vienen del módulo de intranet, que todavía no genera miniaturas. No se probó en Safari.`;

/** Termina con una pregunta. */
export const REPORT_QUESTION = `Encontré el origen del error: la caché de sesiones se invalida cuando cambia el idioma, pero el cierre de sesión no limpia la copia local. Por eso el usuario seguía "conectado" después de salir.

Hay dos formas de arreglarlo:

1. Limpiar la copia local en el cierre de sesión (cambio chico, 6 líneas).
2. Mover toda la sesión a una cookie httpOnly (cambio grande, toca el login y el middleware).

La primera resuelve el problema de hoy y la segunda además mejora la seguridad, pero es más riesgosa para hacerla ahora. ¿Cuál prefieres que haga?`;

/** Lista numerada con rutas largas, enlaces y subniveles. */
export const REPORT_NUMBERED_PATHS = `Terminé la revisión del módulo de vendedores y dejé los cambios en la rama \`fase-2b\`. Estos son los pasos que seguí y lo que encontré.

1. Revisé \`C:\\Users\\tu-usuario\\developer\\otro-sistema\\packages\\vendedores\\src\\ficha\\render-ficha.tsx\` y encontré que el nombre se cortaba a los 24 caracteres.
2. Corregí el corte en [la guía de estilo](https://docs.example.com/guia/estilo) y lo dejé en 38 para que coincida con el resto.
   - Ajusté también el espaciado vertical de la ficha.
   - Agregué una prueba que cubre nombres con tilde.
3. Actualicé la documentación en \`docs/vendedores.md\`.
4. Corrí el linter y el verificador de tipos sin errores.

No toqué el módulo de horarios.`;

/** Prosa en un solo párrafo largo (sin listas ni títulos). */
export const REPORT_PROSE = `El servidor de desarrollo ya arranca sin errores. El problema era una variable de entorno que el script de arranque leía antes de cargar el archivo \`.env\`, así que \`DATABASE_URL\` llegaba vacía y la conexión fallaba en silencio. Moví la carga del archivo al primer renglón del script y agregué una verificación que detiene el arranque con un mensaje claro si falta alguna variable obligatoria. También limpié los registros de la consola para que el error real no quede enterrado entre avisos de recarga. Probé el arranque limpio tres veces seguidas y las pruebas de integración pasan. Todavía no revisé el despliegue en producción, porque ahí las variables vienen de otro lugar y no quise suponer nada sobre cómo se cargan allá.`;

/** Mensaje corto: ya cabe en una pantalla. */
export const REPORT_SHORT = `Listo, el botón de descarga ya apunta al archivo nuevo.

- Cambié el enlace en \`index.html\`.
- Subí el \`.3dsx\` a la carpeta pública.`;

/** Solo una tabla y un bloque de código, sin prosa. */
export const REPORT_ONLY_TABLE = `| Archivo | Líneas | Estado |
| --- | --- | --- |
| a.ts | 120 | ok |
| b.ts | 88 | ok |
| c.ts | 301 | revisar |
| d.ts | 45 | ok |
| e.ts | 17 | ok |
| f.ts | 64 | ok |
| g.ts | 99 | ok |
| h.ts | 12 | ok |
| i.ts | 210 | ok |
| j.ts | 33 | ok |
| k.ts | 150 | ok |
| l.ts | 71 | ok |
| m.ts | 56 | ok |
| n.ts | 408 | ok |`;

/** Informe con secciones en negrita, una "Sin probar" y un párrafo que abre con negrita. */
export const REPORT_SECTIONS = `El paso 4 ya está programado y pasa todas las pruebas en el PC, pero todavía no se probó en la nube ni con una cuenta real de cliente.

**Qué quedó hecho**
- Hay 5 commits nuevos en la rama \`fase-2b\`.
- Pasan las 857 pruebas de JS y las del servidor en Go, y la revisión de tipos sale limpia.
- La app compila sin advertencias y pesa 310 108 bytes.

**Cómo se usa en la terminal**
- Cada filtro trae sus opciones; la recomendada lleva una estrella. Al final de la lista siempre están "Otra…" y "Exportar todo".
- La descripción de la opción marcada se ve en un panel debajo de la lista.
- Escape vuelve al filtro anterior y nunca exporta nada.

**Sin probar**
- No se ha comprobado que Excel acepte la hoja que genera el exportador; solo se probó con datos simulados.
- Tampoco se ha visto en la terminal el teclado de "Otra…" ni cómo se ve la tarjeta.

**Para probarlo** hay que agregar la variable a tu configuración local. Después reinicio el servidor y te mando el enlace.`;
