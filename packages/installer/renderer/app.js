// Interfaz de Cronio. Sin frameworks. Dos pantallas de uso diario (Inicio y Ajustes) y cinco pasos de configuración.
// Todo lo que toca el PC pasa por window.companion (preload), que solo ofrece funciones con nombre.
"use strict";

const api = window.companion;

/** Crea un elemento. `hijos` acepta textos y elementos; los textos nunca se interpretan como HTML. */
function h(etiqueta, atributos, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos || {})) {
    if (valor === undefined || valor === false) continue;
    if (clave === "class") el.className = valor;
    else if (clave.startsWith("on")) el.addEventListener(clave.slice(2), valor);
    else el.setAttribute(clave, valor === true ? "" : valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo.nodeType ? hijo : document.createTextNode(String(hijo)));
  }
  return el;
}

const bloque = (titulo, ...contenido) => h("div", { class: "bloque" }, h("h3", {}, titulo), ...contenido);

/** Las tres explicaciones de cada paso, juntas en un plegable: cerrado si el paso ya está listo, abierto si no. */
function plegableInfo(listo, que, porque, comoSaber) {
  return h(
    "details",
    { class: "plegable", open: !listo },
    h("summary", {}, "¿Qué hace este paso?"),
    h("div", { class: "interior" }, h("div", { class: "bloques" }, bloque("Qué hace", que), bloque("Por qué hace falta", porque), bloque("Cómo sé que quedó bien", comoSaber))),
  );
}

function resultado(tipo, ...texto) {
  const marca = { ok: "✓", mal: "✗", aviso: "!" }[tipo] || "•";
  return h("div", { class: `resultado ${tipo}` }, h("span", { class: "marca-r" }, marca), h("div", {}, ...texto));
}

/** Chip de estado: verde ✓, ámbar !, rojo ✗ (o gris sin marca). */
function chip(tipo, texto) {
  const marca = { ok: "✓ ", mal: "✗ ", aviso: "! " }[tipo] || "";
  return h("span", { class: `chip ${tipo}` }, `${marca}${texto}`);
}

function mostrar(contenedor, nodo) {
  contenedor.replaceChildren(nodo || "");
}

/** Avisos de redes con perfil Público (Windows bloquea ahí a la 3DS), con un botón que abre Configuración. Nunca cambia el perfil. */
async function avisosPublica(zona, direcciones, elegida) {
  const avisos = await api.redAvisos(direcciones, elegida);
  zona.replaceChildren(...avisos.map((a) => avisoRed(a)));
}

function avisoRed(a) {
  return resultado("aviso", h("div", {}, a.texto), h("div", { class: "fila" }, h("button", { class: "boton", onclick: () => api.redAbrirAjustes(a.tipo) }, "Abrir Configuración de red")));
}

/** Texto de perfil para mostrar junto a una IP. */
function nombrePerfil(perfil) {
  return perfil === "publica" ? "Pública" : perfil === "privada" ? "Privada" : perfil === "dominio" ? "Dominio" : "";
}

