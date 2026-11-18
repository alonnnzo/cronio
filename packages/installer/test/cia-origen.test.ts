import { describe, expect, it } from "vitest";
import { CIA_PUERTO, decidirOrigenCia } from "../src/setup/cia.ts";

describe("decidirOrigenCia (quién entrega el .cia en el paso 4)", () => {
  it("si el puente lo sirve, el QR lleva su puerto y versión y el paso no levanta nada", () => {
    expect(decidirOrigenCia({ cia: { serving: true, port: 33337, version: "0.2.0" } })).toEqual({ tipo: "puente", puerto: 33337, version: "0.2.0" });
    expect(decidirOrigenCia({ cia: { serving: true } })).toEqual({ tipo: "puente", puerto: CIA_PUERTO });
  });
  it("un puente que no lo sirve (desarrollo o anterior) deja al paso como respaldo", () => {
    expect(decidirOrigenCia({ cia: { serving: false } })).toEqual({ tipo: "respaldo" });
    expect(decidirOrigenCia({})).toEqual({ tipo: "respaldo" }); // puente anterior: /health sin `cia`
  });
  it("sin puente no se levanta nada: dos servidores no deben chocar en el puerto", () => {
    expect(decidirOrigenCia(undefined)).toEqual({ tipo: "sin-puente" });
  });
});

describe("decidirOrigenCia con el puente propio (el respaldo no le quita el 33337)", () => {
  const sinCia = { cia: { serving: false } };
  it("con el puente hijo que no sirve el .cia (puerto ocupado) no levanta respaldo: espera a que el puente reintente", () => {
    expect(decidirOrigenCia(sinCia, { propio: true })).toEqual({ tipo: "esperando" });
    expect(decidirOrigenCia({}, { propio: true })).toEqual({ tipo: "esperando" });
  });
  it("mientras el hijo arranca no levanta nada", () => {
    expect(decidirOrigenCia(sinCia, { arrancando: true })).toEqual({ tipo: "esperando" });
  });
  it("el respaldo solo con un puente ajeno que no sirve el .cia", () => {
    expect(decidirOrigenCia(sinCia, { propio: false, arrancando: false })).toEqual({ tipo: "respaldo" });
    expect(decidirOrigenCia(sinCia)).toEqual({ tipo: "respaldo" });
  });
  it("si el puente (propio o no) sirve el .cia, se usa siempre", () => {
    const sirve = { cia: { serving: true, port: 33337, version: "0.2.1" } };
    expect(decidirOrigenCia(sirve, { propio: true })).toEqual({ tipo: "puente", puerto: 33337, version: "0.2.1" });
    expect(decidirOrigenCia(sirve, { arrancando: true })).toEqual({ tipo: "puente", puerto: 33337, version: "0.2.1" });
  });
  it("sin puente, nada, aunque esté arrancando", () => {
    expect(decidirOrigenCia(undefined, { arrancando: true })).toEqual({ tipo: "sin-puente" });
  });
});
