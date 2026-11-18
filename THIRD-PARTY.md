# Licencias de terceros

Cronio es software libre bajo la **GNU GPL v3 o posterior** (ver `LICENSE`). Usa y distribuye las siguientes piezas de terceros, cada una con su propia licencia.

## Fuentes tipográficas (SIL Open Font License 1.1)

Van incluidas, como archivos `.woff2`, en el programa del PC (`packages/installer/renderer/fonts/`) y en la página (`site/fonts/`). El texto de cada licencia está junto a los archivos (`LICENSE-*.txt`).

| Fuente | Autores | Licencia |
| --- | --- | --- |
| Dela Gothic One | The Dela Gothic Project Authors (<https://github.com/syakuzen/DelaGothic>) | OFL 1.1 |
| M PLUS Rounded 1c | The Rounded M+ Project Authors | OFL 1.1 |

## Dependencias de JavaScript (MIT)

| Paquete | Para qué se usa | Licencia |
| --- | --- | --- |
| [Electron](https://www.electronjs.org/) | Ventana del programa del PC | MIT |
| [electron-updater](https://www.electron.build/auto-update) | Actualizaciones desde GitHub (solo si el usuario las activa) | MIT |
| [ws](https://github.com/websockets/ws) | WebSocket del puente | MIT |
| [zod](https://zod.dev/) | Validación de los mensajes del protocolo | MIT |
| [qrcode](https://github.com/soldair/node-qrcode) | Código QR para instalar el cliente en la consola | MIT |

Las herramientas de desarrollo (TypeScript, Vitest, tsx, electron-builder, etc.) no se distribuyen con el programa.
Quien use `npm install` obtiene además las dependencias indirectas de estos paquetes, cada una con la licencia que declara en su `package.json`.

## Cliente de la 3DS

| Pieza | Licencia |
| --- | --- |
| [libctru](https://github.com/devkitPro/libctru) | zlib |
| [citro2d](https://github.com/devkitPro/citro2d) | zlib |
| [citro3d](https://github.com/devkitPro/citro3d) | zlib |

Se enlazan al compilar el cliente con devkitARM (devkitPro). Cronio **no distribuye** firmware de la consola: el firmware de sonido se extrae de la propia 3DS del usuario (ver `README.md`).

## Marcas

Nintendo 3DS es una marca de Nintendo. Claude es una marca de Anthropic. Cronio es un proyecto independiente, sin afiliación ni respaldo de ninguna de las dos.
