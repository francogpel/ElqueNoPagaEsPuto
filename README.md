# Dividir Gastos — v3

App para dividir gastos entre participantes, con:
- Login de administrador (Google o email/contraseña vía Firebase)
- Conexión OAuth con Mercado Pago (los pagos van directo a la cuenta del admin)
- Rueda visual de estado de pagos en tiempo real
- Historial de salas (abiertas / cerradas)
- Marcado manual de pagos en efectivo con confirmación

## Instalación rápida

```bash
npm install
cp .env.example .env
# completá .env con tus credenciales (ver GUIA_DESPLIEGUE.txt)
npm start
```

## Estructura

```
cena-app-v3/
├── server.js          → Backend Express (rutas, OAuth MP, webhook, Firebase Admin)
├── package.json        → Dependencias
├── .env.example         → Plantilla de variables de entorno (copiar a .env)
├── public/
│   └── index.html      → Frontend completo (SPA sin frameworks)
└── GUIA_DESPLIEGUE.txt  → Pasos detallados para desplegar en producción
```

## Dónde está cada configuración en el código

| Qué necesitás configurar          | Archivo         | Variable / línea aprox.                          |
|------------------------------------|-----------------|---------------------------------------------------|
| Token de Mercado Pago (fallback)  | `.env`          | `MP_ACCESS_TOKEN`                                  |
| Client ID/Secret OAuth de MP      | `.env`          | `MP_CLIENT_ID`, `MP_CLIENT_SECRET`                 |
| URL de redirección OAuth MP       | Panel de MP     | Debe ser `{PUBLIC_URL}/api/mp-oauth/callback`      |
| Firebase config (frontend)        | `.env`          | `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID` |
| Firebase Service Account (backend)| `.env`          | `FIREBASE_SERVICE_ACCOUNT_JSON`                    |
| URL pública del servidor           | `.env`          | `PUBLIC_URL`                                       |

Ver **GUIA_DESPLIEGUE.txt** para el paso a paso completo, en orden, sin saltarse nada.
