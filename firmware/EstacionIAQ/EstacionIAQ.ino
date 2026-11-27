#include <WiFi.h>
#include <WiFiMulti.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h> // Librería para https
#include <ArduinoJson.h>
#include <Preferences.h> // Librería nativa para guardar en la Flash
#include "bsec.h"

#include "config.h"

// --- CONFIGURACIÓN ---

const char* DATABASE_URL = CONFIG_DATABASE_URL;
const char* FIREBASE_SECRET = CONFIG_FIREBASE_SECRET;
const char* aemet_key = CONFIG_AEMET_API_KEY;
const char* estacion_id = CONFIG_ESTACION_ID; // Tu código de municipio 9263D, en este caso estación Aeropuerto Noain

const float OFFSET_TEMPERATURA = 0.8; // para calibración de temperatura

// --- OBJETOS GLOBALES DE HARDWARE Y MEMORIA ---
Bsec iaqSensor;
Preferences prefs;
uint8_t bsecState[BSEC_MAX_STATE_BLOB_SIZE] = {0};

WiFiMulti wifiMulti;   // <--- Creamos el objeto ejecutor

// Variables para controlar los tiempos sin bloquear el ESP32
unsigned long ultimaBateria = 0;
unsigned long tiempoEncendidoLED = 0;
bool ledEncendido = false;

const int PIN_LED = 14;

// --- CLIENTES DE RED GLOBALES (REUTILIZABLES) ---
// En lugar de usar un solo clientNet para todo, declara estos dos:
WiFiClientSecure clientAemet;    // Tubería exclusiva para la AEMET
WiFiClientSecure clientFirebase; // Tubería exclusiva para Firebase


// --- GESTIÓN DE TIEMPOS E INTERVALOS (MILLIS) ---
unsigned long previoEnvio = 0;
const long intervaloEnvio = 600000;       // 10 minutos para subir a Firebase

unsigned long ultimoGuardado = 0;
const long intervaloGuardado = 7200000;   // 2 horas para salvar calibración BSEC

int ultimaHoraConsultada = -1;            // Guarda la hora (0-23) de la última petición con éxito

// --- VARIABLES CLIMÁTICAS GLOBALES (MEMORIA CACHÉ) ---
float extTemp = 0.0;
float extHum = 0.0;
float extPres = 0.0;
float extPresMar = 0.0;
float extVelMax = 0.0;
String extTimestamp = "";
uint8_t ultimaPrecisionGuardada = 0;

bool datoAemetNuevo = false; // Nos dice si hay datos de Pamplona listos para enviar

struct tm timeinfo;


// --- DECLARACIÓN DE FUNCIONES ---
void verificarIaqStatus(void);
String obtenerFechaISO(void);
String formatearAEMETaISO(String fechaOriginal);
void cargarEstadoBsec(void);
void guardarEstadoBsec(void);
void actualizarCacheAemet(void);
//void procesarYEnviarDatos(void);
void procesarYEnviarDatosSensor(void);
void procesarYEnviarDatosAemet(void);