/** Deshabilita un botón mientras corre una tarea. */
async function ocupado(boton, texto, tarea) {
  const original = boton.textContent;
  boton.disabled = true;
  boton.textContent = texto;
  try {
    return await tarea();
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
}

// ---------- estado compartido ----------

const listos = new Set();
let estadoPuente = { activo: false, propio: false };
/** Lo que se sabe del PC (se lee en segundo plano) y alimenta Inicio, Ajustes y los pasos. */
const datos = {
  hooks: null, // { total, presentes, ok, error }
  carpetas: null, // { modo, n, estado }
  firewall: null, // { ok }
  avisosRed: [],
};
let firewallOk = false;
let vistaActual = "inicio"; // "inicio" | "ajustes" | "paso-N"
let eligioVista = false; // el usuario ya eligió una pantalla: no se le cambia sola
let vista = null; // { limpiar, actualizarPuente, actualizarActualizaciones, actualizarDatos }

function marcar(n, ok) {
  ok = Boolean(ok);
  if (listos.has(n) === ok) return; // sin cambios: no se repinta (evita parpadeos y clics perdidos)
  if (ok) listos.add(n);
  else listos.delete(n);
  pintarLateral();
  for (const el of document.querySelectorAll("[data-chip-paso]")) pintarChipPaso(el);
}

function pintarChipPaso(el) {
  const listo = listos.has(Number(el.getAttribute("data-chip-paso")));
  el.className = `chip ${listo ? "ok" : "aviso"}`;
  el.textContent = listo ? "✓ Listo" : "! Falta";
}

const PASOS = [];

// ---------- barra lateral ----------

function pintarLateral() {
  document.getElementById("principal").replaceChildren(
    itemLateral("inicio", "⌂", "Inicio"),
    itemLateral("ajustes", "⚙", "Ajustes"),
  );
  document.getElementById("pasos").replaceChildren(
    ...PASOS.map((p, i) => {
      const n = i + 1;
      const activo = vistaActual === `paso-${n}`;
      return h(
        "button",
        {
          class: `paso${activo ? " activo" : ""}${listos.has(n) ? " listo" : ""}`,
          "data-paso": String(n),
          "aria-current": activo ? "page" : undefined,
          onclick: () => irA(`paso-${n}`, { manual: true }),
        },
        h("span", { class: "num" }, listos.has(n) ? "✓" : String(n)),
        h("span", {}, h("span", { class: "nombre" }, p.nombre), h("span", { class: "sub" }, p.sub)),
      );
    }),
  );
}

function itemLateral(clave, icono, nombre) {
  const activo = vistaActual === clave;
  return h(
    "button",
    { class: `paso icono${activo ? " activo" : ""}`, "data-vista": clave, "aria-current": activo ? "page" : undefined, onclick: () => irA(clave, { manual: true }) },
    h("span", { class: "num", "aria-hidden": "true" }, icono),
    h("span", {}, h("span", { class: "nombre" }, nombre)),
  );
}

function pintarPuente() {
  const luz = document.getElementById("luz-puente");
  const texto = document.getElementById("texto-puente");
  luz.className = `luz ${estadoPuente.activo ? "ok" : "mal"}`;
  if (!estadoPuente.activo) texto.textContent = "Puente apagado";
  else if (estadoPuente.salud && estadoPuente.salud.console) texto.textContent = "Puente en marcha · 3DS conectada";
  else texto.textContent = "Puente en marcha · sin 3DS conectada";
}

/** Versión del programa, siempre a la vista; si hay una nueva, con enlace a Inicio (donde está el botón Actualizar). */
function pintarVersion() {
  const p = document.getElementById("version-programa");
  if (!p) return;
  const e = estadoAct;
  if (!e) {
    p.replaceChildren();
    return;
  }
  const hayNueva = e.version && (e.fase === "nueva" || e.fase === "descargando" || e.fase === "descargada");
  p.replaceChildren(
    `Cronio ${e.instalada}`,
    ...(hayNueva
      ? [
          " · ",
          h(
            "a",
            {
              href: "#",
              onclick: (ev) => {
                ev.preventDefault();
                irA("inicio", { manual: true });
              },
            },
            `hay una nueva (${e.version})`,
          ),
        ]
      : []),
  );
}

async function refrescarPuente() {
  if (document.hidden) return;
  try {
    estadoPuente = await api.puenteEstado();
  } catch {
    estadoPuente = { activo: false, propio: false };
  }
  pintarPuente();
  marcar(5, conectada());
  marcar(3, firewallOk && estadoPuente.activo);
  if (vista && vista.actualizarPuente) vista.actualizarPuente();
}

const conectada = () => Boolean(estadoPuente.activo && estadoPuente.salud && estadoPuente.salud.console);

// ---------- navegación ----------

async function irA(clave, opciones) {
  if (opciones && opciones.manual) eligioVista = true;
  if (vista && vista.limpiar) await vista.limpiar();
  vista = null;
  vistaActual = clave;
  const cont = document.getElementById("contenido");
  cont.replaceChildren();
  const dibujar = clave === "inicio" ? dibujarInicio : clave === "ajustes" ? dibujarAjustes : PASOS[Number(clave.slice(5)) - 1].dibujar;
  vista = await dibujar(cont);
  cont.scrollTop = 0;
  if (clave === "inicio") leerRed().then(() => vista && vista.actualizarDatos && vista.actualizarDatos());
  pintarLateral();
  if (opciones && opciones.seccion) {
    const sec = document.getElementById(opciones.seccion);
    if (sec) sec.scrollIntoView({ block: "start" });
  }
}

const irAPaso = (i, opciones) => irA(`paso-${i + 1}`, { manual: true, ...opciones });

function navegacion(i) {
  const fila = h("div", { class: "fila" });
  if (i > 0) fila.append(h("button", { class: "boton", onclick: () => irAPaso(i - 1) }, "← Anterior"));
  if (i < PASOS.length - 1) fila.append(h("button", { class: "boton", onclick: () => irAPaso(i + 1) }, "Siguiente →"));
  return h("div", { class: "accion" }, fila);
}

/** Título del paso, su estado (chip) y una línea que lo resume. */
function cabecera(n, titulo, resumen) {
  const c = h("span", { "data-chip-paso": String(n) });
  pintarChipPaso(c);
  return h("div", { class: "cabecera" }, h("div", { class: "cabecera-fila" }, h("h2", {}, titulo), c), h("p", { class: "lead" }, resumen));
}

// ---------- acciones del puente (las usan Inicio y el paso 3) ----------

async function accionIniciar(boton) {
  const r = await ocupado(boton, "Iniciando…", () => api.puenteIniciar());
  estadoPuente = r.estado;
  pintarPuente();
  if (r.resultado === "ya-corria") return resultado("aviso", "Ya estaba corriendo: no lancé otro.");
  if (r.resultado === "puente-viejo") return resultado("aviso", "Hay un puente de otra versión y no se dejó cerrar. Hay que detenerlo desde el paso 3.");
  if (r.resultado === "error") return resultado("mal", "No arrancó. Abre el registro para ver el motivo.");
  return null;
}

async function accionDetener(boton) {
  const r = await ocupado(boton, "Deteniendo…", () => api.puenteDetener());
  estadoPuente = r.estado;
  pintarPuente();
  return r.detenido ? null : resultado("aviso", "Solo puedo detener el puente que inicié yo. El que ya estaba corriendo se cierra desde su propia ventana.");
}

// ---------- actualizaciones del programa ----------

let estadoAct = null;
let accionAct = false; // una acción de actualización en curso (evita pulsaciones dobles)

/** Texto del estado y, si hay, el botón de la acción que sigue. */
function describirActualizacion(e) {
  const nueva = e.version ? ` (${e.version})` : "";
  switch (e.fase) {
    case "buscando": return { tipo: "aviso", texto: "Buscando…" };
    case "al-dia": return { tipo: "ok", texto: "Al día." };
    case "nueva": return { tipo: "aviso", texto: `Hay una versión nueva${nueva}.`, boton: e.origen === "github" ? "Descargar" : "Actualizar", accion: "actualizar" };
    case "descargando": return { tipo: "aviso", texto: `Descargando… ${e.progreso ?? 0} %` };
    case "descargada": return { tipo: "ok", texto: `La versión${nueva} ya está descargada.`, boton: "Reiniciar y actualizar", accion: "reiniciar" };
    case "instalando": return { tipo: "aviso", texto: "Instalando… Cronio se va a cerrar y a abrir de nuevo." };
    case "error": return { tipo: "mal", texto: `Error: ${e.error || "no se pudo."}` };
    case "sin-publicar": return { tipo: "aviso", texto: "Todavía no hay versiones publicadas." };
    default: return { tipo: "aviso", texto: e.origen === "ninguno" ? "No se busca nada: el origen es «Ninguno»." : "Todavía no se ha buscado." };
  }
}

/** Aviso que tapa toda la ventana mientras se prepara la actualización (la app se cierra y vuelve a abrirse sola). */
function mostrarActualizando(version) {
  const pasos = h("ul", { class: "actualizando-pasos", "aria-live": "polite" });
  const titulo = h("h2", {}, version ? `Actualizando Cronio a la ${version}` : "Actualizando Cronio");
  const cuerpo = h("div", { class: "actualizando-cuerpo" }, h("div", { class: "barra-indeterminada", role: "progressbar", "aria-label": "Actualizando" }, h("i", {})), pasos);
  const aviso = h("p", { class: "nota" }, "Cronio se cerrará; verás la barra de instalación y se abrirá solo al terminar.");
  const capa = h(
    "div",
    { class: "actualizando", role: "alertdialog", "aria-modal": "true", "aria-label": "Actualizando Cronio" },
    h("div", { class: "actualizando-caja" }, h("h1", { class: "palabra-cara", "aria-label": "Cronio" }, h("span", { "aria-hidden": "true" }, h("span", {}, "CR"), h("i", {}), "NI", h("i", {}))), titulo, cuerpo, aviso),
  );
  document.body.append(capa);
  const pintarPasos = (lista) => {
    pasos.replaceChildren(...lista.map((t, i) => h("li", { class: i === lista.length - 1 ? "en-curso" : "hecho" }, t)));
  };
  pintarPasos(["Preparando la actualización…"]);
  return {
    pasos: pintarPasos,
    error(mensaje, alVolver) {
      titulo.textContent = "No se pudo actualizar";
      cuerpo.replaceChildren(h("div", { class: "resultado mal" }, h("span", { class: "marca-r" }, "✗"), h("div", {}, mensaje || "Algo salió mal.")));
      aviso.replaceChildren(h("button", { class: "boton principal", onclick: () => { capa.remove(); alVolver(); } }, "Volver"));
      aviso.className = "";
      aviso.querySelector("button").focus();
    },
  };
}

async function accionActualizacion(accion) {
  if (accionAct) return;
  accionAct = true;
  // en carpeta local «Actualizar» cierra la app para instalar; con GitHub lo que cierra es «Reiniciar y actualizar»
  const cierra = accion === "reiniciar" || (accion === "actualizar" && estadoAct && estadoAct.origen === "local");
  const aviso = cierra ? mostrarActualizando(estadoAct && estadoAct.version) : null;
  let reloj = null;
  if (aviso) {
    // los pasos reales los lleva el proceso principal; se leen mientras la llamada sigue en curso
    reloj = setInterval(async () => {
      try {
        const e = await api.actualizacionEstado();
        if (e && e.fase === "instalando" && e.pasos && e.pasos.length) aviso.pasos(e.pasos);
      } catch { /* el programa se está cerrando */ }
    }, 250);
  }
  try {
    estadoAct = accion === "reiniciar" ? await api.actualizacionReiniciar() : await api.actualizacionActualizar();
  } catch (err) {
    estadoAct = { ...(estadoAct || {}), fase: "error", error: err && err.message ? err.message : String(err) };
  } finally {
    accionAct = false;
    if (reloj) clearInterval(reloj);
  }
  if (aviso) {
    if (estadoAct.fase === "error") {
      aviso.error(estadoAct.error, () => refrescarActualizaciones());
    } else if (estadoAct.pasos && estadoAct.pasos.length) {
      aviso.pasos(estadoAct.pasos);
    }
  }
  pintarFranja();
  pintarVersion();
  if (vista && vista.actualizarActualizaciones) vista.actualizarActualizaciones();
}

/** Franja discreta arriba, en todas las pantallas, cuando hay una versión nueva. */
function pintarFranja() {
  const franja = document.getElementById("franja");
  const e = estadoAct;
  const d = e && (e.fase === "nueva" || e.fase === "descargada" || e.fase === "descargando") ? describirActualizacion(e) : null;
  if (!d) {
    franja.hidden = true;
    franja.replaceChildren();
    return;
  }
  franja.hidden = false;
  franja.replaceChildren(
    h("span", {}, e.fase === "descargando" ? `Descargando la versión nueva de Cronio (${e.version}) · ${e.progreso ?? 0} %` : `Hay una versión nueva de Cronio (${e.version})`),
    d.boton ? h("button", { class: "boton chico", onclick: () => accionActualizacion(d.accion) }, d.boton) : null,
  );
}

async function refrescarActualizaciones() {
  if (document.hidden) return;
  try {
    estadoAct = await api.actualizacionEstado();
  } catch {
    return;
  }
  pintarFranja();
  pintarVersion();
  if (vista && vista.actualizarActualizaciones) vista.actualizarActualizaciones();
}

/** Origen, carpeta y «Buscar ahora» (en Ajustes). Solo se redibuja si algo cambió, para no cerrar el selector abierto. */
function pintarActualizaciones(zona, forzar) {
  const e = estadoAct;
  if (!e) {
    zona.replaceChildren(h("p", { class: "nota" }, "Leyendo el estado…"));
    return;
  }
  const clave = JSON.stringify(e);
  if (!forzar && zona.dataset.clave === clave) return;
  zona.dataset.clave = clave;
  const d = describirActualizacion(e);
  const repintar = () => {
    pintarFranja();
    pintarVersion();
    pintarActualizaciones(zona, true);
  };
  const selector = h(
    "select",
    { id: "origen-actualizaciones", "aria-label": "Origen de las actualizaciones" },
    h("option", { value: "ninguno" }, "Ninguno"),
    h("option", { value: "local" }, "Carpeta local"),
    h("option", { value: "github" }, "GitHub (consulta internet)"),
  );
  selector.value = e.origen;
  selector.addEventListener("change", async () => {
    estadoAct = await api.actualizacionOrigen(selector.value);
    repintar();
  });
  const ocupadaAhora = ["buscando", "descargando", "instalando"].includes(e.fase);
  // replaceChildren no salta los null como h(): se pasan por un div y se toman sus hijos
  zona.replaceChildren(...h("div", { class: "apilado" },
    h("p", { class: "nota" }, `Versión instalada: ${e.instalada}.`),
    h("div", { class: "fila" }, h("label", { for: "origen-actualizaciones" }, "Buscar en:"), selector),
    e.origen === "local"
      ? h(
          "div",
          { class: "fila" },
          h("button", { class: "boton", onclick: async () => { estadoAct = await api.actualizacionElegirCarpeta(); repintar(); } }, "Elegir carpeta…"),
          h("span", { class: "nota ruta" }, e.carpeta ? e.carpeta : "Todavía no elegiste una carpeta."),
        )
      : null,
    e.origen === "local" ? h("p", { class: "nota" }, "Solo carpetas que controles tú: quien pueda escribir en ella decide qué se instala.") : null,
    e.origen === "local" && e.porDefecto && e.carpeta ? h("p", { class: "nota" }, "Esta carpeta se eligió sola: es donde se construyó el programa.") : null,
    e.origen === "github" ? h("p", { class: "nota" }, "Solo pregunta si hay una versión nueva; no envía datos tuyos.") : null,
    e.origen !== "ninguno" ? resultado(d.tipo, d.texto) : h("p", { class: "nota" }, d.texto),
    h(
      "div",
      { class: "fila" },
      e.origen !== "ninguno"
        ? h(
            "button",
            {
              class: `boton${d.boton ? "" : " principal"}`,
              disabled: ocupadaAhora,
              onclick: async (ev) => {
                estadoAct = await ocupado(ev.target, "Buscando…", () => api.actualizacionBuscar());
                repintar();
              },
            },
            "Buscar ahora",
          )
        : null,
      d.boton ? h("button", { class: "boton principal", onclick: () => accionActualizacion(d.accion) }, d.boton) : null,
    ),
    !e.empaquetada ? h("p", { class: "nota" }, "Esta es la versión de desarrollo: puede buscar, pero solo la app instalada se actualiza.") : null,
    h("p", { class: "nota" }, "Busca sola al abrir y cada 6 horas. Nunca actualiza sin que lo pidas."),
  ).childNodes);
}

// ---------- lo que se sabe del PC ----------

function registrarHooks(v) {
  if (!v || v.error || !v.estado) {
    datos.hooks = { total: v && v.eventos ? v.eventos.length : 0, presentes: 0, ok: false, error: (v && v.error) || "No pude leer el archivo de Claude Code." };
  } else {
    datos.hooks = { total: v.eventos.length, presentes: v.estado.presentes.length, ok: Boolean(v.estado.ok), error: null, scriptFalta: v.estado.scriptsFaltantes.length > 0, desactualizada: Array.isArray(v.estado.desactualizados) && v.estado.desactualizados.length > 0 };
  }
  marcar(2, datos.hooks.ok);
}

function registrarCarpetas(c) {
  datos.carpetas = { modo: c.modo, n: c.carpetas.length, estado: c.estado };
}

function textoCarpetas(c) {
  if (!c) return "";
  if (c.estado === "corrupto") return "El archivo de carpetas está dañado: ahora no se activa en ninguna.";
  if (c.modo === "todas") return "En todas las carpetas";
  if (c.n === 0) return "En ninguna carpeta todavía";
  return c.n === 1 ? "En 1 carpeta" : `En ${c.n} carpetas`;
}

function textoAvisosHooks(hk) {
  if (hk.error) return hk.error;
  if (hk.desactualizada) return "El archivo de permisos es de una versión anterior: hasta que lo actualices, los permisos se preguntan en el PC";
  if (hk.ok) return `${hk.presentes} de ${hk.total} avisos conectados`;
  if (hk.presentes === 0) return "Todavía no están conectados";
  if (hk.scriptFalta) return "Falta un archivo del aviso de permisos";
  return `${hk.presentes} de ${hk.total} avisos conectados`;
}

async function leerNode() {
  const r = await api.comprobarNode();
  marcar(1, r.ok);
  return r;
}

function leerYaInstalada() {
  try {
    return localStorage.getItem("companion-3ds-instalada") === "1";
  } catch {
    return false;
  }
}

async function leerFirewall() {
  const r = await api.firewallEstado();
  firewallOk = Boolean(r.ok);
  datos.firewall = { ok: firewallOk };
  marcar(3, firewallOk && estadoPuente.activo);
  return r;
}

async function leerRed() {
  try {
    datos.avisosRed = await api.redAvisos(await api.redDirecciones());
  } catch {
    datos.avisosRed = [];
  }
}

/**
 * Lo que alimenta las ✓ y las tarjetas de Inicio. Rápido: sin la red (PowerShell tarda).
 * Con `soloLoBarato` (las vueltas de fondo) el firewall (netsh) y Node (node --version) solo se miran en las pantallas que los usan.
 */
async function leerBasicos(soloLoBarato = false) {
  const enInicio = vistaActual === "inicio";
  const resultados = await Promise.allSettled([
    !soloLoBarato || enInicio || vistaActual === "paso-1" ? leerNode() : null,
    api.hooksVista().then(registrarHooks),
    api.hooksCarpetasVista().then(registrarCarpetas),
    !soloLoBarato || enInicio || vistaActual === "paso-3" ? leerFirewall() : null,
  ]);
  marcar(4, leerYaInstalada());
  marcar(5, conectada());
  return resultados;
}

async function verificarFondo() {
  if (document.hidden) return; // ventana minimizada u oculta: no se mira nada
  try {
    await leerBasicos(true);
    // la red (PowerShell) no se consulta de fondo: se lee al abrir y al entrar a Inicio, y el paso 4 la lee por su cuenta
  } catch {
    /* se reintenta en la próxima vuelta */
  }
  if (vista && vista.actualizarDatos) vista.actualizarDatos();
}

// ---------- pantalla: Inicio ----------

let mensajePuente = null; // mensaje de la última acción de la tarjeta del puente
let versionMensaje = 0;

function tarjeta(titulo, chipNodo, ...cuerpo) {
  return h("section", { class: "bloque tarjeta" }, h("div", { class: "tarjeta-cab" }, h("h3", {}, titulo), chipNodo), ...cuerpo);
}

function tarjetaPuente() {
  const s = estadoPuente;
  const problemas = [];
  let tipo;
  let texto;
  let frase;
  if (!s.activo) {
    tipo = "mal";
    texto = "Detenido";
    frase = s.error || "Sin el puente, Claude no le puede avisar a tu 3DS.";
  } else if (s.viejo) {
    tipo = "aviso";
    texto = "Revisar";
    frase = "Hay un puente de otra versión corriendo.";
    problemas.push(
      resultado(
        "aviso",
        h("div", {}, `Es ${s.viejo.version ? `el ${s.viejo.version}` : "uno viejo"} y la 3DS no recibe los avisos nuevos mientras siga ahí.`),
        h("div", { class: "fila" }, h("button", { class: "boton", onclick: () => irAPaso(2) }, "Arreglarlo en el paso 3")),
      ),
    );
  } else {
    tipo = "ok";
    texto = "En marcha";
    frase = s.propio ? "Cronio lo inició y lo mantiene encendido." : "Ya estaba encendido; Cronio lo usa tal cual.";
  }
  if (s.activo && datos.firewall && !datos.firewall.ok) {
    problemas.push(
      resultado(
        "aviso",
        h("div", {}, "Windows bloquea a la 3DS: falta el permiso del firewall."),
        h("div", { class: "fila" }, h("button", { class: "boton", onclick: () => irAPaso(2) }, "Darlo en el paso 3")),
      ),
    );
  }
  for (const a of datos.avisosRed) problemas.push(avisoRed(a));
  if (problemas.length && tipo === "ok") {
    tipo = "aviso";
    texto = "Revisar";
  }
  const acciones = h("div", { class: "fila" });
  if (!s.activo) {
    acciones.append(
      h("button", { class: "boton principal", onclick: async (e) => { mensajePuente = await accionIniciar(e.target); versionMensaje++; refrescarInicio(); } }, "Iniciar"),
    );
  } else if (s.propio && !s.viejo) {
    acciones.append(h("button", { class: "boton", onclick: async (e) => { mensajePuente = await accionDetener(e.target); versionMensaje++; refrescarInicio(); } }, "Detener"));
  }
  acciones.append(h("button", { class: "boton enlace", onclick: () => api.puenteAbrirLog() }, "Ver registro"));
  return tarjeta("Puente", chip(tipo, texto), h("p", {}, frase), ...problemas, mensajePuente, acciones);
}

function tarjeta3ds() {
  const s = estadoPuente;
  const salud = s.salud || {};
  let chipNodo;
  let frase;
  if (conectada()) {
    chipNodo = chip("ok", "Conectada");
    frase = salud.consoleVersion ? `Tu 3DS está conectada. App de la consola: ${salud.consoleVersion}.` : "Tu 3DS está conectada.";
  } else {
    chipNodo = chip("aviso", "Sin conexión");
    frase = s.activo ? "Abre Cronio en la 3DS: se conecta sola." : "Primero enciende el puente.";
  }
  return tarjeta(
    "3DS",
    chipNodo,
    h("p", {}, frase),
    h(
      "div",
      { class: "fila" },
      h("button", { class: "boton principal", onclick: () => irAPaso(3) }, "Instalar o reinstalar"),
      conectada() ? null : h("button", { class: "boton enlace", onclick: () => irAPaso(4) }, "Emparejar"),
    ),
  );
}

function tarjetaClaude() {
  const hk = datos.hooks;
  const c = datos.carpetas;
  if (!hk) return tarjeta("Claude Code", chip("", "Leyendo…"), h("p", { class: "descripcion" }, "Mirando el archivo de Claude Code."));
  let tipo = hk.ok ? "ok" : hk.error ? "mal" : "aviso";
  const nodos = [h("p", {}, hk.ok ? `✓ ${textoAvisosHooks(hk)}` : textoAvisosHooks(hk))];
  if (c) {
    nodos.push(h("p", { class: "descripcion" }, c.estado === "corrupto" ? textoCarpetas(c) : `Se activa ${textoCarpetas(c).replace(/^En /, "en ")}.`));
    if (hk.ok && (c.estado === "corrupto" || (c.modo === "elegidas" && c.n === 0))) tipo = "aviso";
  }
  return tarjeta(
    "Claude Code",
    chip(tipo, tipo === "ok" ? "Conectado" : tipo === "mal" ? "Con error" : "Falta algo"),
    ...nodos,
    h("div", { class: "fila" }, h("button", { class: hk.ok ? "boton" : "boton principal", onclick: () => irAPaso(1) }, "Configurar")),
  );
}

function tarjetaActualizaciones() {
  const e = estadoAct;
  if (!e) return tarjeta("Actualizaciones", chip("", "Leyendo…"), h("p", { class: "descripcion" }, "Leyendo el estado."));
  const d = describirActualizacion(e);
  let chipNodo;
  let frase;
  const acciones = h("div", { class: "fila" });
  const buscar = (principal) =>
    h(
      "button",
      {
        class: `boton${principal ? " principal" : ""}`,
        onclick: async (ev) => {
          estadoAct = await ocupado(ev.target, "Buscando…", () => api.actualizacionBuscar());
          pintarFranja();
          pintarVersion();
          refrescarInicio(true);
        },
      },
      "Buscar ahora",
    );
  switch (e.fase) {
    case "al-dia":
      chipNodo = chip("ok", "Al día");
      frase = `Al día (${e.instalada}).`;
      acciones.append(buscar(false));
      break;
    case "nueva":
      chipNodo = chip("aviso", "Hay una nueva");
      frase = `Hay una versión nueva (${e.version}). Tienes la ${e.instalada}.`;
      break;
    case "descargando":
    case "instalando":
      chipNodo = chip("aviso", e.fase === "descargando" ? "Descargando" : "Instalando");
      frase = d.texto;
      break;
    case "descargada":
      chipNodo = chip("ok", "Lista");
      frase = d.texto;
      break;
    case "error":
      chipNodo = chip("mal", "Error");
      frase = d.texto;
      acciones.append(buscar(true));
      break;
    case "buscando":
      chipNodo = chip("", "Buscando…");
      frase = `Tienes la ${e.instalada}.`;
      break;
    default:
      chipNodo = chip("", e.origen === "ninguno" ? "Sin buscar" : "Sin revisar");
      frase = e.origen === "ninguno" ? `Tienes la ${e.instalada}. No se busca nada todavía.` : `Tienes la ${e.instalada}. Todavía no se ha buscado.`;
      if (e.origen === "ninguno") acciones.append(h("button", { class: "boton principal", onclick: () => irA("ajustes", { manual: true, seccion: "seccion-actualizaciones" }) }, "Elegir dónde buscar"));
      else acciones.append(buscar(true));
  }
  if (d.boton) acciones.append(h("button", { class: "boton principal", onclick: () => accionActualizacion(d.accion) }, d.boton));
  return tarjeta("Actualizaciones", chipNodo, h("p", {}, frase), acciones);
}

function dibujarInicio(cont) {
  const lead = h("p", { class: "lead" });
  const aviso = h("div", {});
  const rejilla = h("div", { class: "rejilla" });
  let clave = "";
  const pintar = (forzar) => {
    const k = JSON.stringify([estadoPuente, datos, estadoAct, [...listos], versionMensaje]);
    if (!forzar && k === clave) return;
    clave = k;
    const todoBien =
      estadoPuente.activo && !estadoPuente.viejo && conectada() && datos.hooks && datos.hooks.ok && (!datos.firewall || datos.firewall.ok) && datos.avisosRed.length === 0;
    lead.textContent = todoBien ? "Todo en orden: Claude Code le avisa a tu 3DS." : "Así está todo ahora mismo.";
    const falta = [1, 2, 3, 4, 5].find((n) => !listos.has(n));
    mostrar(
      aviso,
      falta
        ? resultado("aviso", h("div", {}, `Todavía falta terminar la configuración (paso ${falta}: ${PASOS[falta - 1].nombre}).`), h("div", { class: "fila" }, h("button", { class: "boton", onclick: () => irAPaso(falta - 1) }, "Seguir con la configuración")))
        : null,
    );
    rejilla.replaceChildren(tarjetaPuente(), tarjeta3ds(), tarjetaClaude(), tarjetaActualizaciones());
  };
  cont.append(h("div", { class: "vista" }, h("div", { class: "cabecera" }, h("div", { class: "cabecera-fila" }, h("h2", {}, "Inicio")), lead), aviso, rejilla));
  pintar(true);
  refrescarInicio = pintar;
  return {
    actualizarPuente: () => pintar(false),
    actualizarActualizaciones: () => pintar(false),
    actualizarDatos: () => pintar(false),
    limpiar: () => {
      refrescarInicio = () => {};
    },
  };
}
let refrescarInicio = () => {};

// ---------- pantalla: Ajustes ----------

function dibujarAjustes(cont) {
  // iniciar con Windows
  const casillaInicio = h("input", { type: "checkbox", id: "inicio-windows" });
  casillaInicio.addEventListener("change", async () => {
    casillaInicio.checked = (await api.inicioCambiar(casillaInicio.checked)).activo;
  });
  api.inicioEstado().then((r) => {
    casillaInicio.checked = r.activo;
  });

  // al cerrar la ventana: seguir en la bandeja (por defecto) o salir del todo
  const radioCierre = (valor, texto) =>
    h(
      "label",
      { class: "opcion" },
      h("input", { type: "radio", name: "al-cerrar", value: valor, onchange: async (e) => { await api.cierreCambiar(e.target.value); } }),
      " ",
      texto,
    );
  const zonaCierre = h("div", { class: "apilado" }, radioCierre("bandeja", "Seguir en la bandeja (el puente sigue avisando a tu 3DS)"), radioCierre("salir", "Salir del todo (se detiene el puente)"));
  api.cierreEstado().then((r) => {
    for (const el of zonaCierre.querySelectorAll("input")) el.checked = el.value === r.alCerrar;
  });

  // actualizaciones
  const zonaAct = h("div", { class: "apilado" });
  pintarActualizaciones(zonaAct, true);

  // dónde se activa
  const zonaCarpetas = h("div", { class: "apilado" });
  const pintarCarpetas = (c) => {
    registrarCarpetas(c);
    const cambiar = async (fn) => pintarCarpetas(await fn());
    const radio = (valor, texto) =>
      h(
        "label",
        { class: "opcion" },
        h("input", { type: "radio", name: "modo-carpetas", value: valor, checked: c.modo === valor, onchange: () => cambiar(() => api.hooksCarpetasModo(valor)) }),
        " ",
        texto,
      );
    const nodos = [radio("todas", "En todas las carpetas"), radio("elegidas", "Solo en las carpetas que elija")];
    if (c.estado === "corrupto") nodos.push(resultado("mal", c.aviso));
    if (c.modo === "elegidas") {
      nodos.push(
        c.carpetas.length
          ? h(
              "ul",
              { class: "lista-carpetas" },
              c.carpetas.map((ruta) =>
                h("li", {}, h("code", { class: "ruta" }, ruta), h("button", { class: "boton chico", onclick: () => cambiar(() => api.hooksCarpetaQuitar(ruta)) }, "Quitar")),
              ),
            )
          : resultado("aviso", "Todavía no elegiste ninguna carpeta: por ahora la 3DS no recibe nada."),
        h("div", { class: "fila" }, h("button", { class: "boton", onclick: () => cambiar(() => api.hooksCarpetaAgregar()) }, "Agregar carpeta…")),
        h("p", { class: "nota" }, "Una carpeta incluye todas sus subcarpetas."),
      );
    }
    nodos.push(h("p", { class: "nota" }, "En las demás carpetas, Claude Code funciona como siempre, sin la 3DS."));
    mostrar(zonaCarpetas, h("div", { class: "apilado" }, nodos));
  };

  // consolas emparejadas: lista del puente (sin claves) y «Olvidar» con confirmación
  const zonaConsolas = h("div", { class: "apilado" });
  const fechaConsola = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "fecha desconocida" : d.toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" });
  };
  const pintarConsolas = async () => {
    let r;
    try {
      r = await api.dispositivosLista();
    } catch {
      r = { ok: false, error: "No pude leer las consolas emparejadas." };
    }
    if (!r.ok) return mostrar(zonaConsolas, resultado("aviso", r.error));
    if (!r.consolas.length) return mostrar(zonaConsolas, h("p", { class: "nota" }, "Todavía no hay ninguna consola emparejada. Se empareja en el paso 5."));
    const mensaje = h("div", {});
    const fila = (c) => {
      const li = h("li", {});
      const normal = () => {
        li.replaceChildren(
          h("span", {}, h("code", { class: "ruta" }, c.name === c.deviceId ? c.deviceId : `${c.name} (${c.deviceId})`), h("span", { class: "nota" }, ` · emparejada el ${fechaConsola(c.pairedAt)}`), c.connected ? " " : "", c.connected ? chip("ok", "Conectada") : ""),
          h("button", { class: "boton chico", onclick: confirmar }, "Olvidar"),
        );
      };
      const confirmar = () => {
        li.replaceChildren(
          h("span", {}, `¿Olvidar ${c.name}? Se borra su clave de este PC y se corta su conexión.`),
          h("span", { class: "fila" },
            h("button", { class: "boton chico", onclick: async (e) => {
              const r2 = await ocupado(e.target, "Olvidando…", () => api.dispositivosOlvidar(c.deviceId));
              if (!r2.ok) mostrar(mensaje, resultado("mal", r2.error));
              else mostrar(mensaje, resultado("ok", `Listo, olvidé ${c.name}${r2.desconectada ? " y corté su conexión" : ""}. Para volver a usarla, empareja la consola de nuevo (paso 5).`));
              await pintarConsolas();
              if (r2.ok) zonaConsolas.append(mensaje);
            } }, "Sí, olvidar"),
            h("button", { class: "boton chico", onclick: normal }, "Cancelar"),
          ),
        );
      };
      normal();
      return li;
    };
    mostrar(zonaConsolas, h("div", { class: "apilado" },
      h("ul", { class: "lista-carpetas" }, r.consolas.map(fila)),
      h("p", { class: "nota" }, "Al olvidar una consola, quien tenga esa 3DS necesita un código nuevo para volver a conectarse."),
    ));
  };

  // entrevistas (grill-me)
  const zonaSkill = h("div", {});
  const zonaSkillMensaje = h("div", {});
  const pintarSkill = (v) => {
    const nodos = [];
    if (!v.origenExiste) nodos.push(resultado("mal", "Falta el archivo de la skill dentro de la app. Reinstala Cronio."));
    if (v.estado === "ajena") {
      nodos.push(resultado("aviso", `Ya existe una carpeta «grill-me» tuya en ${v.carpeta} y no es de Cronio, así que no la toco. Renómbrala o muévela si quieres usar la nuestra.`));
    } else if (v.estado === "nuestra") {
      nodos.push(resultado("ok", v.desactualizada ? "Está instalada, pero hay una versión más nueva." : "Instalada."));
    } else {
      nodos.push(resultado("aviso", "Todavía no está instalada."));
    }
    const hayQueInstalar = v.estado !== "nuestra" || v.desactualizada;
    nodos.push(
      h(
        "div",
        { class: "fila" },
        h("button", { class: hayQueInstalar ? "boton principal" : "boton", disabled: v.estado === "ajena" || !v.origenExiste, onclick: accionSkill("instalar") }, v.estado === "nuestra" && v.desactualizada ? "Actualizar" : "Instalar"),
        h("button", { class: "boton", disabled: v.estado !== "nuestra", onclick: accionSkill("quitar") }, "Quitar"),
      ),
      h("p", { class: "nota ruta" }, `Archivo: ${v.archivo}`),
    );
    mostrar(zonaSkill, h("div", { class: "apilado" }, nodos));
  };
  const accionSkill = (cual) => async (e) => {
    const r = await ocupado(e.target, "Trabajando…", () => (cual === "instalar" ? api.skillInstalar() : api.skillQuitar()));
    pintarSkill(r.vista);
    if (!r.ok) mostrar(zonaSkillMensaje, resultado("mal", r.error));
    else mostrar(zonaSkillMensaje, resultado("ok", cual === "instalar" ? "Listo. Abre una sesión nueva de Claude Code y dile «entrevístame sobre…»." : "Listo, quité la skill de Cronio."));
  };

  cont.append(
    h(
      "div",
      { class: "vista" },
      h("div", { class: "cabecera" }, h("div", { class: "cabecera-fila" }, h("h2", {}, "Ajustes")), h("p", { class: "lead" }, "Lo que cambias de vez en cuando.")),
      h(
        "div",
        { class: "pila" },
        tarjeta(
          "Iniciar con Windows",
          null,
          h("label", { class: "casilla", for: "inicio-windows" }, casillaInicio, h("span", {}, "Abrir Cronio al encender el PC")),
          h("p", { class: "descripcion" }, "Queda en la bandeja y enciende el puente."),
        ),
        tarjeta("Al cerrar la ventana", null, zonaCierre, h("p", { class: "descripcion" }, "En la bandeja (junto al reloj) tienes un menú con lo más usado: detener el puente, buscar actualizaciones y más.")),
        (() => {
          const t = tarjeta("Actualizaciones", null, zonaAct);
          t.id = "seccion-actualizaciones";
          return t;
        })(),
        (() => {
          const t = tarjeta("Dónde se activa", null, h("p", { class: "descripcion" }, "Los avisos se instalan una vez, pero solo actúan en las carpetas que elijas."), zonaCarpetas);
          t.id = "seccion-carpetas";
          return t;
        })(),
        (() => {
          const t = tarjeta("Consolas emparejadas", null, h("p", { class: "descripcion" }, "Las 3DS que tienen clave en este PC. Si pierdes una o ya no la usas, olvídala."), zonaConsolas);
          t.id = "seccion-consolas";
          return t;
        })(),
        tarjeta("Entrevistas (grill-me)", null, h("p", { class: "descripcion" }, "Hace que Claude te entreviste, una pregunta por vez, para aclarar una idea. Las preguntas salen en tu 3DS."), zonaSkill, zonaSkillMensaje),
        tarjeta(
          "Tu privacidad",
          null,
          h("p", {}, "Cronio no usa servidores propios: todo pasa entre tu PC y tu consola. Claude Code le avisa al puente (127.0.0.1, tu propio computador) y el puente le habla a tu 3DS por tu red local, con el tráfico cifrado y autenticado. No se guarda nada fuera de tu PC."),
          h("p", {}, "Solo consulta GitHub si activas las actualizaciones automáticas («GitHub» en Actualizaciones): eso solo pregunta si hay una versión nueva y no envía datos tuyos."),
        ),
      ),
    ),
  );
  api.hooksCarpetasVista().then(pintarCarpetas);
  pintarConsolas();
  api.skillVista().then(pintarSkill);
  return {
    actualizarActualizaciones: () => pintarActualizaciones(zonaAct, false),
  };
}

