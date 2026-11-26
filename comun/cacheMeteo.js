// comun/cacheMeteo.js
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CACHE_KEY_PREFIX = '@aemet_cache_';

/**
 * Comprueba si toca pedir datos nuevos a la AEMET basándose en tu criterio:
 * Cada nueva hora a partir del minuto 35.
 */
// function tocaActualizar(timestampGuardado, idemaGuardado, idemaActual) {
//   if (!timestampGuardado) return true;

//   // ¡LA CLAVE DE LA MUDANZA!: Si te has movido de pueblo, toca actualizar YA
//   if (idemaGuardado !== idemaActual) return true;

//   const ahora = new Date();
//   const guardado = new Date(timestampGuardado);

//   // 1. Si estamos en un día o mes diferente, actualiza ya
//   if (ahora.toDateString() !== guardado.toDateString()) return true;

//   // 2. Si estamos en una hora posterior a la guardada
//   if (ahora.getHours() > guardado.getHours()) {
//     // Solo permitimos actualizar si ya hemos alcanzado o pasado el minuto 35 de la nueva hora
//     return ahora.getMinutes() >= 35;
//   }

//   // 3. Si seguimos en la misma hora, no hace falta actualizar todavía
//   return false;
// }


//exterior
export const guardarClimaEnCache = async (idema, datosClima) => {
  try {
    if (!idema) return;
    const clave = `${CACHE_KEY_PREFIX}${idema}`;    
    const envoltorio = {
      datos: datosClima,
      time: datosClima.time || null, // Guardamos la fecha del dato en la raíz del envoltorio en minúscula
      Timestamp: Date.now() // Guardamos el momento exacto de la escritura (parece que no lo usamos)
    };

    await AsyncStorage.setItem(clave, JSON.stringify(envoltorio));
    console.log(`[Cache Storage] Guardada caché con éxito para la estación: ${idema}`);
  } catch (error) {
    console.error("Error al escribir en AsyncStorage:", error);
  }
};


//exterior
/**
 * RECUPERA EL CLIMA Y CALCULA SI EXIGE ACTUALIZACIÓN
 * Revisa si ha pasado el minuto 35 de la siguiente hora para renovar datos.
 */
export const obtenerClimaCachado = async (idema) => {
  try {
    if (!idema) return { necesitaFetch: true, datos: null };
    
    const clave = `${CACHE_KEY_PREFIX}${idema}`; //@clima_cache_${idema}
    const cacheExiste = await AsyncStorage.getItem(clave);

    // Si la caja está vacía, toca ir a internet sí o sí
    if (!cacheExiste) {
      return { necesitaFetch: true, datos: null };
    }

    const cacheParseada = JSON.parse(cacheExiste);
    
    // Soporte para datos antiguos que se guardaron sin el envoltorio actual
    const datosRealistas = cacheParseada.datos ? cacheParseada.datos : cacheParseada;

    // Buscamos 'time' en el envoltorio o dentro de los propios datos por si acaso
    const time = cacheParseada.time || datosRealistas.time;

    if (!time) {
      // Si es un dato viejo sin fecha, forzamos actualización pero devolvemos el dato por si acaso
      return { necesitaFetch: true, datos: datosRealistas };
    }

    // --- LÓGICA INTELIGENTE DEL MINUTO 35 DE AEMET (Optimizada) ---
    const ahora = new Date();
    const momentoGuardado = new Date(time);

    // Si la fecha es inválida por un mal formato string, reseteamos de forma segura
    if (isNaN(momentoGuardado.getTime())) {
      return { necesitaFetch: true, datos: datosRealistas };
    }
    
    // 1. Calculamos la frontera del minuto 35 de LA MISMA HORA en la que se observó el dato
    const fronteraMinuto35 = new Date(momentoGuardado);
    fronteraMinuto35.setMinutes(35, 0, 0);

    // 2. Si el dato ya se tomó DESPUÉS del minuto 35, la siguiente actualización real
    // no estará disponible hasta el minuto 35 de la SIGUIENTE hora.
    if (momentoGuardado >= fronteraMinuto35) {
      fronteraMinuto35.setHours(fronteraMinuto35.getHours() + 1);
    }

    // 3. ¿El momento actual ya ha alcanzado o superado esa frontera temporal?
    const necesitaFetch = ahora >= fronteraMinuto35;

    return {
      necesitaFetch,
      datos: datosRealistas
    };

  } catch (error) {
    console.error("Error al leer de AsyncStorage:", error);
    // En caso de fallo crítico, devolvemos que intente buscar en internet por si acaso
    return { necesitaFetch: true, datos: null };
  }
};


export const guardarInteriorEnCache = async (datosInteriores) => {
    try {
      if (!datosInteriores) return;
      await AsyncStorage.setItem('@interior_cache', JSON.stringify(datosInteriores));
    } catch (error) {
      console.error("Error al guardar caché interior:", error);
    }
};

export const obtenerInteriorCachado = async () => {
  try {
    const cache = await AsyncStorage.getItem('@interior_cache');
    return cache ? JSON.parse(cache) : null;
  } catch (error) {
    console.error("Error al leer caché interior", error);
    return null;
  }
};
