# Seguridad

## Cómo reportar un problema

Usa el **reporte privado de vulnerabilidades de GitHub**: en este repositorio, pestaña **Security** → **Report a vulnerability**
(<https://github.com/alonnnzo/cronio/security/advisories/new>). No hay correo de contacto: por favor no abras un _issue_ público con
los detalles de una vulnerabilidad.

Incluye la versión de Cronio, cómo reproducirlo y qué impacto crees que tiene. Es un proyecto personal: respondo en cuanto puedo,
sin plazos garantizados.

## Versiones con soporte

Solo la **última versión publicada** en los [Releases](https://github.com/alonnnzo/cronio/releases). Las anteriores no reciben
correcciones: actualiza.

## Qué protege Cronio

- La API local del puente escucha solo en `127.0.0.1`, rechaza peticiones con `Origin` de navegador o con un `Host` que no sea local, y
  las rutas que deciden o cambian algo exigen un token local que se regenera en cada arranque.
- La consola entra solo con un código de emparejamiento de un solo uso (80 bits, vale 5 minutos, con límite de ritmo). Cada consola
  tiene su propia clave, y el tráfico entre la consola y el puente va cifrado (ChaCha20) y autenticado (_encrypt-then-MAC_).
- Una consola que se conecta con el protocolo anterior (sin cifrado) solo puede actualizarse: no recibe contenido de tus sesiones ni
  puede aprobar nada.
- La actualización de la app de la consola verifica el tamaño y el SHA-256 del `.cia`, que llegan por el canal cifrado.
- Cronio no usa servidores propios. Solo consulta GitHub si activas las actualizaciones automáticas.
- Un permiso nunca se aprueba solo: si el puente no responde, o algo falla, Claude Code pregunta en el PC.

## Modelo de amenazas y límites conocidos

Lo que **no** cubre, dicho sin adornos:

- **Procesos del mismo usuario en el PC.** El token local y las claves de las consolas están en archivos de tu perfil
  (`%APPDATA%\agent-companion\`). Cualquier programa que corra con tu usuario puede leerlos y hablar con el puente, y también puede
  editar `~/.claude/settings.json` por su cuenta. El token protege de páginas web, de otros usuarios del PC y de procesos que no
  conocen esa carpeta, no de código que ya corre como tú.
- **La primera instalación por QR va por HTTP en la red local.** El `.cia` se descarga sin cifrar desde el PC (puerto `33337`) a través
  de FBI. Quien esté en tu red durante ese momento podría cambiarlo. Haz la instalación inicial en una red de confianza. Después, las
  actualizaciones de la app que hace la propia consola sí se verifican (tamaño y SHA-256 por el canal cifrado).
- **Una 3DS perdida o robada.** Quien tenga la consola (y su tarjeta SD) tiene la clave de esa consola y puede conectarse al puente
  mientras esté en tu red. Para cortarlo, **olvídala**: en Ajustes del programa → _Consolas emparejadas_ → _Olvidar_, o con
  `npm run companion -- devices forget <id>`. Se borra su clave y se corta su conexión; para volver a usarla hay que emparejarla de
  nuevo con un código. Si la consola estaba conectada a otras redes, cambia también lo que corresponda en ellas.
- **El instalador no tiene firma de código.** Windows SmartScreen avisará de editor desconocido. Descárgalo solo desde los Releases
  oficiales y compara su SHA-256 con el de las notas de la versión. Eso protege de un archivo cambiado en el camino, no de una cuenta de
  GitHub comprometida.
- **Confianza en la cuenta de GitHub.** Si activas las actualizaciones por GitHub, el programa confía en lo que publique el dueño de este
  repositorio: si esa cuenta se viera comprometida, también lo estaría esa vía de actualización. Por eso el valor por defecto es
  «ninguno» y es tu decisión activarlo.
- **Consolas con versión 0.2.x.** Las consolas que todavía traen la app 0.2.x se actualizan una vez **sin verificación criptográfica**:
  esa versión habla sin cifrado y no comprueba el SHA-256. Quien esté en tu red en esa actualización podría ofrecerles otro archivo.
  Actualízalas en una red de confianza.
- **Carpeta local como origen de actualizaciones.** Quien pueda escribir en esa carpeta decide qué se instala. Úsala solo con carpetas
  que controles tú.
- **Red local.** El puente escucha en tu red local (`33334/TCP`); la regla del firewall lo limita a redes privadas y a la subred local,
  pero en una red compartida con desconocidos cualquiera puede _intentar_ conectarse (necesita un código vigente para emparejarse). No
  uses Cronio en redes públicas.
- **Lo que el agente escribe en la consola.** Las instrucciones que mandas desde la 3DS y las respuestas a preguntas llegan a Claude
  Code como si las escribieras tú.

Si ves algo que no encaja con esta descripción, repórtalo por el canal de arriba.