// ---------- paso 1: bienvenida ----------

PASOS.push({
  nombre: "Qué necesitas",
  sub: "Antes de empezar",
  async dibujar(cont) {
    const estadoNode = h("div", {});
    const comprobar = async () => {
      const r = await leerNode();
      mostrar(estadoNode, resultado(r.ok ? "ok" : "mal", r.mensaje));
    };
    cont.append(
      h(
        "div",
        { class: "vista de-paso" },
        cabecera(1, "Qué necesitas", "Revisa que tengas lo necesario antes de empezar."),
        plegableInfo(
          listos.has(1),
          "Revisa que tengas lo necesario. No cambia nada en tu PC.",
          "Los avisos corren con Node, y la 3DS tiene que poder instalar apps.",
          "Node aparece con ✓. Lo demás lo confirmas tú.",
        ),
        h(
          "ul",
          { class: "lista-requisitos" },
          h(
            "li",
            {},
            h("strong", {}, "Node 22 o superior"),
            h("p", {}, "Claude Code lo usa para avisarle a esta app."),
            estadoNode,
            h(
              "div",
              { class: "fila" },
              h("button", { class: "boton principal", onclick: (e) => ocupado(e.target, "Comprobando…", comprobar) }, "Comprobar Node"),
              h("button", { class: "boton enlace", onclick: () => api.abrirEnlace("node") }, "Descargar Node (nodejs.org)"),
            ),
          ),
          h("li", {}, h("strong", {}, "Claude Code"), h("p", {}, "Instalado en este PC. Si ya lo usas, ya lo tienes.")),
          h(
            "li",
            {},
            h("strong", {}, "Una 3DS con firmware personalizado"),
            h("p", {}, "Con Luma3DS, Homebrew Launcher y FBI. Esta app no lo instala: la guía pública te lleva paso a paso."),
            h("div", { class: "fila" }, h("button", { class: "boton enlace", onclick: () => api.abrirEnlace("guia3ds") }, "Abrir la guía (3ds.hacks.guide)")),
          ),
          h("li", {}, h("strong", {}, "La misma red Wi-Fi"), h("p", {}, "El PC y la 3DS, en el Wi-Fi o la red de la casa.")),
        ),
        navegacion(0),
      ),
    );
    await comprobar();
    return {};
  },
});

