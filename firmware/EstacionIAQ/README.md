# Firmware ESP32 de Estación IAQ

El sketch `EstacionIAQ.ino` lee un sensor BME680 con Bosch BSEC, consulta observaciones de AEMET para la estación `9263D` y envía mediciones a Firebase Realtime Database.

## Hardware y software

- Placa ESP32.
- Sensor Bosch BME680 conectado por I²C, con dirección alta (`BME68X_I2C_ADDR_HIGH`).
- LED de estado en GPIO 14.
- Arduino core para ESP32, biblioteca Bosch BSEC y ArduinoJson.

Falta completar el diagrama de cableado con los pines SDA/SCL y la alimentación concretos de la placa.

## Configuración

1. Copia `config.example.h` como `config.h`.
2. Rellena las URL y claves de Firebase y AEMET, además de las redes Wi-Fi.
3. Abre `EstacionIAQ.ino` en Arduino IDE, selecciona la placa ESP32 e instala las bibliotecas indicadas.
4. Compila y carga el sketch.

## Funcionamiento

- Envía las mediciones del BME680 a Firebase cada 10 minutos.
- Consulta AEMET al cambiar la hora, a partir del minuto 35.
- Usa `WiFiMulti` para intentar conectarse a dos redes configuradas.

Nota de seguridad: el sketch llama a `setInsecure()` en las conexiones HTTPS, por lo que no valida los certificados TLS. Para un despliegue real, configura la validación de la CA del servidor.
