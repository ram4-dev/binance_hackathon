# Mini demo de hoy

El usuario prioriza hablar con Nani, revisar una transferencia minima de USDC,
confirmarla y ver evidencia en Arc Testnet. La migracion completa queda separada.

Actualizacion: el usuario acepta demo escrita sin voz para cerrar hoy y autoriza
commit y luego push a main. Se implementa una interfaz local de comandos guiados,
sin LLM ni LiveKit, con preview y confirmacion. No se presenta como integracion
completa del agente de Nana. La wallet receptora fue creada por pedido del
usuario en su propia cuenta. El usuario autorizo un micropago de 0.000001 USDC.

El rechazo anterior fue HTTP 400, codigo Circle 2: faltaba blockchain al usar
tokenAddress sin tokenId. Se repitio la misma peticion con la misma clave de
idempotencia y se obtuvo el mismo rechazo de validacion. No se obtuvo ID ni hash.
La peticion corregida conservo esa clave de idempotencia y el pago se confirmo.

Decision: wallet de demo controlada por el backend, sin passkeys ni multisig hoy.
El usuario autoriza usar su API key de test y preparar el setup de Circle. El
usuario fondeo la direccion y autorizo el micropago a la receptora creada.

La consulta autenticada de wallets ARC-TESTNET devolvio una lista vacia.
Hello Physical World usa ethers y una clave local, no Circle Wallets.
No copiar las claves de ese proyecto ni de FUD. No rotar un entity secret
existente. Guardar cualquier secreto nuevo fuera de Git con permisos privados.

Implementar primero provisioning reproducible, con errores redactados y sin
repetir creaciones tras un resultado incierto. Despues conectar el proveedor al
flujo de preview y confirmacion existente. Nunca confundir una respuesta
aceptada por Circle con una transaccion confirmada onchain.
