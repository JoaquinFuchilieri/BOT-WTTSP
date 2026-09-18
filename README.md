# 🚀 F-Dispatch Web — Plataforma SaaS de Envíos WhatsApp Multi-Cuenta

Plataforma Web SaaS centralizada para la gestión multi-empresa, multi-operador y automatización de alcance (outreach) masivo controlado en WhatsApp con protección anti-baneo avanzada, motor ligero **Baileys (WebSockets)**, soporte de **Proxies Dedicados e IPs independientes** y arquitectura cliente-servidor lista para despliegue en VPS.

---

## ⚡ Guía Rápida para Levantar el Proyecto Localmente

Si acabás de clonar este repositorio y querés ver la plataforma funcionando en tu computadora:

### 1. Requisitos Previos
- **Node.js** v18 o superior instalado.
- **Git** instalado.

### 2. Pasos de Instalación

1. Abrí una terminal en la carpeta raíz del proyecto y entrá al servidor:
   ```bash
   cd "BOT WTTSP-SERVER"
   ```

2. Creá el archivo de configuración `.env` a partir del ejemplo:
   - En Windows (PowerShell / CMD):
     ```bash
     copy .env.example .env
     ```
   - En Mac / Linux:
     ```bash
     cp .env.example .env
     ```

3. Instalá las dependencias del proyecto:
   ```bash
   npm install
   ```

4. Iniciá el servidor:
   ```bash
   node src/app.js
   ```

5. Abrí tu navegador web en:
   ```text
   http://localhost:3000
   ```

---

## 🔑 Cuentas y Credenciales de Prueba

La base de datos en la nube (PostgreSQL en Railway) ya está pre-cargada con empresas y usuarios de prueba listos para ingresar:

| Rol | Correo Electrónico | Contraseña | ¿Qué podés ver y hacer? |
| :--- | :--- | :--- | :--- |
| **SuperAdmin** | `superadmin@botwttsp.com` | `demo1234` | Directorio de empresas, métricas globales, configuración de límites, auditoría completa y **ajustes de Proxies dedicados** |
| **Administrador** | `admin@demo.com` | `demo1234` | Gestión de operadores de su empresa, distribución masiva de números, reportes ejecutivos, blacklist |
| **Operador** | `operador.test@demo.com` | `demo1234` | Panel de control de sus bots, vinculación por código QR, configuración de mensaje automático y encendido/apagado |

---

## 🏗️ Stack Tecnológico y Arquitectura

- **Frontend:** HTML5, CSS3 moderno (Dark Apple Glassmorphism), JavaScript vanilla (cero frameworks pesados, carga instantánea y fluida).
- **Backend:** Node.js, Express, WebSockets (`ws`), JWT con rotación de tokens.
- **Motor de WhatsApp:** `@whiskeysockets/baileys` (Conexión pura vía WebSockets sin navegadores Chromium, reduciendo el consumo de RAM de 800 MB a ~40 MB por cuenta).
- **Base de Datos:** PostgreSQL en la nube con pool de conexiones transaccionales.
- **Proxies:** Soporte nativo para proxies móviles y residenciales (HTTP/HTTPS y SOCKS5) por cada cuenta de WhatsApp independiente.
