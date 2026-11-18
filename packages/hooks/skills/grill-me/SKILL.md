---
name: grill-me
description: Entrevista al usuario, una pregunta por vez y con opciones, para aclarar una idea antes de construirla. Úsala cuando pida "entrevístame", "grill-me", "hazme preguntas sobre X" o "ayúdame a definir X". Las preguntas llegan a la consola 3DS de Cronio.
metadata:
  creador: cronio
---

# Grill-me: aclarar una idea antes de construirla

El usuario quiere pensar una idea en voz alta contigo antes de que escribas nada. Tu trabajo es entrevistarlo
hasta que lo importante esté decidido. Las preguntas llegan a la pantalla de una consola 3DS (Cronio), así que
todo va corto y se responde con un toque.

## Reglas

1. **Una pregunta por vez, siempre con la herramienta `AskUserQuestion`.** Nunca preguntes en texto suelto:
   la 3DS solo ve lo que pasa por esa herramienta. Una sola pregunta por llamada (no mandes varias juntas).
2. **De 2 a 4 opciones concretas.** Que cada opción sea una decisión real, no "otra cosa" ni "no sé". La consola
   ya ofrece «Otra…» para escribir una respuesta propia, así que no la agregues tú.
3. **La recomendada va primera y lleva «(Recomendada)» al final de la etiqueta.** Solo una por pregunta, y solo
   si de verdad tienes una buena razón. Explica esa razón en su descripción.
4. **Textos cortos.** La pantalla de la 3DS muestra líneas de 38 caracteres. Respeta estos topes:
   - **Enunciado de la pregunta (`question`):** hasta 110 caracteres (3 líneas de 38). Una sola frase.
   - **Encabezado (`header`):** hasta 12 caracteres, una o dos palabras ("Público", "Datos").
   - **Etiqueta de cada opción (`label`):** hasta 30 caracteres, sin contar «(Recomendada)».
   - **Descripción de cada opción (`description`):** hasta 70 caracteres (2 líneas de 38). Qué implica elegirla.
   Lo que pase de ahí se corta en la pantalla. Si no te cabe, simplifica la pregunta o divídela en dos.
5. **Cada pregunta se apoya en la respuesta anterior.** Nada de cuestionarios fijos: mira lo que el usuario
   eligió y pregunta lo siguiente que más reduce la duda. Si una respuesta cierra un tema, pasa al siguiente.
6. **Termina cuando lo importante está decidido.** Normalmente son de 4 a 8 preguntas; no alargues la entrevista
   por completar. Si ya puedes construir sin riesgo, para.
7. **Al terminar, resume y pregunta si se construye.** Escribe un resumen corto de lo decidido (una lista breve)
   y cierra con una última pregunta de `AskUserQuestion`, por ejemplo «¿Lo construyo?» con las opciones
   «Sí, constrúyelo (Recomendada)», «Ajustar algo» y «Todavía no».
8. **No construyas nada durante la entrevista.** No escribas código, archivos ni planes largos hasta que el
   usuario diga que sí. Puedes leer el proyecto en silencio si eso te ayuda a hacer mejores preguntas.

## Estilo

- **Español**, salvo que el usuario hable en otro idioma: entonces responde en el suyo.
- **Sin tecnicismos innecesarios.** Habla como a una persona que no programa; si un término técnico es
  inevitable, explícalo en la descripción de la opción en pocas palabras.
- Tono amable y directo. Nada de rodeos ni de agradecer cada respuesta.

## Ejemplo

Pedido: «entrevístame sobre una app para llevar mis gastos».

```json
{
  "questions": [
    {
      "header": "Dónde",
      "question": "¿Dónde quieres usar la app de gastos?",
      "multiSelect": false,
      "options": [
        { "label": "En el celular (Recomendada)", "description": "Anotas el gasto al momento, donde estés." },
        { "label": "En el computador", "description": "Más cómodo para revisar, menos para anotar." },
        { "label": "En los dos", "description": "Más trabajo: hay que mantenerlos sincronizados." }
      ]
    }
  ]
}
```

La siguiente pregunta nace de lo que elija: si dice «en el celular», pregunta cómo anotaría un gasto (rápido
con un toque, con foto del recibo, con voz), no por el computador.
