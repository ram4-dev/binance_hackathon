# Nana Wallet: demo escrita en Arc Testnet

Guía para Rama y su agente. Objetivo: levantar en otra computadora una interfaz
guiada que consulta saldo, prepara un micropago y lo envía tras confirmación.
El pago es real en testnet, no un fixture. Esta demo no tiene LLM ni voz y no
reemplaza todavía el backend WDK del producto.

## 1. Requisitos y credenciales

- Node.js 22.18 o posterior y npm.
- Acceso a Internet: Circle y `https://rpc.testnet.arc.io`.
- API key de TEST de la misma cuenta de Circle que contiene las wallets.
- Entity secret existente de esa cuenta: 64 caracteres hexadecimales.
- USDC de prueba en la wallet emisora para el importe y la comisión.

Pedir a Marcos la API key y el entity secret por un canal privado, por ejemplo
un gestor de contraseñas compartido. No hacen falta dos private keys de wallets:
Circle administra la firma de estas wallets developer-controlled. La API key
sola no alcanza para firmar. La key expuesta durante la preparación debe rotarse.
No hacen falta OpenAI, LiveKit, Docker, Postgres, passkeys ni una wallet modular.

Los IDs y direcciones públicos ya están en `config.json`. No copiar las carpetas
privadas ni el diario de transacciones de otra computadora para instalar esto.
No usar credenciales ni fondos de mainnet. La demo comparte wallets con Marcos:
coordinar las pruebas entre operadores, porque los bloqueos son locales, no
distribuidos entre computadoras.

## 2. Instalación desde cero

```sh
git clone https://github.com/theboyplunger0x/nana-wallet.git
cd nana-wallet
git switch main
npm ci --ignore-scripts
npm run demo:arc:configure
```

En el último comando, la persona pega el entity secret en la terminal y presiona
Enter. El prompt oculta el texto. Se guarda únicamente en
`.local/arc-demo/runtime.json`, excluido de Git, con permisos 0600 y carpeta 0700.
El archivo es privado pero no está cifrado. El comando no registra ni rota
secretos en Circle y no sobreescribe una configuración existente.

Si el repositorio ya existe, hacer un pull normal de main sin descartar cambios
locales y ejecutar los comandos npm desde la raíz del backend, no desde
`apps/nana-wallet`. Si hay conflicto, detenerse y resolverlo con la persona.

En la computadora original de Marcos, el servidor también puede leer el
`provisioning.json` privado ya existente. No es necesario configurar de nuevo.

## 3. Arranque

```sh
npm run demo:arc
```

Pegar la API key de test cuando el proceso la solicite y presionar Enter. No se
muestra ni se guarda en disco; se solicita en cada arranque. Nunca incluirla en
una línea de comando, captura, log, README o commit.

Abrir **http://127.0.0.1:8787** y mantener la terminal abierta.
Para detenerlo: Ctrl+C. Solo escucha en localhost. No publicarlo con un túnel,
no cambiar el bind a `0.0.0.0` y no desplegarlo como servicio público: no tiene
autenticación multiusuario ni controles de producción.

## 4. Mostrar el pago

1. Escribir `saldo` o pulsar **Consultar saldo**.
2. Escribir `enviar micropago` o pulsar **Enviar micropago**.
3. Revisar importe, destino, red y comisión en el preview.
4. Solo con autorización humana, escribir `confirmar` o pulsar el botón de
   confirmación. `cancelar` descarta el preview sin enviar.
5. Esperar el estado confirmado. Si sigue pendiente, usar **Verificar estado**.
6. Abrir el hash en Arcscan.

Importe fijo: **0.000001 USDC**. Red fija: **Arc Testnet**, chain ID **5042002**.
La comisión estimada no puede superar 0.1 USDC. No interpretar comandos libres
como otros importes o destinos: esta interfaz admite comandos guiados, no un
agente de lenguaje natural.

| Wallet | Dirección pública |
| --- | --- |
| Emisora | `0x6983977dfa3fd16f8cb3a0e94c797ab4c7f06efc` |
| Receptora | `0x45b8eaeb93139bb31874f830dc66005fd0017eb8` |

La prueba inicial ya está confirmada: [ver transacción en Arcscan](https://testnet.arcscan.app/tx/0xc1176e910751c6851109a62642fbb0e34a105c184dae35c6599bb08964c96bc0).
Una instalación nueva empieza sin historial local. Eso no implica que la prueba
anterior no exista y no autoriza al agente a repetirla automáticamente.

## 5. Instrucciones para el agente que lo levanta

- Leer este archivo antes de ejecutar comandos. Mantener la separación entre
  este servidor aislado y `src/` o `apps/nana-wallet/`.
- Instalar dependencias, ejecutar tests y abrir la interfaz. No solicitar que
  la persona pegue secretos en el chat. La persona los introduce en la terminal.
- **No ejecutar `provision.mjs` ni `send-once.mjs` para este arranque.** Son
  herramientas del setup original, no pasos de instalación para otra máquina.
- No registrar, rotar, reemplazar o inventar un entity secret. No crear wallets
  adicionales ni utilizar claves de otros proyectos.
- Puede consultar saldo y estado. Confirmar un pago requiere aprobación humana
  del importe y destino concretos. Arrancar el servidor no autoriza un pago.
- Nunca borrar `.local/arc-demo/demo.json` para desbloquear un envío. Ese diario
  conserva el resultado y la idempotencia. Nunca crear un nuevo intento tras
  un error ambiguo sin reconciliar primero con Circle y Arc.
- No hacer commit de `.local/`, archivos de entorno, recovery ni secretos.

## 6. Verificación y problemas comunes

```sh
npm run test:arc-demo
```

Estos tests usan dobles locales y no mueven fondos. La comprobación real al
ejecutar la demo valida red, emisor, receptor, importe y receipt exitoso de Arc.
Una aceptación de Circle sola nunca se presenta como confirmación onchain.

| Problema | Acción |
| --- | --- |
| No inicia: falta setup | Ejecutar `demo:arc:configure` con el entity secret existente. |
| `runtime.json` ya existe | No se sobreescribe. Verificar con Marcos qué configuración corresponde. |
| Puerto ocupado o `web.lock` existente | Detener el proceso original con Ctrl+C. Tras un cierre forzoso, comprobar que no queda servidor usando el diario antes de retirar únicamente el lock obsoleto. Nunca borrar el diario. |
| No puede preparar preview | Verificar cuenta/key de TEST, acceso RPC, wallets, balance y límite de comisión. No cambiar las guardas para forzar el envío. |
| Pago pendiente | Consultar estado. No crear otro pago para compensarlo. |
| Estado incierto o rechazado | Detener los envíos y revisar la operación en Circle y Arc con Marcos. No borrar estado ni generar otra clave de idempotencia. |
| Secrets comprometidos | Revocar o rotar con la persona responsable y actualizar la configuración privada; borrar un archivo de Git no elimina su historial. |

El entity secret tiene procedimiento de rotación y recovery propio de Circle.
No basta con cambiar sus 64 caracteres localmente. Conservar el recovery en un
lugar seguro separado. Las wallets de esta demo no deben recibir fondos reales.

## Arquitectura mínima

Interfaz escrita local -> servidor Node -> SDK Circle developer-controlled ->
Arc Testnet -> verificación RPC -> hash confirmado en la interfaz.

Circle resuelve la firma en backend. Por eso esta demostración no necesitó
integrar multisig, recovery modular o passkeys. Esas capacidades y la conexión
con el agente de voz quedan para la integración completa. WDK permanece intacto.
