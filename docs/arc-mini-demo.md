# Arc mini demo

La demo escrita ya envía un micropago real de 0.000001 USDC en Arc Testnet con
preview y confirmación explícita. Es una interfaz de comandos guiados, no un
LLM ni una integración de voz. El producto WDK sigue intacto.

Instalación, credenciales, comandos y troubleshooting:
[README para Rama y su agente](../scripts/arc-demo/README.md).

Prueba confirmada y verificada por RPC:
[transacción en Arcscan](https://testnet.arcscan.app/tx/0xc1176e910751c6851109a62642fbb0e34a105c184dae35c6599bb08964c96bc0).

La API key se lee desde terminal sin eco y vive en memoria. El entity secret,
recovery y diario de ejecución permanecen en `.local/arc-demo/`, fuera de Git.
La configuración pública de las dos wallets está en `scripts/arc-demo/config.json`.
Para ejecutar en otra máquina se comparte la API key y el entity secret por
canal privado; no se requieren dos claves privadas exportadas de wallets.

No se implementaron aún wallet modular, passkeys, multisig ni migración del
proveedor WalletProvider del producto.
