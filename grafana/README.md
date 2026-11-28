# Conectar Grafana con Firebase Realtime Database

Esta guía describe cómo crear una fuente de datos propia. El repositorio no incluye acceso a la instancia de Grafana Cloud del autor ni credenciales.

## 1. Crear la fuente de datos

1. En Grafana, abre **Connections → Data sources → Add data source** y selecciona **Infinity**. En Grafana Cloud comprueba si ya está disponible; en una instalación propia, instálalo desde el catálogo de plugins.
2. Configura la conexión con el host de tu Firebase Realtime Database, por ejemplo `https://<tu-base-de-datos>.<region>.firebasedatabase.app`.
3. Guarda y prueba la conexión.

Infinity permite consultar APIs REST que devuelven JSON. Firebase Realtime Database expone cada ruta como REST añadiendo `.json`.

## 2. Consultar las mediciones

El firmware escribe dos rutas:

- `GET https://<tu-host>/mediciones_iaq.json`
- `GET https://<tu-host>/aemet.json`

En cada consulta de Infinity, usa el origen **URL**, método **GET**, formato **JSON** y el endpoint correspondiente. Firebase guarda estas mediciones como objetos indexados por claves generadas; para convertirlos en filas en Infinity, selecciona el parser **JQ** y usa:

```jq
to_entries | map(.value + {id: .key})
```

La ruta `mediciones_iaq` contiene `time`, `temp`, `humidity`, `pressure_local`, `co2_equivalent`, `iaq`, `static_iaq`, `bvoc` e `iaq_accuracy`. La ruta `aemet` contiene `time`, `temperatura`, `humedad`, `presion`, `presion_mar` y `rafaga`.

Usa `time` como campo temporal de los paneles. Para mostrar todo el histórico, no añadas el parámetro `limitToLast=1` que usa la app al consultar el último dato.

## 3. Acceso a Firebase

Firebase permite leer por REST sin autenticación únicamente cuando sus reglas autorizan la lectura pública. Para datos privados, configura la autenticación en la fuente de datos de Infinity. Si la autenticación requiere el parámetro `auth`, configúralo como API key de tipo **Query** en los ajustes de la fuente, donde Infinity guarda el valor de forma segura; no lo escribas en la URL de cada panel ni en el JSON exportado.

No uses en una demo pública una credencial de administrador o una clave de larga duración. Para una demostración reproducible, crea una base de datos de prueba con permisos de solo lectura adecuados. Firebase recomienda migrar las credenciales legacy a sus métodos actuales de autenticación.

## 4. Compartir el dashboard

Después de crear los paneles, exporta el dashboard como JSON y guárdalo en esta carpeta. Al importarlo, quien clone el repo deberá seleccionar su propia fuente de datos Infinity. No incluyas credenciales en el JSON.

La configuración de alertas y sus destinos de notificación también pertenece a cada instancia de Grafana; exporta y documenta esas reglas por separado si forman parte de la demo. Nunca publiques tokens de Telegram, chat IDs ni webhooks.

## Referencias

- [Infinity: instalación](https://grafana.com/docs/plugins/yesoreyeram-infinity-datasource/latest/installation/)
- [Infinity: configuración de fuente de datos y autenticación](https://grafana.com/docs/plugins/yesoreyeram-infinity-datasource/latest/configure/)
- [Firebase: API REST de Realtime Database](https://firebase.google.com/docs/reference/rest/database)
- [Firebase: autenticación REST](https://firebase.google.com/docs/database/rest/auth)
