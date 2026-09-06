# Arc + Modular Wallets: primer paso

Fecha: 2026-09-05
Estado: analisis de migracion. Marcos autoriza reemplazar WDK por Circle paso a paso en esta rama, incluyendo frontend, backend y agente. Este incremento solo documenta el analisis; no autoriza movimientos de fondos.
Rama de trabajo: `arc-migration`.

## Objetivo

Migrar Nana a Arc Testnet + USDC + Circle Modular Wallets y retirar WDK del resultado final de esta rama. La version Tether queda preservada en `tether-wdk-stable` y `wdk-demo-v1`. Se pueden modificar todas las capas necesarias de la app aqui, sin depender de coordinacion externa. Mantener la experiencia de voz y sus garantias, adaptando el codigo cuando corresponda.

El usuario informa que dispone de fondos en Arc Testnet. No se verificaron direccion, activo ni saldo. Esta informacion no autoriza conectar una wallet, firmar ni transferir. No hacen falta claves privadas ni frases de recuperacion para planificar.

## Orden de trabajo

1. Revisar aqui el codigo actual y proponer el contrato de integracion y los requisitos de Circle. No depende de contactar a Rama. Sin movimientos.
2. Preparar una prueba web aislada: crear/acceder a una cuenta modular con passkey y mostrar su direccion. Requiere aprobar el diseno y preparar el cambio en `openspec/` antes de implementar.
3. Consultar saldo y preparar un preview. Para fondear la nueva cuenta, el usuario puede enviar un monto pequeno de USDC de prueba desde su wallet existente una vez verificada la direccion.
4. Probar una transferencia pequena a un destinatario verificado, con preview, consentimiento explicito, firma y gas patrocinado. Definir importe y destino antes de cualquier envio.
5. Verificar el mismo flujo en el telefono con Capacitor. Elegir integracion web o puente nativo segun evidencia, sin reescribir la app por anticipado.
6. Disenar recuperacion y permisos familiares antes de habilitar uso fuera de pruebas. ENS, Ledger, bridges y saldo multichain quedan para despues.

El analisis y orden completo del reemplazo estan en `04-migration-roadmap.md`. La migracion de codigo se realiza por incrementos verificables segun el flujo RPI y OpenSpec del repositorio. Las operaciones de wallet siguen requiriendo autorizacion especifica.

## Division propuesta desde el codigo actual

- Rama: voz, interpretacion, desambiguacion, explicacion del preview y comunicacion del resultado.
- Integracion Arc: cuenta, firma desde el dispositivo, estimacion/patrocinio de gas, envio y seguimiento de la operacion.
- Compartido: contrato HTTP y paso de autorizacion. Una confirmacion verbal no sustituye la firma de la passkey.
- Se pueden modificar `src/livekit/` y `src/agent/` si la migracion lo requiere. La primera prueba aislada busca limitar cambios simultaneos, no crear una prohibicion permanente sobre esos archivos.
- No crear paquetes compartidos ni imports entre frontend y backend. Mantener la separacion del repositorio.

## Contrato a definir, no implementado

- Entrada: identidad de cuenta, destinatario verificado y version, importe decimal, activo, red e identificador idempotente.
- Preview: datos exactos a autorizar, costo estimado, patrocinio y vigencia. Vincular la firma con esos mismos datos.
- Estados: esperando firma, cancelado por el usuario, enviado, confirmado, rechazo definitivo y resultado incierto. Se proponen aqui sobre el contrato existente y se documentan para la integracion posterior.
- Identificadores: distinguir la operacion de cuenta (`userOpHash`) de la transaccion (`transactionHash`).
- Revalidar destinatario y preview antes de enviar. Reconciliar resultados inciertos antes de reintentar para evitar pagos duplicados.

## Preguntas del primer paso

- Que version del SDK y de la cuenta modular se usara en Arc Testnet?
- Que Client Key, dominio de passkeys y politica de patrocinio necesita la prueba? Revisar requisitos sin leer ni modificar credenciales existentes.
- Donde se ubica la pantalla aislada para no superponer archivos con Rama?
- Que campos y estados puede consumir hoy el contrato HTTP de Nana y cuales requieren un cambio acordado?
- Como se mantienen la sesion y las credenciales publicas de passkey sin confundirlas con claves privadas?
- Que pruebas en dispositivo decidiran si Capacitor necesita un puente nativo?

## Limites y criterio de salida

- No activar `WDK_TOOLS_SOURCE=live`. Retirar WDK de esta rama cuando sus responsabilidades esten cubiertas por Circle. No modificar la rama ni el tag Tether preservados.
- Sin mainnet, claves privadas, seeds, lectura de secretos o cambios en Circle Console en esta etapa de analisis.
- Sin commit ni push.
- Primer paso terminado cuando exista una propuesta concreta del contrato y una lista de requisitos pendientes. Se trabaja aqui sin esperar coordinacion externa ni afirmar acuerdo con Rama.
- Prueba funcional posterior terminada cuando se observen cuenta, saldo, preview, autorizacion, resultado confirmado y manejo de cancelacion/incertidumbre. Un envio aceptado por una API no es prueba de confirmacion.

## Referencias revisadas

- [Circle Modular Wallets](https://developers.circle.com/wallets/modular)
- [SDK iOS](https://developers.circle.com/sdks/modular/ios-sdk)
- [SDK Android](https://developers.circle.com/sdks/modular/android-sdk)
- [Skills oficiales](https://developers.circle.com/ai/skills): candidatos `use-arc` y `use-modular-wallets`, aun no instalados.
- [Recuperacion de passkeys](https://developers.circle.com/wallets/modular/set-up-passkey-recovery): no asumir que recuperacion equivale a permisos familiares restringidos.
- [Diferencias EVM de Arc](https://docs.arc.io/arc/references/evm-differences.md): distinguir USDC nativo de 18 decimales y su interfaz ERC-20 de 6 decimales sin duplicar el saldo.
