# Estación IAQ

Aplicación móvil para consultar las mediciones del sensor y datos meteorológicos.

## Requisitos

- Node.js y npm.
- EAS CLI (`eas-cli`) y una cuenta Expo con acceso a EAS Build.

El proyecto usa Expo SDK 58 (ver `package.json`).

## Preparación

```sh
npm install
cp comun/config.local.example.js comun/config.local.js
```

Edita `comun/config.local.js` y sustituye los valores de ejemplo por las credenciales necesarias:

- `FIREBASE_SECRET`
- `AEMET_API_KEY`
- `DB_URL`
- `GRAFANA_URL`


## Ejecutar

```sh
npm start
```

## Compilar APK Android

Inicia sesión en EAS y ejecuta el perfil `preview`, que está configurado para generar un APK de distribución interna:

```sh
eas login
eas build --profile preview --platform android
```

Al terminar, EAS proporciona un enlace para descargar el APK e instalarlo en un dispositivo Android.

## Firmware ESP32

El firmware ESP32 y su documentación de hardware están en [`firmware/EstacionIAQ`](firmware/EstacionIAQ/README.md).

## Grafana

La app puede abrir un dashboard de Grafana Cloud, pero cada clon necesita su propia instancia, fuente de datos y dashboard. Consulta la [guía de configuración de Grafana](grafana/README.md).
