const ESTACIONES_AEMET = [
  { idema: "9218A", nombre: "ISABA/IZABA", lat: 42.8625, lon: -0.924622 },
  { idema: "9228J", nombre: "OROZ-BETELU/OROTZ-BETELU  DEPÓSITO", lat: 42.89624, lon: -1.300216 },
  { idema: "9228T", nombre: "RONCESVALLES/ORREAGA", lat: 43.007878, lon: -1.325557 },
  { idema: "9238X", nombre: "NAVASCUÉS/NABASKOZE", lat: 42.7175, lon: -1.117222 },
  { idema: "9244X", nombre: "SOS DEL REY CATÓLICO", lat: 42.490833, lon: -1.213333 },
  { idema: "9245X", nombre: "CÁSEDA  DEPÓSITO", lat: 42.521388, lon: -1.366381 },
  { idema: "9252X", nombre: "OLITE/ERRIBERRI", lat: 42.489168, lon: -1.655553 },
  { idema: "9257X", nombre: "ESTERIBAR  EMBALSE DE EUGI", lat: 42.970555, lon: -1.516946 },
  { idema: "9262P", nombre: "MONREAL/ELO  DEPÓSITO", lat: 42.70125, lon: -1.49567 },
  { idema: "9263D", nombre: "PAMPLONA  AEROPUERTO", lat: 42.776952, lon: -1.649869 },
  { idema: "9263X", nombre: "ARANGUREN  ILUNDAIN", lat: 42.776102, lon: -1.532487 },
  { idema: "9274X", nombre: "IRURTZUN", lat: 42.918846, lon: -1.835118 },
  { idema: "9280B", nombre: "LARRAGA", lat: 42.549445, lon: -1.857382 },
  { idema: "9287A", nombre: "SAN PEDRO MANRIQUE", lat: 42.026458, lon: -2.230789 },
  { idema: "9293X", nombre: "ALFARO  LA PLANA - DEPÓSITO", lat: 42.176133, lon: -1.743811 },
  { idema: "9294E", nombre: "BARDENAS REALES  BASE AÉREA", lat: 42.198543, lon: -1.475169 },
];
//buscarEstacionMasCercana
export function obtenerIdemaMasCercano(latMovil, lonMovil) {
  let estacionCercana = ESTACIONES_AEMET[0];
  let distanciaMinima = Infinity;

  ESTACIONES_AEMET.forEach(estacion => {
    // Distancia matemática simple entre puntos (Pitágoras)
    const dLat = estacion.lat - latMovil;
    const dLon = estacion.lon - lonMovil;
    const distancia = Math.sqrt(dLat * dLat + dLon * dLon);

    if (distancia < distanciaMinima) {
      distanciaMinima = distancia;
      estacionCercana = estacion;
    }
  });
  return estacionCercana;
  //return estacionCercana.idema; // Devuelve el código listo para la API de AEMET
}
