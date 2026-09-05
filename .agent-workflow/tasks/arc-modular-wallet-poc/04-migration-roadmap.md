# Reemplazo progresivo de WDK por Circle

Fecha: 2026-09-05
Alcance confirmado: toda la app en `arc-migration`, por incrementos. Tether preservado en su rama y tag. El objetivo no es mantener dos proveedores para siempre.

## Resultado esperado

Nana con cuenta Circle Modular en Arc Testnet, USDC, passkeys, saldo e historial reales, preview y consentimiento explicitos, firma desde el dispositivo, gas patrocinado cuando corresponda y resultados verificados. Voz, texto y pantalla financiera reflejan la misma cuenta y las mismas operaciones. Sin dependencia de WDK en el runtime final.

## Etapa 0: baseline y entorno independiente

- Preparar el cambio OpenSpec con este alcance y actualizar su contexto WDK-only.
- Instalar dependencias existentes con lockfiles de forma controlada; revisar scripts antes de ejecutarlos. Actualmente no hay dependencias instaladas en el worktree.
- Ejecutar lint, typecheck, tests y evals de baseline. Separar fallos previos de fallos de migracion.
- Usar base de pruebas, puertos y configuracion propios. No reutilizar a ciegas `.env`, Supabase remoto ni procesos de la demo Tether.
- Identificar rutas financieras reales frente a mocks. Definir modo de datos explicito para que una demo Arc no muestre pagos bancarios ficticios como reales.

Salida: baseline registrado y entorno de migracion aislado. No movimientos.

## Etapa 1: contrato financiero independiente de WDK

- Separar configuracion de red/activo/cuenta de `WDK_*`.
- Centralizar politica de importes, destinatarios y activos sin debilitar guardas.
- Evitar conversion semantica de USDT a USDC: pedido de activo no soportado exige aclaracion/rechazo.
- Definir estados de autorizacion pendiente y operacion enviada; idempotencia, expiracion y cuenta emisora.
- Extender tipos HTTP y espejo frontend, persistencia e indices SQL mediante migraciones nuevas.
- Cubrir el nuevo contrato con proveedor de prueba sin red. No conservar un fallback silencioso a WDK en la configuracion Circle.

Salida: flujo completo simulado con espera de firma, cancelacion, resultado incierto y proteccion contra duplicados. Las suites existentes mantienen sus garantias.

## Etapa 2: cuenta Circle, passkey y saldo

- Elegir y fijar version de `@circle-fin/modular-wallets-core` y `viem` tras revisar compatibilidad.
- Configurar Arc Testnet y dominio de passkeys en el entorno de prueba; mantener claves privadas fuera del backend.
- Resolver la asociacion entre usuario autenticado y cuenta. Una passkey de wallet no es por si sola la sesion de API de Nana. Probar control, aislamiento y restauracion de sesion.
- Crear/acceder a cuenta desde un modulo frontend aislado; distinguir direccion derivada de contrato desplegado.
- Mostrar direccion y saldo real sin MSW en ese flujo. No sumar vistas nativa y ERC-20 de USDC como activos distintos.

Salida: misma cuenta tras recarga y sesion restaurada, saldo comprobable. No envio requerido para validar la pantalla de lectura.

## Etapa 3: envio firmado y seguimiento

- Construir la UserOperation vinculada al preview e identidad autenticada. Concretar en la especificacion quien prepara, valida y transmite.
- Integrar patrocinio, limites de cuota y errores de paymaster. No pasar silenciosamente de gas patrocinado a cobro al usuario.
- Solicitar firma en el dispositivo. Persistir el identificador esperado y estado suficiente para reconciliar un envio aunque se pierda la respuesta.
- Verificar resultado onchain desde fuente independiente del callback del navegador: red, cuenta, operacion, exito de ejecucion y transaccion.
- Probar doble clic, voz y boton simultaneos, cambio de destinatario, preview vencido, passkey cancelada, navegador cerrado, timeout y reinicio de backend.
- Solo despues, un envio testnet pequeno con importe/destino verificados y consentimiento explicito. Los fondos existentes de Marcos no son presupuesto para ejecucion automatica.

Salida: transferencia verificada y recuperacion del estado ante fallos sin repetir gasto.

## Etapa 4: integrar la app completa

- Conectar voz/texto al mismo ciclo de autorizacion sin conservar caminos alternativos de broadcast WDK.
- Agregar estado de espera de firma y narracion correcta: confirmar verbalmente no significa enviado.
- Adaptar Mi plata a USDC y movimientos reales, unificando contrato API y tratamiento de errores. Funciones bancarias no implementadas deben quedar claramente fuera del flujo real.
- Validar destinatarios para Arc y coherencia de contactos de UI con memoria del agente.
- Probar web y Capacitor con sus transportes de voz reales. Usar SDK nativo mediante puente solo si la prueba web no cubre las necesidades.

Salida: voz, botones, saldo e historial muestran la misma realidad financiera.

## Etapa 5: retirar WDK de esta rama

- Eliminar proveedor, cliente MCP WDK, herramientas legadas y fallbacks cuando ningun camino activo los necesite.
- Retirar dependencias `@tetherto/*`, permisos de scripts e imports exclusivos; revisar MCP antes de eliminar paquetes. Mantener dependencias de voz usadas, como `tar-stream`.
- Migrar pruebas utiles a Circle/contrato neutral. Retirar solo pruebas especificas de una integracion ya eliminada, no guardas de seguridad.
- Actualizar fixtures, scripts, health, variables de ejemplo, runbooks, CI y contexto del repositorio.
- No hacer reemplazos en migraciones historicas ni borrar datos. Nuevas migraciones preservan trazabilidad y explicitan red de operaciones previas.
- Verificar por busqueda que no hay dependencias ejecutables de WDK ni referencias Sepolia/USDT en el camino Arc. Las referencias historicas documentadas pueden permanecer.

Salida: instalacion limpia, build, lint, typecheck, tests, evals y recorrido visual completo de la app Arc. Tether continua disponible en su rama/tag.

## Posterior al reemplazo basico

Recuperacion segura y reglas familiares antes de uso fuera de pruebas. ENS, Ledger y bridges se evaluan despues. No prometer que multisig o recovery estandar equivalen al modelo de proteccion familiar deseado.

## Proximo incremento

Etapa 0: preparar especificacion de migracion y capturar baseline en un entorno aislado. No hace falta coordinar con Rama ni usar los fondos de Arc para esto. Todavia no se ejecutaron instalaciones, pruebas ni operaciones onchain.
