# Propuesta incremental

Estado: Marcos confirma reemplazo progresivo de WDK por Circle en esta rama. No requiere contactar a Rama para continuar. Diseno e implementacion incremental pendientes; este documento no representa codigo implementado.

## Decision de arquitectura propuesta

Conservar las capacidades del agente y reemplazar la integracion WDK por Circle Modular en Arc Testnet. WDK puede coexistir durante la transicion, pero no es un requisito del resultado final. Retirarlo al completar su reemplazo y cobertura. La version Tether se conserva en su rama y tag, no como una dependencia permanente de la app Arc.

Para la primera prueba de Circle, desarrollar una pantalla aislada de cuenta y firma. Posteriormente conectar su autorizacion al servicio comun de conversaciones, adaptando las tools, estados y narracion de voz que sean necesarios. Antes, capturar baseline y ordenar contratos como detalla `04-migration-roadmap.md`.

## Flujo deseado

Pedido -> destinatario validado -> preview persistido -> consentimiento -> autorizacion pendiente -> firma en dispositivo -> envio de UserOperation -> recibo verificado -> resultado.

- La voz y los botones pueden iniciar el mismo pedido y consentimiento.
- La passkey autoriza en el dispositivo. El backend no recibe claves privadas.
- La cuenta emisora, red, token, importe, destinatario y version del preview se vinculan con la operacion firmada.
- Un cambio material exige un nuevo preview y consentimiento.
- La confirmacion verbal inicia el paso de autorizacion, no un broadcast automatico.
- Cancelar es posible antes del envio; no prometer cancelar una operacion ya enviada.
- Un timeout no prueba fallo. Reconciliar el mismo userOpHash y nonce antes de reintentar.

## Contrato logico propuesto

Se extiende el contrato existente, sin inventar endpoints definitivos en esta etapa:

- `confirmation_required`: preview validado, pendiente del consentimiento existente.
- `authorization_required`: operationId, previewId, identidad de cuenta, chainId y expiresAt. Referencia a operacion preparada; nunca claves privadas.
- `submitted`: userOpHash verificado contra la operacion prevista; transactionHash solo cuando exista.
- `confirmed`: recibo de UserOperation exitoso, emisor/EntryPoint/red esperados y transaccion consistente. No alcanza con status exitoso de la transaccion externa del bundler.
- `cancelled`: cancelacion antes de envio comprobada.
- `failed`: rechazo definitivo o reversion verificada.
- `uncertain`: posible envio sin resultado concluyente; impedir segundo gasto automatico.

Estos nombres describen estados del dominio, no nuevos valores ya agregados a `ConversationTurnResult`. La traduccion a HTTP, eventos de voz y estado persistido se concretara en la especificacion.

## Primer incremento de implementacion propuesto

Cuenta y lectura, sin transferencias:

1. Agregar el SDK web Circle en un modulo de frontend aislado.
2. Registrar/iniciar sesion con passkey bajo un dominio definido.
3. Derivar/obtener la direccion de cuenta y mostrar red y saldo real de prueba.
4. Verificar cierre/reapertura de sesion y asociacion de la cuenta, sin almacenar seeds.

La direccion puede existir antes del despliegue onchain de la cuenta; mostrar direccion no prueba despliegue ni capacidad de enviar. Se verificara esa distincion con la version elegida del SDK.

No exige usar los fondos existentes del usuario. Se fondeara la nueva direccion solo mas adelante, tras verificarla, con importe y destino explicitamente autorizados.

## Siguientes incrementos

- Preview, patrocinio y envio firmado con seguimiento persistente y pruebas de fallo.
- Conexion al servicio conversacional compartido, estados y narracion minima de autorizacion.
- Validacion mobile en Capacitor.
- Recuperacion y permisos familiares antes de cualquier uso fuera de pruebas. ENS y Ledger se mantienen fuera de alcance inmediato.

## Condicion para pasar a codigo

Elegir version del SDK, dominio/entorno de prueba y modelo de asociacion de cuenta. Preparar `openspec/` conforme a `AGENTS.md`. La investigacion no instala dependencias, no modifica Circle Console y no autoriza movimientos.