// ---------- paso 2: hooks de Claude Code ----------

PASOS.push({
  nombre: "Claude Code",
  sub: "Conectar los avisos",
  async dibujar(cont) {
    const zonaEventos = h("div", {});
    const zonaEstado = h("div", {});
    const zonaAcciones = h("div", {});
    const zonaMensaje = h("div", {});
    const zonaCarpetas = h("p", { class: "descripcion" });
    const rutas = h("p", { class: "nota ruta" });

    const aplicar = (cual) => async (e) => {
      const r = await ocupado(e.target, "Trabajando…", () => (cual === "agregar" ? api.hooksAgregar() : api.hooksQuitar()));
      pintar(r.vista);
      if (!r.ok) mostrar(zonaMensaje, resultado("mal", r.error));
      else {
        const respaldo = r.respaldo ? ` Guardé una copia del archivo anterior: ${r.respaldo}` : "";
        mostrar(
          zonaMensaje,
          resultado("ok", cual === "agregar" ? "Listo. Las sesiones de Claude Code que ya tienes abiertas toman los avisos cuando las reinicies." : "Listo, quité los avisos de Cronio.", respaldo),
        );
      }
    };

    const pintar = (v) => {
      registrarHooks(v);
      rutas.textContent = `Archivo de Claude Code: ${v.settingsPath}`;
      const hk = datos.hooks;
      if (v.error) {
        mostrar(zonaEstado, resultado("mal", v.error));
        zonaEventos.replaceChildren();
      } else {
        const est = v.estado;
        mostrar(
          zonaEventos,
          h(
            "ul",
            { class: "lista-eventos" },
            v.eventos.map((e) =>
              h("li", {}, est.presentes.includes(e.evento) ? h("span", { class: "hecho" }, "✓ puesto") : null, h("code", {}, e.evento), " — ", e.descripcion),
            ),
          ),
        );
        if (est.ok) mostrar(zonaEstado, resultado("ok", `${hk.presentes} de ${hk.total} avisos conectados`));
        else if (est.presentes.length === 0) mostrar(zonaEstado, resultado("aviso", "Todavía no están conectados."));
        else if (est.scriptsFaltantes.length) mostrar(zonaEstado, resultado("mal", `Falta el archivo ${est.scriptsFaltantes.join(", ")}. Pulsa «Hacerlo por mí» para copiarlo de nuevo.`));
        else if (hk.desactualizada)
          mostrar(zonaEstado, resultado("aviso", "Los avisos están conectados, pero el archivo de permisos que usa Claude Code es de una versión anterior y no lleva la llave de seguridad del puente. Hasta que lo actualices, los permisos y las preguntas se contestan en el PC (nunca se aprueban solos). Pulsa «Actualizar»."));
        else mostrar(zonaEstado, resultado("aviso", `${hk.presentes} de ${hk.total} avisos conectados. Pulsa «Hacerlo por mí» para completarlos.`));
      }
      mostrar(
        zonaAcciones,
        h(
          "div",
          { class: "fila" },
          h("button", { class: hk.ok ? "boton" : "boton principal", onclick: aplicar("agregar") }, hk.ok ? "Volver a conectar" : hk.desactualizada ? "Actualizar" : "Hacerlo por mí"),
          h("button", { class: "boton", onclick: aplicar("quitar") }, "Quitar los avisos"),
        ),
      );
    };

    const pintarCarpetasResumen = () => {
      const c = datos.carpetas;
      zonaCarpetas.textContent = c ? `${textoCarpetas(c)}.` : "";
    };

    cont.append(
      h(
        "div",
        { class: "vista de-paso" },
        cabecera(2, "Conectar Claude Code", "Le pedimos a Claude Code que le avise a esta app cuando pasa algo."),
        plegableInfo(
          listos.has(2),
          "Agrega unas líneas al archivo de configuración de Claude Code (settings.json), con copia del anterior. No toca nada que no sea de Cronio.",
          "Sin ellas, Claude Code no le cuenta nada al puente y la 3DS no se entera de permisos ni preguntas.",
          "Dice «9 de 9 avisos conectados» y el paso se marca en verde.",
        ),
        h(
          "section",
          { class: "bloque tarjeta" },
          h("div", { class: "tarjeta-cab" }, h("h3", {}, "Avisos de Claude Code")),
          zonaEstado,
          zonaAcciones,
          zonaMensaje,
          h("details", { class: "plegable" }, h("summary", {}, "Ver los avisos uno por uno"), h("div", { class: "interior" }, rutas, zonaEventos)),
        ),
        h(
          "section",
          { class: "bloque tarjeta separada" },
          h("div", { class: "tarjeta-cab" }, h("h3", {}, "Dónde se activa")),
          zonaCarpetas,
          h("div", { class: "fila" }, h("button", { class: "boton", onclick: () => irA("ajustes", { manual: true, seccion: "seccion-carpetas" }) }, "Cambiar en Ajustes")),
        ),
        h("div", { class: "separador" }),
        navegacion(1),
      ),
    );
    pintar(await api.hooksVista());
    registrarCarpetas(await api.hooksCarpetasVista());
    pintarCarpetasResumen();
    return {
      actualizarDatos: pintarCarpetasResumen,
    };
  },
});

