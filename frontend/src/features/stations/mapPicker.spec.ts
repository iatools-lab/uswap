import { describe, expect, it } from "vitest";
import { parseCoordinate, parseCoordinatePair } from "./mapPicker";

describe("parseCoordinate", () => {
  it("accepte une latitude décimale", () => {
    expect(parseCoordinate("4.051056", "lat")).toBeCloseTo(4.051056, 6);
  });

  it("accepte une virgule décimale", () => {
    expect(parseCoordinate("9,708533", "lng")).toBeCloseTo(9.708533, 6);
  });

  it("accepte les degrés/minutes/secondes", () => {
    expect(parseCoordinate(`4°03'03.8"N`, "lat")).toBeCloseTo(4.051055, 5);
    expect(parseCoordinate(`9°42'30.7"E`, "lng")).toBeCloseTo(9.708527, 5);
  });

  it("applique l'hémisphère sud/ouest", () => {
    expect(parseCoordinate("4.05 S", "lat")).toBeCloseTo(-4.05, 6);
    expect(parseCoordinate("9.7 W", "lng")).toBeCloseTo(-9.7, 6);
  });

  it("refuse une valeur hors bornes", () => {
    expect(parseCoordinate("120", "lat")).toBeNull();
    expect(parseCoordinate("200", "lng")).toBeNull();
  });

  it("refuse une saisie vide ou non numérique", () => {
    expect(parseCoordinate("", "lat")).toBeNull();
    expect(parseCoordinate("abc", "lat")).toBeNull();
  });
});

describe("parseCoordinatePair", () => {
  it("lit le format copié depuis Google Maps", () => {
    expect(parseCoordinatePair("4.051056, 9.708533")).toEqual({
      lat: 4.051056,
      lng: 9.708533,
    });
  });

  it("lit une paire entre parenthèses", () => {
    expect(parseCoordinatePair("(4.051056, 9.708533)")).toEqual({
      lat: 4.051056,
      lng: 9.708533,
    });
  });

  it("remet la paire dans l'ordre quand elle est inversée", () => {
    // 120 dépasse 90 : c'est forcément une longitude, donc l'ordre est (lng, lat).
    expect(parseCoordinatePair("120.5, 4.051056")).toEqual({
      lat: 4.051056,
      lng: 120.5,
    });
  });

  it("ne confond pas une adresse avec une paire de coordonnées", () => {
    // Une adresse contenant des chiffres ne doit jamais être lue comme un point.
    expect(parseCoordinatePair("Tradex Bonamoussadi, Douala")).toBeNull();
    expect(parseCoordinatePair("Rue 12, Douala")).toBeNull();
  });

  it("refuse une saisie incomplète", () => {
    expect(parseCoordinatePair("4.051056")).toBeNull();
    expect(parseCoordinatePair("")).toBeNull();
  });
});
