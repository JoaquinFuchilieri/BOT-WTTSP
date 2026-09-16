# 🤖 Bot WhatsApp Desktop — Sistema Automático de Outreach

## 📌 Descripción del Proyecto

Este proyecto es una aplicación de escritorio (Desktop App) diseñada para gestionar envíos automatizados de mensajes de primer contacto (outreach) a través de WhatsApp. Su objetivo principal es permitir la operación simultánea e independiente de múltiples cuentas de WhatsApp (más de 10) desde una sola interfaz, priorizando la seguridad de las cuentas mediante un robusto sistema anti-baneo que simula el comportamiento humano.

La aplicación está optimizada para consumir la menor cantidad de recursos (RAM/CPU) posible, utilizando tecnologías web puras en el frontend y una base de datos local ultrarrápida.

---

## 🏗️ Arquitectura y Stack Tecnológico

El proyecto utiliza un enfoque modular dividiendo la interfaz, el motor del bot y la base de datos:

* **Frontend (Interfaz de Usuario):** HTML, CSS y JavaScript puro. Se descartó el uso de frameworks pesados (como React) para maximizar el rendimiento y minimizar el consumo de RAM al manejar múltiples perfiles.
* **Backend (Proceso Principal):** Node.js empaquetado con **Electron.js**. Electron permite compilar el sistema como una aplicación nativa de escritorio con acceso al sistema de archivos local.
* **Conexión con WhatsApp:** Librería `whatsapp-web.js` utilizando `LocalAuth` para mantener las sesiones persistentes.
* **Base de Datos:** `better-sqlite3`. Se eligió SQLite por ser un motor transaccional robusto que maneja perfectamente la concurrencia, evitando la corrupción de datos que ocurriría al usar simples archivos JSON.
* **Comunicación Interna:** Patrón IPC (Inter-Process Communication) utilizando `contextBridge` y `ipcMain.handle()` para mantener la seguridad entre la interfaz y el backend.

---

## ✨ Características Principales

### 1. Gestión Multi-Cuenta Aislada

* Interfaz inicial similar al gestor de perfiles de Google Chrome.
* Cada perfil (ej. "Cuenta Ventas 1", "Cuenta Soporte") almacena sus credenciales y caché de sesión en su propia carpeta cifrada en el disco (`whatsapp-sessions/session-<id>`).
* Las instancias de WhatsApp operan en contenedores aislados; la caída o desconexión de una cuenta no afecta a las demás.

### 2. Dashboard de Control en Tiempo Real

* **Visor QR Integrado:** Generación de código QR en pantalla la primera vez que se vincula un dispositivo o si la sesión caduca.
* **Importación Masiva:** Carga de números telefónicos mediante archivos (CSV/TXT) o pegado directo.
* **Monitor en Vivo:** Tabla de cola de envíos con scroll virtual y etiquetas visuales de estado (⏳ Pendiente, ✅ Enviado, ❌ Error).
* **Estadísticas en Pantalla:** Contadores de mensajes enviados, pendientes, fallidos, visualización del número procesado actualmente y tiempo restante estimado para la próxima acción.

---

## 🛡️ Motor Anti-Baneo (Core del Bot)

El bot no hace envíos masivos simultáneos (lo cual resultaría en un baneo inmediato). Está programado para ser lento, aleatorio y emular con precisión a un humano escribiendo:

* **Simulación de Escritura:** Antes de enviar el texto, el bot marca el chat como leído (`chat.sendSeen()`) y activa el estado de "escribiendo..." (`chat.sendStateTyping()`). La duración de este estado es proporcional a la longitud del mensaje.
* **Retraso Aleatorio (Delay):** Entre cada mensaje enviado, el sistema espera un tiempo aleatorio de **~2 minutos y 10 segundos** (rango dinámico entre 115 y 145 segundos).
* **Pausa por Lotes (Batching):** Por cada 15 mensajes enviados consecutivamente, el bot entra en un estado de "descanso" aleatorio de **25 a 30 minutos** antes de retomar la cola.
* **Límite Diario:** Existe un tope máximo estricto de **200 mensajes por día, por cuenta**. Este contador se reinicia automáticamente a la medianoche.
* **Detención Limpia:** El motor revisa su estado cada 2 segundos. Si el usuario hace clic en "Apagar Bot", el proceso se detiene inmediatamente sin bloquear la aplicación ni corromper la base de datos.

---

## 🛠️ Correcciones y Estabilidad (Últimos Updates)

* **Protección a prueba de balas (whatsapp-manager.js):** Se implementó un manejo de excepciones silencioso. Si la API web de WhatsApp no devuelve un ID de confirmación pero el mensaje salió, el sistema aplica un *fallback* automático, evitando cuelgues y registrando el envío como 100% exitoso.
* **Sincronización Perfecta de UI:** Si la cola de números se vacía, el bot se auto-detiene, el botón vuelve a su estado inicial ("Encender Bot"), el número en proceso se limpia y se emite la notificación *"Cola vacía. Todos los mensajes fueron enviados ✅"*.
* **Manejo de Errores Activo:** Se agregó el botón **"Reintentar Errores"** para re-encolar con un clic aquellos números que fallaron (ej. problemas de red o números sin WhatsApp temporalmente).

---

## 🚀 Próximas Mejoras (Roadmap Activo)

Actualmente, el sistema elimina los números procesados de la cola y los guarda en un registro histórico para no volver a contactarlos. La próxima actualización (en desarrollo) incluirá:

1. **Flexibilidad de Re-Envío (Campañas Recurrentes):** Se modificará la lógica de la base de datos para que el bot olvide a quién se le envió un mensaje tras finalizar una sesión de envíos. Esto permitirá volver a cargar y contactar a la misma base de clientes en el futuro cuando el usuario lo decida, manteniendo únicamente el contador de "Mensajes totales de hoy" para respetar el límite diario.
2. **Overhaul Visual:** Mejoras estéticas en el frontend para darle un aspecto más moderno y pulido a la interfaz de usuario, optimizando el uso de los espacios y la paleta de colores.

---


## mucha IA