// ---------- paso 3: puente y firewall ----------

PASOS.push({
  nombre: "Este PC",
  sub: "Puente y firewall",
  async dibujar(cont) {
    const zonaPuente = h("div", {});
    const zonaFirewall = h("div", {});
    const zonaMsgFirewall = h("div", {});
    const zonaRed = h("div", {});
    const zonaMsgPuente = h("div", {});

    const pintarPuenteAqui = () => {
      const s = estadoPuente;
      if (s.activo && s.viejo) {
        const v = s.viejo;
        mostrar(
          zonaPuente,
          resultado(
            "aviso",
            h("div", {}, `Hay un puente viejo corriendo${v.pid ? ` (PID ${v.pid})` : ""} que no es de esta versión${v.version ? ` (es la ${v.version})` : ""}. Mientras siga ahí, la 3DS no recibe los avisos nuevos.`),
            v.pid
              ? h(
                  "div",
                  { class: "fila" },
                  h(
                    "button",
                    {
                      class: "boton",
                      onclick: async (e) => {
                        const r = await ocupado(e.target, "Deteniendo…", () => api.puenteDetenerViejo(v.pid));
                        estadoPuente = r.estado;
                        pintarPuente();
                        pintarPuenteAqui();
                        mostrar(zonaMsgPuente, r.ok ? resultado("ok", "Detuve el puente viejo y arranqué el de esta app.") : resultado("mal", r.motivo || "No se pudo detener."));
                      },
                    },
                    "Detener puente viejo",
                  ),
                )
              : h("div", { class: "nota" }, "No encuentro su PID: ciérralo desde la ventana donde lo iniciaste."),
          ),
        );
      } else if (s.activo) {
        mostrar(zonaPuente, resultado("ok", s.propio ? "El puente está en marcha (lo inició esta app)." : "El puente ya estaba corriendo; esta app lo usa tal cual."));
      } else {
        mostrar(zonaPuente, resultado("mal", s.error || "El puente está apagado."));
      }
    };

    const pintarFirewall = (regla) => {
      if (regla.ok && regla.antigua) mostrar(zonaFirewall, resultado("ok", "Existe la regla antigua «Agent Companion» y funciona; al pulsar el botón se renombra a Cronio."));
      else if (regla.ok) mostrar(zonaFirewall, resultado("ok", `La regla «Cronio» abre los puertos ${regla.puertos.join(" y ")}.`));
      else if (regla.existe) mostrar(zonaFirewall, resultado("aviso", "Hay una regla con ese nombre pero no abre los dos puertos. Pulsa el botón para crearla de nuevo."));
      else mostrar(zonaFirewall, resultado("aviso", "Todavía no existe la regla."));
      firewallOk = regla.ok;
      datos.firewall = { ok: regla.ok };
      marcar(3, firewallOk && estadoPuente.activo);
    };

    const verificar = async () => {
      pintarFirewall(await api.firewallEstado());
      try {
        avisosPublica(zonaRed, await api.redDirecciones());
      } catch {
        zonaRed.replaceChildren();
      }
    };

    cont.append(
      h(
        "div",
        { class: "vista de-paso" },
        cabecera(3, "Preparar este PC", "Puente encendido y permiso del firewall: lo que la 3DS necesita para llegar al PC."),
        plegableInfo(
          listos.has(3),
          "Enciende el puente y abre en el firewall los puertos que la 3DS usa (solo en redes privadas).",
          "Sin el puente nadie escucha a Claude. Sin la regla, Windows bloquea a la 3DS aunque estén en el mismo Wi-Fi.",
          "El puente aparece «en marcha» y la regla con ✓.",
        ),
        h(
          "div",
          { class: "pila" },
          h(
            "section",
            { class: "bloque tarjeta" },
            h("div", { class: "tarjeta-cab" }, h("h3", {}, "Puente")),
            zonaPuente,
            h(
              "div",
              { class: "fila" },
              h("button", { class: "boton principal", onclick: async (e) => { mostrar(zonaMsgPuente, await accionIniciar(e.target)); pintarPuenteAqui(); } }, "Iniciar"),
              h("button", { class: "boton", onclick: async (e) => { mostrar(zonaMsgPuente, await accionDetener(e.target)); pintarPuenteAqui(); } }, "Detener"),
              h("button", { class: "boton enlace", onclick: () => api.puenteAbrirLog() }, "Ver el registro"),
            ),
            zonaMsgPuente,
          ),
          h(
            "section",
            { class: "bloque tarjeta" },
            h("div", { class: "tarjeta-cab" }, h("h3", {}, "Firewall de Windows")),
            h("p", { class: "descripcion" }, "Windows pide permiso de administrador: elige «Sí». La regla vale solo en redes privadas."),
            zonaFirewall,
            zonaRed,
            zonaMsgFirewall,
            h(
              "div",
              { class: "fila" },
              h(
                "button",
                {
                  class: "boton principal",
                  onclick: async (e) => {
                    const r = await ocupado(e.target, "Esperando a Windows…", () => api.firewallAgregar());
                    pintarFirewall(r.regla);
                    mostrar(zonaMsgFirewall, r.ok ? resultado("ok", "Regla creada.") : resultado("mal", r.error));
                  },
                },
                "Hacerlo por mí",
              ),
            ),
          ),
        ),
        navegacion(2),
      ),
    );
    pintarPuenteAqui();
    await verificar();
    return {
      actualizarPuente: () => {
        pintarPuenteAqui();
        marcar(3, firewallOk && estadoPuente.activo);
      },
    };
  },
});