// ==========================================
//                   SETUP
// ==========================================
void setup() {

  pinMode(PIN_LED, OUTPUT);

  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- ESTACIÓN IAQ PAMPLONA CON CACHÉ METEOROLÓGICA ---");


  // Acces Points a los que se podría conectar
  wifiMulti.addAP(WIFI_AP_1_SSID, WIFI_AP_1_PASSWORD);
  wifiMulti.addAP(WIFI_AP_2_SSID, WIFI_AP_2_PASSWORD);
  Serial.println("[Wi-Fi] Escaneando y conectando a la mejor red...");

  while (wifiMulti.run() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  //Serial.println("\n[RED] WiFi Conectado de forma correcta.");

  Serial.println("\n[Wi-Fi] ¡Conectado con éxito!");
  Serial.print("[Wi-Fi] Red actual: ");
  Serial.println(WiFi.SSID()); // Te dirá a cuál de ellas se ha conectado
  Serial.print("[Wi-Fi] Dirección IP: ");
  Serial.println(WiFi.localIP());

  // Sincronización horaria NTP
  configTime(0, 0, "pool.ntp.org");

  // Ignorar certificados de forma global para agilizar peticiones HTTPS

  clientAemet.setInsecure();
  clientFirebase.setInsecure();

  // Inicialización del sensor BME680
  iaqSensor.begin(BME68X_I2C_ADDR_HIGH, Wire);
  iaqSensor.setTemperatureOffset(OFFSET_TEMPERATURA);
  cargarEstadoBsec();

  bsec_virtual_sensor_t sensorList[10] = {
    BSEC_OUTPUT_RAW_TEMPERATURE,
    BSEC_OUTPUT_RAW_PRESSURE,
    BSEC_OUTPUT_RAW_HUMIDITY,
    BSEC_OUTPUT_RAW_GAS,
    BSEC_OUTPUT_IAQ,
    BSEC_OUTPUT_STATIC_IAQ,
    BSEC_OUTPUT_CO2_EQUIVALENT,
    BSEC_OUTPUT_BREATH_VOC_EQUIVALENT,
    BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_TEMPERATURE,
    BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_HUMIDITY
  };

  iaqSensor.updateSubscription(sensorList, 10, BSEC_SAMPLE_RATE_LP);
  verificarIaqStatus();

  // Esperamos 2 segundos para asegurar que el reloj NTP reciba la hora de internet
  delay(2000);

  // ESCUDO DE ARRANQUE: Sincronizamos la hora actual en 'ultimaHoraConsultada'
  if (getLocalTime(&timeinfo)) {
    ultimaHoraConsultada = timeinfo.tm_hour;
    Serial.printf("[RELOJ] Hora de inicio detectada: %02d:%02d. Escudo activado.\n", timeinfo.tm_hour, timeinfo.tm_min);
  }

  // Consulta inicial para llenar la caché de Pamplona inmediatamente al arrancar
  actualizarCacheAemet();
}

// ==========================================
//                   LOOP
// ==========================================
void loop() {
  unsigned long currentMillis = millis();
  //GESTION PARA QUE POWERBANK NO SE DESACTIVE, PICO CORRIENTE, CON LED
  if (currentMillis - ultimaBateria >= 8000) { //10000 -> lo bajo a 8000, me cubre en salud, a veces pwb se apaga
    ultimaBateria = currentMillis;

    digitalWrite(PIN_LED, HIGH);
    tiempoEncendidoLED = currentMillis;
    ledEncendido = true;
  }

  if (ledEncendido && (currentMillis - tiempoEncendidoLED >= 1500)) {//2000
    digitalWrite(PIN_LED, LOW);
    ledEncendido = false;
  }


  // 1. Temporizador inteligente de la AEMET por reloj real (Sin duplicados)
  if (getLocalTime(&timeinfo)) {
    int horaActual = timeinfo.tm_hour;
    int minutoActual = timeinfo.tm_min;

    // Si ya estamos en el minuto 35 (o más) de una nueva hora, disparamos la petición
    if (horaActual != ultimaHoraConsultada && minutoActual >= 35) {
      ultimaHoraConsultada = horaActual; // Bloqueamos la hora actual de inmediato
      actualizarCacheAemet();            // Llama a la función limpia de la API
      // Si la descarga fue exitosa y tenemos datos frescos, los envía a Firebase inmediatamente
      if (datoAemetNuevo) {
        procesarYEnviarDatosAemet();
      }
    }
  }

  // 2. Procesamiento del motor analítico BSEC (Frecuencia fijada por Bosch)
  if (iaqSensor.run()) {
    Serial.printf("[BSEC] IAQ: %.0f (Precisión: %d) | CO2 eq: %.0f ppm | Temp: %.1fºC\n",
                  iaqSensor.iaq, iaqSensor.iaqAccuracy, iaqSensor.co2Equivalent, iaqSensor.temperature);

    // Control inteligente del guardado de calibración en la memoria Flash
    if (iaqSensor.iaqAccuracy > ultimaPrecisionGuardada) {
      Serial.printf(">>> [MEMORIA] Incremento de precisión detectado (%d). Salvando...\n", iaqSensor.iaqAccuracy);
      guardarEstadoBsec();
    }
    else if (currentMillis - ultimoGuardado >= intervaloGuardado) {
      ultimoGuardado = currentMillis;
      Serial.println(">>> [MEMORIA] Guardado cíclico preventivo...");
      guardarEstadoBsec();
    }
  } else {
    verificarIaqStatus();
  }

  // 3. Temporizador de envío unificado a Firebase (Cada 10 minutos exactos de reloj)
  if (currentMillis - previoEnvio >= intervaloEnvio) {
    previoEnvio = currentMillis;

    // if (WiFi.status() == WL_CONNECTED) {
    //   procesarYEnviarDatos();
    // }
      // wifiMulti.run() verifica la conexión; si se ha caído, intenta saltar a la otra red guardada

      // 3. Temporizador de envío EXCLUSIVO para el Sensor Interno (Cada 10 minutos)
      if (wifiMulti.run() == WL_CONNECTED) {
        procesarYEnviarDatosSensor(); // <-- Solo envía los datos del BME680
      } else {
        Serial.println("[Wi-Fi] Error: Ninguna de las redes configuradas está al alcance.");
      }
  }
}

// ==========================================
//             FUNCIONES DEL SENSOR
// ==========================================
void verificarIaqStatus(void) {
  if (iaqSensor.bsecStatus != BSEC_OK) {
    if (iaqSensor.bsecStatus < BSEC_OK) {
      Serial.println("BSEC error crítico: " + String(iaqSensor.bsecStatus));
      for (;;);
    }
  }
  if (iaqSensor.bme68xStatus != BME68X_OK) {
    if (iaqSensor.bme68xStatus < BME68X_OK) {
      Serial.println("BME68X error crítico: " + String(iaqSensor.bme68xStatus));
      for (;;);
    }
  }
}

// ==========================================
//          LÓGICA DE OBSERVACIÓN REAL
// ==========================================
void actualizarCacheAemet() {
  //if (WiFi.status() != WL_CONNECTED) return;

   if (wifiMulti.run() != WL_CONNECTED) {
    Serial.println("[AEMET] Envío cancelado: Sin conexión Wi-Fi disponible.");
    return;
  }

  String url_inicial = "https://opendata.aemet.es/opendata/api/observacion/convencional/datos/estacion/" + String(estacion_id);
  HTTPClient http;
  Serial.println("\n[AEMET] Solicitando datos de Pamplona (Paso 1)...");
  http.begin(clientAemet, url_inicial);
  http.addHeader("api_key", aemet_key);
  http.addHeader("cache-control", "no-cache");

  int httpCode = http.GET();

  Serial.printf("[AEMET] Código HTTP Paso 1: %d\n", httpCode);
  if (httpCode == 200) {
    String payload = http.getString();

    JsonDocument docInicial;
    deserializeJson(docInicial, payload);
    String url_datos_reales = docInicial["datos"].as<String>();
    Serial.println("[AEMET] Descargando JSON de observaciones reales (Paso 2)h...");
    http.end();

    if (url_datos_reales != "null" && url_datos_reales.length() > 0) {
      Serial.println("[AEMET] Descargando JSON de observaciones reales (Paso 2)...");
      Serial.print("[AEMET] URL temporal obtenida: if ");
      Serial.println(url_datos_reales);
      http.begin(clientAemet, url_datos_reales);

      int httpCodePaso2 = http.GET();
      Serial.printf("[AEMET] Código HTTP Paso 2: %d\n", httpCodePaso2);
      if (httpCodePaso2 == 200) {
        String payload_clima = http.getString();

        // Parseamos el JSON completo para medir el tamaño del array dinámico
        JsonDocument docClima;
        deserializeJson(docClima, payload_clima);
        Serial.println(docClima.as<String>());
        int total_registros = docClima.size();
        int ultimo = total_registros - 1;

        if (total_registros > 0) {
          // Extraemos los valores del registro más reciente (el del final) o retenemos caché si falla
          extTemp = docClima[ultimo]["ta"] | extTemp;
          extHum = docClima[ultimo]["hr"] | extHum;
          extPres = docClima[ultimo]["pres"] | extPres;
          extPresMar = docClima[ultimo]["pres_nmar"] | extPresMar;
          extVelMax = docClima[ultimo]["vmax"] | extVelMax;
          extTimestamp = docClima[ultimo]["fint"] | extTimestamp;

          extTimestamp = formatearAEMETaISO(extTimestamp);

          datoAemetNuevo = true; // <--- ¡AÑADE ESTO AQUÍ! Indicamos que el dato es fresco

          Serial.printf("[AEMET] Datos actualizados -> Temp: %.1fºC | Hum: %.0f%% | Pres: %.1fhPa | PresMar %.1fhPa | Ráfaga: %.1fºC\n\n",
                        extTemp, extHum, extPres, extPresMar, extVelMax);
        } else {
          Serial.println("[AEMET] El array de datos vino vacío.");
        }
      }
    }
  } else {
    Serial.printf("[AEMET] Error HTTP Paso 1: %d\n", httpCode);
  }
  http.end();
  clientAemet.stop();
}

// ==========================================
//          ENVÍO A FIREBASE
// ==========================================
void procesarYEnviarDatosSensor() {
  Serial.println("[FIREBASE] Preparando envío unificado...");

  // Construcción del documento JSON maestro
  JsonDocument doc;
  doc["time"] = obtenerFechaISO();
  doc["temp"] = iaqSensor.temperature;
  doc["humidity"] = iaqSensor.humidity;
  doc["pressure_local"] = iaqSensor.pressure / 100.0;
  doc["co2_equivalent"] = iaqSensor.co2Equivalent;
  doc["iaq"] = iaqSensor.iaq;
  doc["static_iaq"] = iaqSensor.staticIaq;
  doc["bvoc"] = iaqSensor.breathVocEquivalent;
  doc["iaq_accuracy"] = iaqSensor.iaqAccuracy;

  // // Inyección de la caché del clima exterior de Pamplona
  // doc["clima_exterior"]["temperatura"] = extTemp;
  // doc["clima_exterior"]["humedad"] = extHum;
  // doc["clima_exterior"]["presion"] = extPres;
  // doc["clima_exterior"]["presion_mar"] = extPresMar;
  // doc["clima_exterior"]["rafaga"] = extVelMax;

  String payload;
  serializeJson(doc, payload);

  String urlFirebase = String(DATABASE_URL) + "/mediciones_iaq.json?auth=" + String(FIREBASE_SECRET);

  HTTPClient http;

  if (http.begin(clientFirebase, urlFirebase)) {
    http.addHeader("Content-Type", "application/json");
    int httpCodeFirebase = http.POST(payload);
    Serial.printf("[FIREBASE] Código de respuesta HTTP: %d\n", httpCodeFirebase);
    http.end();
  } else {
    Serial.println("[FIREBASE] No se pudo inicializar la conexión con Firebase.");
  }
  // RECOMENDABLE: Aseguramos el cierre del socket tras terminar el envío
  clientFirebase.stop();
}

void procesarYEnviarDatosAemet() {
  Serial.println("[FIREBASE] Preparando envío aemet...");

  // Construcción del documento JSON
  JsonDocument doc2;


    doc2["temperatura"] = extTemp;
    doc2["humedad"] = extHum;
    doc2["presion"] = extPres;
    doc2["presion_mar"] = extPresMar;
    doc2["rafaga"] = extVelMax;
    doc2["time"] = extTimestamp;

    datoAemetNuevo = false; // Consumimos el dato. El próximo envío irá sin esto.

  String payload2;

  String urlFirebaseExt = String(DATABASE_URL) + "/aemet.json?auth=" + String(FIREBASE_SECRET);

  HTTPClient http;

  serializeJson(doc2, payload2);

  if (http.begin(clientFirebase, urlFirebaseExt)) { // Reutilizamos 'http' cambiando la URL
      http.addHeader("Content-Type", "application/json");
      int httpCodeAemet = http.POST(payload2);
      Serial.printf("[FIREBASE AEMET] Código de respuesta HTTP: %d\n", httpCodeAemet);
      http.end(); // Cerramos la segunda petición
  } else {
      Serial.println("[FIREBASE AEMET] No se pudo inicializar la conexión.");
  }
  // 💡 RECOMENDABLE: Aseguramos el cierre del socket tras terminar el envío
  clientFirebase.stop();
  Serial.println("[FIREBASE AEMET] Socket cerrado y envío finalizado.");
}

// ==========================================
//          MANEJO DE MEMORIA FLASH (NVS)
// ==========================================
void cargarEstadoBsec() {
  prefs.begin("bsec_space", true);
  if (prefs.isKey("state_blob")) {
    prefs.getBytes("state_blob", bsecState, BSEC_MAX_STATE_BLOB_SIZE);
    iaqSensor.setState(bsecState);
    ultimaPrecisionGuardada = prefs.getUChar("precision", 0);
    Serial.printf("[MEMORIA] Calibración cargada. Precisión histórica: %d\n", ultimaPrecisionGuardada);
  } else {
    Serial.println("[MEMORIA] Rodaje inicial limpio.");
  }
  prefs.end();
}

void guardarEstadoBsec() {
  iaqSensor.getState(bsecState);
  prefs.begin("bsec_space", false);
  prefs.putBytes("state_blob", bsecState, BSEC_MAX_STATE_BLOB_SIZE);
  prefs.putUChar("precision", iaqSensor.iaqAccuracy);
  ultimaPrecisionGuardada = iaqSensor.iaqAccuracy;
  prefs.end();
  Serial.println("[MEMORIA] Calibración grabada en el bloque Flash.");
}

// ==========================================
//               RELOJ INTERNO
// ==========================================
String obtenerFechaISO() {
  if (!getLocalTime(&timeinfo)) {
    return "Error_Hora";
  }
  char buffer[30];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buffer);
}

String formatearAEMETaISO(String fechaOriginal) {
  // Busca la posición donde empieza el desfase horario (+0000)
  int indexPlus = fechaOriginal.indexOf('+');

  // Si encuentra el signo '+', recorta el String hasta ahí y le pega la 'Z'
  if (indexPlus != -1) {
    return fechaOriginal.substring(0, indexPlus) + "Z";
  }

  // Si por alguna razón no tuviera el '+', devuelve la cadena original sin romper nada
  return fechaOriginal;
}
