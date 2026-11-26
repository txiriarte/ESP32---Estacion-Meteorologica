import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable, Linking } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { obtenerClimaCachado, guardarClimaEnCache, guardarInteriorEnCache, obtenerInteriorCachado, CACHE_KEY_PREFIX } from './comun/cacheMeteo';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DB_URL, FIREBASE_SECRET, AEMET_API_KEY, GRAFANA_URL } from './comun/config';
import { getIaqLevel, formatFixed, formatRounded } from './comun/funciones';
import { obtenerIdemaMasCercano } from './comun/estaciones';

export default function App() {
  const [metric, setMetric] = useState(null);
  const [weather, setWeather] = useState(null);
  const [error, setError] = useState(null);
  const [horaInterior, setHoraInterior] = useState(null);
  const [horaExterior, setHoraExterior] = useState(null);

  const [currentTab, setCurrentTab] = useState('datos');
  const [useGPS, setUseGPS] = useState(false);
  const [nombreEstacion, setNombreEstacion] = useState('PAMPLONA AEROPUERTO');

  const iaqLevel = useMemo(() => getIaqLevel(metric?.iaq), [metric?.iaq]);

  const openGrafana = async () => {
    const supported = await Linking.canOpenURL(GRAFANA_URL);
    if (supported) await Linking.openURL(GRAFANA_URL);
  };

  // ==========================================
  // EFECTO 1: LECTURA INSTANTÁNEA AL ARRANCAR (OFFLINE)
  // ==========================================
  useEffect(() => {
    const cargarTodoDeCacheInicial = async () => {
      try {
        // --- A) CARGAR INTERIOR INSTANTÁNEO ---
        const cacheInt = await obtenerInteriorCachado();
        if (cacheInt) {
          setMetric(cacheInt);
          if (cacheInt.time) {
            setHoraInterior(cacheInt.time);
          }
          console.log("[Caché Inicial] Datos interiores recuperados.");
        }

        // --- B) CARGAR EXTERIOR INSTANTÁNEO ---
        const ultimaEstacionGuardada = await AsyncStorage.getItem('@ultima_estacion_vista');
        const idemaAAsumir = ultimaEstacionGuardada || "9263D";

        const clave = `${CACHE_KEY_PREFIX}${idemaAAsumir}`; //@clima_cache_${idemaAAsumir}
        const cacheExt = await AsyncStorage.getItem(clave);

        if (cacheExt) {
          const cacheParseada = JSON.parse(cacheExt);
          const datosClima = cacheParseada.datos ? cacheParseada.datos : cacheParseada;
          setWeather(datosClima);

          if (datosClima.time) {
            setHoraExterior(datosClima.time);
          }
        }
        console.log(`[Caché Inicial] Datos exteriores recuperados de: ${idemaAAsumir}`);

      } catch (e) {
        console.error("Error cargando caché inicial:", e);
      }
    };

    cargarTodoDeCacheInicial();
  }, []);

  // ==========================================
  // EFECTO 2: EL BUCLE RED/GPS CADA 30 SEGUNDOS
  // ==========================================
  useEffect(() => {
    let active = true;

    async function fetchMetrics() {
      let idemaObjetivo = "9263D";
      let nombreObjetivo = "PAMPLONA AEROPUERTO";
      let records = [];

      try {
        if (useGPS) {
          let { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            const estacion = obtenerIdemaMasCercano(loc.coords.latitude, loc.coords.longitude);
            idemaObjetivo = estacion.idema;
            nombreObjetivo = estacion.nombre;
          } else {
            console.log("Permiso denegado, usando Pamplona.");
          }
        }

        if (active) {
          setNombreEstacion(nombreObjetivo);
          AsyncStorage.setItem('@ultima_estacion_vista', idemaObjetivo).catch(() => { });
        }

        let data = null;
        let dataAemet = null;

        // A) PETICIÓN DE DATOS INTERIORES
        try {
          const response = await fetch(`${DB_URL}mediciones_iaq.json?auth=${FIREBASE_SECRET}&orderBy="$key"&limitToLast=1`);
          data = await response.json();
        } catch (error) {
          console.log("[Firebase] Sin conexión para datos interiores:", error.message);
        }

        // B) PETICIÓN DE DATOS EXTERIORES
        try {
          const responseAemet = await fetch(`${DB_URL}aemet.json?auth=${FIREBASE_SECRET}&orderBy="$key"&limitToLast=1`);
          dataAemet = await responseAemet.json();
        } catch (error) {
          console.log("[Firebase] Sin conexión para datos de AEMET:", error.message);
        }

        // ==========================================
        // PROCESAR DATOS INTERIORES
        // ==========================================
        if (data) {
          const sortedKeys = Object.keys(data).sort();
          records = sortedKeys.map(key => data[key]);
          const latest = records[records.length - 1];

          if (latest && active) {
            setMetric(latest);
            await guardarInteriorEnCache(latest);
            if (latest.time) {
              setHoraInterior(latest.time);
            }
          }
        }

        // ==========================================
        // C) GESTIÓN INTELIGENTE DEL CLIMA EXTERIOR
        // ==========================================
        if (idemaObjetivo === "9263D") {
          // Caso A: Pamplona -> Nodo aemet.json en Firebase
          let origenDatos = null; // Puede ser 'firebase', 'cache' o 'api'
          let climaParaSetear = null;

          const dosHorasEnMs = 2 * 60 * 60 * 1000;
          const ahora = new Date();

          // 1. EVALUAR PRIMERO LOS DATOS DE FIREBASE
          if (dataAemet) {
            const sortedKeys2 = Object.keys(dataAemet).sort();
            const records2 = sortedKeys2.map(key => dataAemet[key]);
            const latestAemet = records2[records2.length - 1];

            if (latestAemet) {
              const tiempoFirebase = latestAemet.time ?? latestAemet.timestamp ?? null;
              if (tiempoFirebase && (ahora - new Date(tiempoFirebase)) < dosHorasEnMs) {
                origenDatos = 'firebase';
                climaParaSetear = {
                  idema: "9263D",
                  temperatura: latestAemet.temperatura ?? latestAemet.ta ?? NaN,
                  humedad: latestAemet.humedad ?? latestAemet.hr ?? NaN,
                  presion: latestAemet.presion ?? latestAemet.pres ?? NaN,
                  presion_mar: latestAemet.presion_mar ?? latestAemet.pres_nmar ?? NaN,
                  rafaga: latestAemet.rafaga ?? latestAemet.vmax ?? NaN,
                  time: typeof tiempoFirebase === 'number' ? new Date(tiempoFirebase).toISOString() : tiempoFirebase
                };
              }
            }
          }

          // 2. SI FIREBASE ESTÁ CADUCADO, EVALUAR LA CACHÉ LOCAL (AsyncStorage)
          if (!origenDatos) {
            try {
              const cachePamplona = await obtenerClimaCachado("9263D");
              // Usamos la propiedad 'necesitaFetch' que ya tiene programada tu función auxiliar
              if (cachePamplona && !cachePamplona.necesitaFetch && cachePamplona.datos) {
                origenDatos = 'cache';
                climaParaSetear = cachePamplona.datos;
              }
            } catch (err) {
              console.log("[Caché] Error al leer caché local de Pamplona:", err.message);
            }
          }

          // 3. PROCESAR O HACER FETCH SEGÚN EL ORIGEN DETERMINADO
          if (origenDatos === 'firebase') {
            console.log("[Clima] Usando datos frescos de Firebase.");
            if (active) {
              setWeather(climaParaSetear);
              setHoraExterior(climaParaSetear.time);
              guardarClimaEnCache("9263D", climaParaSetear).catch(() => { });
            }
          }
          else if (origenDatos === 'cache') {
            console.log("[Clima] Firebase obsoleto, pero la caché local es reciente. Evitando petición a AEMET.");
            if (active) {
              setWeather(climaParaSetear);
              if (climaParaSetear.time) setHoraExterior(climaParaSetear.time);
            }
          }
          else {
            // Si llegamos aquí, es que Firebase Y la caché local tienen más de 2 horas. Toca pedir a la API.
            try {
              console.log(`[API AEMET] Todo caducado. Petición real a internet para Pamplona.`);

              const aemetUrl = `https://opendata.aemet.es/opendata/api/observacion/convencional/datos/estacion/9263D?api_key=${AEMET_API_KEY}`;
              const aemetRes = await fetch(aemetUrl, { headers: { 'Accept': 'application/json' } });
              const contentType = aemetRes.headers.get("content-type");

              if (!contentType || !contentType.includes("application/json")) {
                throw new Error("La AEMET no ha devuelto un JSON válido");
              }

              const aemetJson = await aemetRes.json();

              if (aemetJson && aemetJson.datos) {
                const dataRes = await fetch(aemetJson.datos);
                const weatherArray = await dataRes.json();
                const latestWeather = weatherArray[weatherArray.length - 1];

                if (latestWeather) {
                  const mapeoClima = {
                    idema: "9263D",
                    temperatura: latestWeather.ta ?? NaN,
                    humedad: latestWeather.hr ?? NaN,
                    presion: latestWeather.pres ?? NaN,
                    presion_mar: latestWeather.pres_nmar ?? NaN,
                    rafaga: latestWeather.vmax ?? NaN,
                    time: latestWeather.fint
                  };

                  // 🌟 CLAVE: Al guardar en caché, 'necesitaFetch' pasará a ser false durante las próximas 2 horas ?? creo que no
                  await guardarClimaEnCache("9263D", mapeoClima);

                  if (active) {
                    setWeather(mapeoClima);
                    if (mapeoClima.time) setHoraExterior(mapeoClima.time);
                  }
                }
              } else {
                throw new Error(aemetJson?.descripcion || "Error en JSON");
              }
            } catch (aemetError) {
              console.warn("Fallo en la API de AEMET para Pamplona, aplicando bloqueo temporal en caché:", aemetError.message);
              
              // 1. Intentamos recuperar lo que hubiera en la caché local
              const cacheEmergencia = await obtenerClimaCachado("9263D");
              
              if (cacheEmergencia && cacheEmergencia.datos) {
                // LA CLAVE: Volvemos a guardar los mismos datos que ya teníamos,
                // pero actualizando el timestamp para que 'necesitaFetch' sea false durante las próximas 2 horas.
                await guardarClimaEnCache("9263D", cacheEmergencia.datos);
                
                if (active) {
                  setWeather(cacheEmergencia.datos);
                  if (cacheEmergencia.datos.time) setHoraExterior(cacheEmergencia.datos.time);
                }
              } else if (dataAemet) {
                // 2. Si la caché local estaba vacía, usamos el dato viejo de Firebase como último recurso
                const sortedKeys2 = Object.keys(dataAemet).sort();
                const latestAemet = dataAemet[sortedKeys2[sortedKeys2.length - 1]];
                
                const climaRescateFirebase = {
                  idema: "9263D",
                  temperatura: latestAemet.temperatura ?? latestAemet.ta ?? NaN,
                  humedad: latestAemet.humedad ?? latestAemet.hr ?? NaN,
                  presion: latestAemet.presion ?? latestAemet.pres ?? NaN,
                  presion_mar: latestAemet.presion_mar ?? latestAemet.pres_nmar ?? NaN,
                  rafaga: latestAemet.rafaga ?? latestAemet.vmax ?? NaN,
                  time: new Date().toISOString() // Le ponemos hora de ahora para silenciar el fetch durante 2h
                };
                
                await guardarClimaEnCache("9263D", climaRescateFirebase);
                if (active) {
                  setWeather(climaRescateFirebase);
                  setHoraExterior(climaRescateFirebase.time);
                }
              }
            }
          }


        } else {
          // Caso B: Fuera de Pamplona -> API de AEMET oficial
          try {
            const cache = await obtenerClimaCachado(idemaObjetivo);

            if (!cache.necesitaFetch && cache.datos) {
              if (active) {
                setWeather(cache.datos);
                if (cache.datos.time) setHoraExterior(cache.datos.time);
              }
            } else {
              console.log(`[API AEMET] Haciendo petición real a internet para: ${nombreObjetivo}`);

              const aemetUrl = `https://opendata.aemet.es/opendata/api/observacion/convencional/datos/estacion/${idemaObjetivo}?api_key=${AEMET_API_KEY}`;
              const aemetRes = await fetch(aemetUrl, { headers: { 'Accept': 'application/json' } });
              const contentType = aemetRes.headers.get("content-type");

              if (!contentType || !contentType.includes("application/json")) {
                throw new Error("La AEMET no ha devuelto un JSON válido");
              }

              const aemetJson = await aemetRes.json();

              if (aemetJson && aemetJson.datos) {
                const dataRes = await fetch(aemetJson.datos);
                const weatherArray = await dataRes.json();
                const latestWeather = weatherArray[weatherArray.length - 1];

                if (latestWeather) {
                  const mapeoClima = {
                    idema: idemaObjetivo,
                    temperatura: latestWeather.ta ?? NaN,
                    humedad: latestWeather.hr ?? NaN,
                    presion: latestWeather.pres ?? NaN,
                    presion_mar: latestWeather.pres_nmar ?? NaN,
                    rafaga: latestWeather.vmax ?? NaN,
                    time: latestWeather.fint // UNIFICADO: Guardamos siempre en 'time' en lugar de 'fint'
                  };

                  await guardarClimaEnCache(idemaObjetivo, mapeoClima);
                  if (active) {
                    setWeather(mapeoClima);
                    if (mapeoClima.time) setHoraExterior(mapeoClima.time);
                  }
                }
              } else {
                throw new Error(aemetJson?.descripcion || "Error en JSON");
              }
            }

          } catch (aemetError) {
            console.warn("Fallo en la petición de la AEMET:", aemetError.message);

            try {
              const cacheDeEmergencia = await obtenerClimaCachado(idemaObjetivo);

              if (cacheDeEmergencia && cacheDeEmergencia.datos) {
                console.log("Rescate de offline exitoso desde AsyncStorage");
                if (active) {
                  setWeather(cacheDeEmergencia.datos);
                  if (cacheDeEmergencia.datos.time) setHoraExterior(cacheDeEmergencia.datos.time);
                }
              } else {
                let backupWeather = null;
                if (records && records.length > 0) {
                  for (let i = records.length - 1; i >= 0; i--) {
                    if (records[i]) {
                      backupWeather = records[i];
                      break;
                    }
                  }
                }

                if (backupWeather && active) {
                  console.log("Rescate desde el historial de Firebase");
                  setWeather(backupWeather);
                  if (backupWeather.time) setHoraExterior(backupWeather.time);
                }
              }
            } catch (cacheError) {
              console.error("Error en el sistema de rescate offline:", cacheError);
            }
          }
        }

        if (active) {
          setError(null);
        }

      } catch (fetchError) {
        if (active) {
          console.error("Fallo general en fetchMetrics:", fetchError);
          setError('No se pudieron actualizar los datos en tiempo real');
        }
      }
    }

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [useGPS]);

  // Formateadores seguros para los renders de fechas
  const renderHoraInterior = () => {
    const t = horaInterior || metric?.time;
    return t ? new Date(t).toLocaleString('es-ES') : 'Sincronizando...';
  };

  const renderHoraExterior = () => {
    const t = horaExterior || weather?.time;
    return t ? new Date(t).toLocaleString('es-ES') : 'Sincronizando...';
  };

  return (
    <SafeAreaProvider style={styles.safeArea}>
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1 }}>

        {currentTab === 'datos' && (
          <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <View style={styles.header}>
              <Text style={styles.title}>Estacion IAQ</Text>
              <Text style={styles.subtitle}>Sensor interior y meteorologia AEMET</Text>

              {/* SELECTOR DE UBICACIÓN VISUAL */}
              <View style={styles.locationSelector}>
                <Pressable
                  style={[styles.selectorBtn, !useGPS && styles.selectorBtnActive]}
                  onPress={() => setUseGPS(false)}
                >
                  <Text style={[styles.selectorBtnText, !useGPS && styles.selectorBtnTextActive]}>📍 Fijo (Pamplona)</Text>
                </Pressable>
                <Pressable
                  style={[styles.selectorBtn, useGPS && styles.selectorBtnActive]}
                  onPress={() => setUseGPS(true)}
                >
                  <Text style={[styles.selectorBtnText, useGPS && styles.selectorBtnTextActive]}>🛰️ Usar GPS móvil</Text>
                </Pressable>
              </View>

              {/* HORA INTERIOR CORREGIDA */}
              <Text style={styles.timestamp}>
                {renderHoraInterior()}
              </Text>

              <View style={styles.bsecContainer}>
                <Text style={styles.bsec}>
                  BSEC: Precision {Number.isFinite(metric?.iaq_accuracy) ? metric.iaq_accuracy : '--'}/3
                </Text>
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>

            {/* CARD IAQ */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Calidad del aire interior</Text>
                <Text style={[styles.badge, { color: iaqLevel.color, backgroundColor: iaqLevel.background }]}>
                  {iaqLevel.label}
                </Text>
              </View>
              <Text style={[styles.bigValue, { color: iaqLevel.color }]}>
                {formatRounded(metric?.iaq)}
              </Text>
              <MetricRow label="IAQ estatico" value={formatRounded(metric?.static_iaq ?? metric?.iaq)} />
              <MetricRow label="CO2 equivalente" value={`${formatRounded(metric?.co2_equivalent)} ppm`} valueStyle={styles.greenText} />
              <MetricRow label="Compuestos bVOC" value={`${formatFixed(metric?.bvoc, 2)} ppm`} valueStyle={styles.cyanText} />
            </View>

            {/* CARD SENSOR INTERIOR */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Sensor interior</Text>
              <Text style={styles.bigValue}>{formatFixed(metric?.temp)} °C</Text>
              <MetricRow label="Humedad relativa" value={`${formatRounded(metric?.humidity)}%`} />
              <MetricRow label="Presion atmosferica" value={`${formatFixed(metric?.pressure_local)} hPa`} />
            </View>

            {/* HORA EXTERIOR TOTALMENTE INDEPENDIENTE */}
            <Text style={styles.timestamp}>
              {renderHoraExterior()}
            </Text>

            {/* CARD EXTERIOR (DINÁMICA POR GPS) */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Exterior AEMET</Text>
                <Text style={styles.location}>{nombreEstacion}</Text>
              </View>
              <Text style={[styles.bigValue, styles.weatherValue]}>
                {weather?.temperatura ? `${formatFixed(weather.temperatura)} °C` : '-- °C'}
              </Text>
              <MetricRow
                label="Rafaga"
                value={`${formatFixed(Number.isFinite(weather?.rafaga) ? weather.rafaga * 3.6 : NaN)} km/h`}
              />
              <MetricRow label="Humedad exterior" value={weather?.humedad ? `${formatRounded(weather.humedad)}%` : '--%'} />
              <MetricRow label="Presion estacion" value={weather?.presion ? `${formatFixed(weather.presion)} hPa` : '-- hPa'} />
              <MetricRow label="Presion nivel mar" value={weather?.presion_mar ? `${formatFixed(weather.presion_mar)} hPa` : '-- hPa'} />
            </View>
          </ScrollView>
        )}

        {/* PESTAÑA CRITERIOS IAQ */}
        {currentTab === 'info' && (
          <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <View style={styles.header}>
              <Text style={styles.title}>Criterios IAQ</Text>
              <Text style={styles.subtitle}>Criterios oficiales de calidad del aire</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.infoCardTitle}>📋 Tabla de Rangos y Acciones Sugeridas</Text>
              <View style={styles.rangoRow}><Text style={[styles.dot, { color: '#22c55e' }]}>●</Text><Text style={styles.rangoText}><Text style={styles.bold}>0 - 50 Excelente:</Text> Aire puro, óptimo para bienestar.</Text></View>
              <View style={styles.rangoRow}><Text style={[styles.dot, { color: '#a3e635' }]}>●</Text><Text style={styles.rangoText}><Text style={styles.bold}>51 - 100 Bueno:</Text> Sin irritación ni impacto en la salud.</Text></View>
              <View style={styles.rangoRow}><Text style={[styles.dot, { color: '#eab308' }]}>●</Text><Text style={styles.rangoText}><Text style={styles.bold}>101 - 150 Ligera Contaminación:</Text> Posible reducción de bienestar. Se sugiere ventilar.</Text></View>
              <View style={styles.rangoRow}><Text style={[styles.dot, { color: '#f97316' }]}>●</Text><Text style={styles.rangoText}><Text style={styles.bold}>151 - 200 Mod. Contaminado:</Text> Posible irritación más significante. Aumentar ventilación con aire limpio.</Text></View>
              <View style={styles.rangoRow}><Text style={[styles.dot, { color: '#ef4444' }]}>●</Text><Text style={styles.rangoText}><Text style={styles.bold}>201 - 250 Muy Contaminado:</Text> Exposición puede causar efectos como cefaleas dependiendo del tipo de VOCs. Optimizar ventilación.</Text></View>
              <View style={styles.rangoRow}><Text style={[styles.dot, { color: '#a855f7' }]}>●</Text><Text style={styles.rangoText}><Text style={styles.bold}>251 - 350 Severo:</Text> Posible mayor problema de salud si hay VOC daño; maximiza la ventilación.</Text></View>
              <View style={styles.rangoRow}><Text style={[styles.dot, { color: '#78350f' }]}>●</Text><Text style={styles.rangoText}><Text style={styles.bold}>&gt; 351 Extremo:</Text> Cefaleas, posibles efectos neurotóxicos adicionales. Evitar presencia en estancia.</Text></View>
            </View>

            <View style={styles.card}>
              <Text style={styles.infoCardTitle}>🔮 IAQ Estático</Text>
              <Text style={styles.descriptionText}>A diferencia del IAQ de tiempo real, el estático ignora variaciones mecánicas bruscas, sirviendo específicamente para analizar tendencias de contaminación estables dentro de una habitación.</Text>
            </View>

            <View style={styles.card}>
              <Text style={[styles.infoCardTitle, { color: '#22e584' }]}>👥 CO₂ equivalente (eCO₂)</Text>
              <Text style={styles.descriptionText}>Estimación del nivel de CO2 en ppm derivada de la correlación media entre COV y CO2 en la exhalación humana. Conviene ventilar al cruzar las <Text style={styles.bold}>1000 ppm</Text>.</Text>
            </View>

            <View style={styles.card}>
              <Text style={[styles.infoCardTitle, { color: '#22d3ee' }]}>🧪 Compuestos bVOC</Text>
              <Text style={styles.descriptionText}>Emisión de gases de la pintura, los muebles y/o la basura, niveles altos de COV por cocinar, consumir alimentos, perfumes, el aliento exhalado y/o el sudor.</Text>
            </View>

            <Pressable style={styles.grafanaButton} onPress={openGrafana}>
              <Text style={styles.grafanaButtonText}>📊 Ver Histórico Completo en Grafana Cloud (Iruñea)</Text>
            </Pressable>
          </ScrollView>
        )}

        <View style={styles.tabBar}>
          <Pressable style={[styles.tabItem, currentTab === 'datos' && styles.tabItemActive]} onPress={() => setCurrentTab('datos')}>
            <Text style={[styles.tabText, currentTab === 'datos' && styles.tabTextActive]}>🏠 Estación</Text>
          </Pressable>
          <Pressable style={[styles.tabItem, currentTab === 'info' && styles.tabItemActive]} onPress={() => setCurrentTab('info')}>
            <Text style={[styles.tabText, currentTab === 'info' && styles.tabTextActive]}>ℹ️ Criterios IAQ</Text>
          </Pressable>
        </View>

      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function MetricRow({ label, value, valueStyle }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, valueStyle]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#020617' },
  screen: { flex: 1, backgroundColor: '#020617' },
  content: { padding: 20, paddingBottom: 24, gap: 16 },
  header: { gap: 6, marginBottom: 4 },
  title: { color: '#5eead4', fontSize: 34, fontWeight: '900' },
  subtitle: { color: '#94a3b8', fontSize: 15 },
  bsecContainer: { alignSelf: 'flex-start', marginTop: 6 },

  locationSelector: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    padding: 4,
    marginTop: 8,
    gap: 4,
  },
  selectorBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  selectorBtnActive: {
    backgroundColor: '#1e293b',
  },
  selectorBtnText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '700',
  },
  selectorBtnTextActive: {
    color: '#5eead4',
  },

  timestamp: { alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#1e293b', borderRadius: 8, color: '#cbd5e1', backgroundColor: '#0f172a', fontVariant: ['tabular-nums'] },
  bsec: { paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#1e293b', borderRadius: 6, color: '#94a3b8', backgroundColor: '#0f172a', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  error: { color: '#fca5a5', fontWeight: '700' },
  card: { gap: 12, padding: 18, borderWidth: 1, borderColor: '#1e293b', borderRadius: 12, backgroundColor: '#0f172a' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cardTitle: { flex: 1, color: '#94a3b8', fontSize: 14, fontWeight: '800', textTransform: 'uppercase' },
  badge: { overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  location: { overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, color: '#22d3ee', backgroundColor: '#083344', fontSize: 12, fontWeight: '800' },
  bigValue: { color: '#e2e8f0', fontSize: 48, fontWeight: '900', fontVariant: ['tabular-nums'] },
  weatherValue: { color: '#22d3ee' },
  metricRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1e293b' },
  metricLabel: { flex: 1, color: '#94a3b8', fontSize: 15 },
  metricValue: { color: '#cbd5e1', fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  greenText: { color: '#22e584' },
  cyanText: { color: '#22d3ee' },

  infoCardTitle: { color: '#cbd5e1', fontSize: 15, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  rangoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 3 },
  dot: { fontSize: 14, lineHeight: 18 },
  rangoText: { color: '#94a3b8', fontSize: 14, flex: 1, lineHeight: 20 },
  descriptionText: { color: '#94a3b8', fontSize: 14, lineHeight: 22 },
  bold: { fontWeight: '700', color: '#e2e8f0' },
  mutedText: { color: '#64748b', fontSize: 13 },
  grafanaButton: { backgroundColor: '#ff730015', borderWidth: 1, borderColor: '#ff7300', paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  grafanaButtonText: { color: '#ff7300', fontSize: 15, fontWeight: '800' },

  tabBar: { flexDirection: 'row', backgroundColor: '#0f172a', borderTopWidth: 1, borderTopColor: '#1e293b', height: 62 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabItemActive: { backgroundColor: '#0f172a', borderTopWidth: 3, borderTopColor: '#5eead4' },
  tabText: { color: '#64748b', fontSize: 13, fontWeight: '700' },
  tabTextActive: { color: '#5eead4', fontWeight: '800' },
});