// ---------- paso 4: la 3DS ----------

PASOS.push({
  nombre: "La 3DS",
  sub: "Instalar la app",
  async dibujar(cont) {
    const zonaQr = h("div", {});
    const zonaUrl = h("div", {});
    const zonaAviso = h("div", {});
    const selector = h("select", { id: "ip-lan", "aria-label": "Dirección IP del PC" });
    const zonaIp = h("div", { class: "fila" });
    const yaInstalada = h("input", { type: "checkbox", id: "ya-instalada" });
    let sirviendo = false;

    const cargar = async (ip) => {
      zonaUrl.replaceChildren();
      const r = await api.ciaIniciar(ip);
      sirviendo = Boolean(r.sirviendo);
      if (r.sinPuente) {
        mostrar(zonaQr, resultado("mal", "El puente está apagado, y él entrega el archivo de la app. Inícialo en el paso 3 y vuelve."));
        return;
      }
      if (r.esperandoPuente) {
        mostrar(zonaQr, resultado("aviso", "Otro programa tiene el puerto 33337, así que el puente todavía no entrega el archivo. Lo reintenta cada 5 segundos: vuelve a este paso en unos segundos."));
        return;
      }
      if (!r.existe) {
        mostrar(zonaQr, resultado("mal", "Todavía no existe el archivo agent-companion.cia. Para generarlo, abre una terminal en la carpeta client-3ds y escribe: make cia (necesita devkitPro, makerom y bannertool)."));
        return;
      }
      if (r.error) {
        mostrar(zonaQr, resultado("mal", r.error));
        return;
      }
      mostrar(
        zonaQr,
        h(
          "div",
          {},
          h("img", { class: "qr", src: r.qr, alt: "Código QR para instalar en la 3DS" }),
          r.origen === "puente"
            ? null
            : resultado("aviso", "El puente que corre no entrega el archivo (es de desarrollo o anterior): este paso lo entrega y se apaga al salir. Para que la 3DS se actualice sola, reinicia el puente desde el paso 3."),
        ),
      );
      mostrar(
        zonaUrl,
        h(
          "div",
          {},
          h("p", { class: "nota" }, "Dirección que lee la 3DS:"),
          h("p", { class: "mono dir-escrita" }, r.url),
          r.origen === "puente" ? h("p", { class: "nota" }, `El puente entrega el archivo${r.version ? ` (versión ${r.version})` : ""} mientras esté encendido, no solo en este paso.`) : null,
        ),
      );
    };

    cont.append(
      h(
        "div",
        { class: "vista de-paso" },
        cabecera(4, "Instalar la app en la 3DS", "La instalas con un código QR, sin cables ni tarjeta SD."),
        plegableInfo(
          listos.has(4),
          "Muestra un código QR. Mientras estés aquí, el PC deja la app disponible en tu red; FBI la descarga e instala.",
          "La app de la 3DS es la que muestra los avisos de Claude y te deja responder.",
          "En el menú HOME de la 3DS aparece el icono de Cronio.",
        ),
        h(
          "section",
          { class: "bloque tarjeta" },
          h("div", { class: "tarjeta-cab" }, h("h3", {}, "Con el código QR")),
          h("ol", { class: "pasos-fbi" }, h("li", {}, "En la 3DS abre FBI."), h("li", {}, "Elige «Remote Install» y luego «Scan QR Code»."), h("li", {}, "Apunta la cámara al código y confirma.")),
          zonaAviso,
          zonaQr,
          h("p", { class: "nota" }, "Instalarla de nuevo con el QR la actualiza; no se duplica."),
          h("label", { class: "casilla" }, yaInstalada, h("span", {}, "Ya instalé la app en mi 3DS")),
        ),
        h("div", { class: "separador" }),
        h(
          "details",
          { class: "plegable" },
          h("summary", {}, "Otras opciones"),
          h(
            "div",
            { class: "interior" },
            h(
              "div",
              { class: "accion" },
              h("h3", {}, "Dirección del PC"),
              h("div", { class: "fila" }, h("label", { for: "ip-lan" }, "IP de este PC en tu red:"), zonaIp),
              zonaUrl,
              h("h3", {}, "Actualizar desde la propia 3DS"),
              h("p", {}, "Si Cronio ya está instalada como .cia, la 3DS avisa cuando hay una versión más nueva y la instala con A (o desde SELECT, «Actualizar app»). Con el .3dsx no se puede."),
              h("h3", {}, "Copiar el archivo a mano (.3dsx)"),
              h("p", {}, "Copia agent-companion.3dsx a la tarjeta SD, en ", h("code", {}, "/3ds/"), ", y ábrelo desde el Homebrew Launcher."),
              h("div", { class: "fila" }, h("button", { class: "boton", onclick: () => api.ciaMostrarCarpeta("3dsx") }, "Mostrar el archivo .3dsx")),
            ),
          ),
        ),
        navegacion(3),
      ),
    );

    yaInstalada.checked = leerYaInstalada();
    marcar(4, yaInstalada.checked);
    yaInstalada.addEventListener("change", () => {
      try {
        localStorage.setItem("companion-3ds-instalada", yaInstalada.checked ? "1" : "0");
      } catch {
        /* se ignora */
      }
      marcar(4, yaInstalada.checked);
    });

    const direcciones = await api.redDirecciones();
    if (direcciones.length === 0) {
      mostrar(zonaQr, resultado("mal", "No encontré una red local en este PC. Conéctalo al Wi-Fi de la casa y vuelve a este paso."));
    } else {
      for (const d of direcciones) {
        const etiquetas = [d.nombre, nombrePerfil(d.perfil), d.porConsola ? "por aquí se conectó tu 3DS" : "", d.recomendada ? "recomendada" : ""].filter(Boolean);
        selector.append(h("option", { value: d.direccion }, `${d.direccion} (${etiquetas.join(" · ")})`));
      }
      zonaIp.append(selector);
      if (direcciones.length === 1) selector.disabled = true;
      selector.addEventListener("change", () => {
        avisosPublica(zonaAviso, direcciones, selector.value);
        cargar(selector.value);
      });
      avisosPublica(zonaAviso, direcciones, selector.value);
      await cargar(selector.value);
    }
    return {
      limpiar: async () => {
        await api.ciaDetener();
      },
    };
  },
});

// ---------- paso 5: emparejar y probar ----------

PASOS.push({
  nombre: "Emparejar",
  sub: "Conectar y probar",
  async dibujar(cont) {
    const zonaCodigo = h("div", {});
    const zonaConexion = h("div", {});
    const zonaPrueba = h("div", {});

    const pintarConexion = () => {
      if (!estadoPuente.activo) mostrar(zonaConexion, resultado("mal", "El puente está apagado. Inícialo en el paso 3."));
      else if (conectada()) mostrar(zonaConexion, resultado("ok", "La 3DS está conectada al puente."));
      else mostrar(zonaConexion, resultado("aviso", "Esperando a que la 3DS se conecte…"));
    };

    const pedirCodigo = async (e) => {
      const r = await ocupado(e.target, "Pidiendo código…", () => api.emparejarCodigo());
      if (!r.ok) mostrar(zonaCodigo, resultado("mal", r.error));
      else
        mostrar(
          zonaCodigo,
          h("div", {}, h("div", { class: "codigo-grande" }, r.codigo), h("p", { class: "nota" }, `Vale ${r.minutos} minutos y se usa una sola vez. Escríbelo en la 3DS.`)),
        );
    };

    cont.append(
      h(
        "div",
        { class: "vista de-paso" },
        cabecera(5, "Emparejar y probar", "La 3DS y el PC se reconocen, y mandamos un aviso de prueba."),
        plegableInfo(
          listos.has(5),
          "Te da un código de 6 dígitos para escribir en la 3DS y manda un aviso de prueba.",
          "El código empareja tu 3DS con tu PC.",
          "Aparece «La 3DS está conectada» y la prueba se ve en su pantalla.",
        ),
        h(
          "div",
          { class: "pila" },
          h(
            "section",
            { class: "bloque tarjeta" },
            h("div", { class: "tarjeta-cab" }, h("h3", {}, "1. Abre Cronio en la 3DS")),
            h("p", {}, "Desde el menú HOME. Debería encontrar el PC sola; si te pide un código, pídelo aquí."),
            h("div", { class: "fila" }, h("button", { class: "boton principal", onclick: pedirCodigo }, "Mostrar código de emparejamiento")),
            zonaCodigo,
          ),
          h("section", { class: "bloque tarjeta" }, h("div", { class: "tarjeta-cab" }, h("h3", {}, "2. Espera la conexión")), zonaConexion),
          h(
            "section",
            { class: "bloque tarjeta" },
            h("div", { class: "tarjeta-cab" }, h("h3", {}, "3. Probar")),
            h("p", {}, "Manda un aviso de prueba y mira la pantalla de la 3DS."),
            h(
              "div",
              { class: "fila" },
              h(
                "button",
                {
                  class: "boton principal",
                  onclick: async (e) => {
                    const r = await ocupado(e.target, "Enviando…", () => api.pruebaEnviar());
                    mostrar(
                      zonaPrueba,
                      r.ok
                        ? resultado("ok", "Aviso enviado. Si ves una sesión llamada «Prueba de Cronio» en la 3DS, todo funciona.")
                        : resultado("mal", r.error || "No se pudo enviar."),
                    );
                  },
                },
                "Mandar aviso de prueba",
              ),
              h(
                "button",
                {
                  class: "boton",
                  onclick: async (e) => {
                    await ocupado(e.target, "Quitando…", () => api.pruebaTerminar());
                    mostrar(zonaPrueba, resultado("ok", "Prueba retirada de la 3DS."));
                  },
                },
                "Quitar la prueba",
              ),
            ),
            zonaPrueba,
            h("p", { class: "nota" }, "Si no aparece: revisa que el PC y la 3DS estén en el mismo Wi-Fi y que el firewall (paso 3) tenga ✓."),
          ),
        ),
        navegacion(4),
      ),
    );
    pintarConexion();
    return { actualizarPuente: pintarConexion };
  },
});

// ---------- arranque ----------

/** Lo que pide el menú de la bandeja cuando abre la ventana: ir a una pantalla o actualizar (la ventana muestra el progreso). */
async function aplicarOrden(orden) {
  if (!orden) return;
  if (orden.tipo === "ir") {
    await irA(orden.vista, { manual: true, ...(orden.seccion ? { seccion: orden.seccion } : {}) });
  } else if (orden.tipo === "actualizar") {
    await irA("inicio", { manual: true });
    await refrescarActualizaciones();
    if (estadoAct && estadoAct.fase === "descargada") await accionActualizacion("reiniciar");
    else if (estadoAct && estadoAct.fase === "nueva") await accionActualizacion("actualizar");
  }
}
const tomarOrden = async () => aplicarOrden(await api.ordenPendiente());

async function iniciar() {
  pintarLateral();
  document.getElementById("contenido").replaceChildren(h("p", { class: "lead" }, "Comprobando tu PC…"));
  await refrescarPuente();
  await refrescarActualizaciones();
  await leerBasicos();
  // al abrir: Inicio si los cinco pasos tienen ✓; si no, el primero que no lo tenga (salvo que el usuario ya haya elegido algo)
  if (!eligioVista) {
    const falta = [1, 2, 3, 4, 5].find((n) => !listos.has(n));
    await irA(falta ? `paso-${falta}` : "inicio");
  }
  setInterval(refrescarPuente, 2000);
  setInterval(refrescarActualizaciones, 3000);
  setInterval(verificarFondo, 10000);
  await tomarOrden();
}

// con la ventana ya abierta, la bandeja avisa por aquí que dejó una orden
api.alRecibirOrden(tomarOrden);
iniciar();
