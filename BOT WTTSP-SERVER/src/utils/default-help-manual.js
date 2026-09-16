// Manual Práctico de Usuario y Operación del Sistema F-Dispatch
// Texto predeterminado de fábrica enfocado en la interacción y opciones del usuario

const DEFAULT_HELP_TITLE = "Manual de Uso e Interacción — F-Dispatch";

const DEFAULT_HELP_CONTENT = `# Manual de Uso e Interacción — F-Dispatch

Bienvenido al manual oficial de usuario de **F-Dispatch**. Esta guía práctica explica paso a paso cómo interactuar con cada pantalla, qué hace cada botón y cómo configurar todas las opciones seleccionables tanto en el **Programa de Escritorio** como en el **Panel Web**.

---

## Índice Rápido
1. [Programa de Escritorio (Desktop Multi-Cuentas)](#1-programa-de-escritorio-desktop-multi-cuentas)
   - 1.1 [Gestor de Cuentas (Pantalla Principal)](#11-gestor-de-cuentas-pantalla-principal)
   - 1.2 [Panel de Control del Bot (Dashboard)](#12-panel-de-control-del-bot-dashboard)
   - 1.3 [Conexión y Vinculación por Código QR](#13-conexión-y-vinculación-por-código-qr)
   - 1.4 [Redacción y Guardado del Mensaje](#14-redacción-y-guardado-del-mensaje)
   - 1.5 [Importación de Números Telefónicos](#15-importación-de-números-telefónicos)
   - 1.6 [Gestión de la Cola de Envíos](#16-gestión-de-la-cola-de-envíos)
2. [Opciones y Retardos de Seguridad (Configuración)](#2-opciones-y-retardos-de-seguridad-configuración)
   - 2.1 [Retardo Mínimo y Máximo (Pausa entre mensajes)](#21-retardo-mínimo-y-máximo-pausa-entre-mensajes)
   - 2.2 [Tamaño de Lote y Pausa Prolongada](#22-tamaño-de-lote-y-pausa-prolongada)
   - 2.3 [Límite Diario de Mensajes](#23-límite-diario-de-mensajes)
   - 2.4 [Interruptor de Horario Laboral](#24-interruptor-de-horario-laboral)
   - 2.5 [Modo Calentamiento Progresivo (Warmup)](#25-modo-calentamiento-progresivo-warmup)
   - 2.6 [Alerta Temprana Anti-Ban (>15% de fallos)](#26-alerta-temprana-anti-ban-15-de-fallos)
3. [Panel Web Centralizado (SaaS)](#3-panel-web-centralizado-saas)
   - 3.1 [Métricas y Reportes de Rendimiento](#31-métricas-y-reportes-de-rendimiento)
   - 3.2 [Gestión de Operadores y sus WhatsApps](#32-gestión-de-operadores-y-sus-whatsapps)
   - 3.3 [Lista de Exclusión (Blacklist)](#33-lista-de-exclusión-blacklist)
   - 3.4 [Bandeja de Anuncios del Sistema](#34-bandeja-de-anuncios-del-sistema)
   - 3.5 [Reportes de Soporte Técnico](#35-reportes-de-soporte-técnico)
   - 3.6 [Registro de Auditoría](#36-registro-de-auditoría)
4. [Buenas Prácticas Anti-Ban para el Operador](#4-buenas-prácticas-anti-ban-para-el-operador)

---

## 1. Programa de Escritorio (Desktop Multi-Cuentas)

### 1.1 Gestor de Cuentas (Pantalla Principal)
Al abrir el programa en tu computadora, verás la pantalla donde administras todas tus líneas de WhatsApp.

- **Botón "+ Agregar nueva cuenta":**
  Abre una ventana emergente para registrar un nuevo número. Solo debes ingresar un nombre identificatorio (por ejemplo: *Ventas 1*, *Soporte*, *Promociones*) y seleccionar a qué operador se asigna la cuenta.
- **Tarjetas de Cuenta:**
  Cada cuenta creada tiene su propia tarjeta con información en tiempo real:
  - **Punto de Estado:** Un círculo verde indica que la sesión de WhatsApp está conectada y lista para enviar. Si está rojo, significa que está desconectada y requiere escanear el código QR.
  - **Botón "Entrar":** Te lleva al panel de control individual de ese número para vincular el QR, cargar el mensaje, importar números y encender los envíos.
  - **Botón "Eliminar":** Borra la cuenta del sistema y elimina los datos de sesión almacenados en el equipo previa confirmación.
  - **Botón "Iniciar / Detener Bot (Play/Pause)":** Permite arrancar o pausar el bot de esa cuenta directamente desde la tarjeta principal, sin necesidad de ingresar al dashboard.
- **Barra de Flota Multi-Bot (Arriba de las tarjetas):**
  - **Botón "Iniciar Flota":** Inicia automáticamente el envío de todas las cuentas que tengan mensajes y números pendientes en cola al mismo tiempo.
  - **Botón "Detener Todos":** Pausa de forma inmediata y segura todos los bots que estén trabajando en paralelo en este equipo.
- **Filtro "Ver WhatsApps de" (Menú desplegable para Administradores):**
  Te permite seleccionar si deseas ver las tarjetas de todas las cuentas de la empresa o únicamente las de un operador específico.
- **Botón "Ayuda":**
  Abre esta guía en una ventana flotante con buscador integrado para resolver cualquier duda al instante.

---

### 1.2 Panel de Control del Bot (Dashboard)
Al presionar **"Entrar"** en cualquier cuenta, accedes a su panel individual:

- **Botón Central "Encender Bot / Apagar Bot":**
  - Al hacer clic en **"Encender Bot"**, el botón cambia a color verde ("Bot Encendido") y comienza a enviar mensajes de la cola de forma automática y secuencial.
  - Al hacer clic en **"Apagar Bot"**, el botón cambia a color rojo ("Bot Apagado") y detiene el proceso de inmediato al finalizar el mensaje en curso, sin perder el progreso ni repetir números.
- **Tarjetas de Estadísticas en Vivo:**
  - **Enviados Hoy:** Cantidad de mensajes entregados exitosamente durante el día de hoy por este número.
  - **Pendientes:** Cantidad de contactos que aún faltan enviar en la cola de espera.
  - **Errores:** Cantidad de números que fallaron (por ejemplo, si el número no tiene WhatsApp o está mal escrito).
  - **Número Actual:** El número de teléfono que se está procesando en este instante.
  - **Estado del Bot:** Muestra si el bot está esperando el retardo, escribiendo, descansando por lote o inactivo.
  - **Próxima Acción / Cuenta Regresiva:** Un cronómetro regresivo en segundos que te indica exactamente cuánto falta para que se despache el próximo mensaje.

---

### 1.3 Conexión y Vinculación por Código QR
En la pestaña lateral **"Conexión QR"**:

1. Haz clic en el botón **"Conectar WhatsApp"**.
2. Aparecerá en pantalla un código QR generado en tiempo real.
3. Abre WhatsApp en tu teléfono celular, ve a **Ajustes (o Configuración) > Dispositivos vinculados > Vincular un dispositivo**.
4. Apunta la cámara de tu celular hacia la pantalla de tu computadora y escanea el código QR.
5. Una vez conectado, el estado cambiará a **"Conectado"** (con un badge verde). La sesión queda guardada de forma permanente en tu máquina, por lo que no tendrás que volver a escanearlo a menos que cierres la sesión manualmente.
6. **Botón "Desvincular WhatsApp / Cerrar Sesión":** Si deseas cambiar de número o desconectar el celular actual, presiona este botón para cerrar la sesión y generar un QR nuevo con otra línea.

---

### 1.4 Redacción y Guardado del Mensaje
En la pestaña lateral **"Mensaje"**:

- **Área de Texto:** Escribe el contenido del mensaje que recibirán los contactos. Puedes incluir saltos de línea, emojis y enlaces web.
- **Botón "Guardar Mensaje":** Guarda el texto redactado en la memoria de la cuenta. Cada cuenta puede tener un mensaje distinto.
- *Recomendación:* Evita mensajes excesivamente largos o con demasiados enlaces para que los receptores no lo perciban como publicidad no deseada.

---

### 1.5 Importación de Números Telefónicos
En la pestaña lateral **"Importar Números"**:

- **Campo de Texto para Pegar:** Puedes pegar una lista de teléfonos copiada desde un Excel o bloc de notas (un número por línea).
- **Subida de Archivos:** Puedes hacer clic en el selector de archivos para cargar directamente un archivo **.TXT**, **.CSV** o **.PDF**. El sistema extraerá automáticamente todos los números válidos.
- **Formato Requerido:** Los números deben incluir el código de país y el prefijo de área (por ejemplo, para Argentina: \`54911xxxxxxxx\`). El sistema limpiará automáticamente guiones, espacios y paréntesis.
- **Botón "Cargar Números":** Procesa la lista, descarta duplicados, verifica que no estén en la Lista de Exclusión (Blacklist) y los añade a la cola de pendientes.
- **Botón "Limpiar Cola":** Si te equivocaste de archivo o deseas reiniciar la lista, este botón vacía todos los números pendientes de la cola.

---

### 1.6 Gestión de la Cola de Envíos
En la pestaña lateral **"Cola de Envíos"**:

- **Tabla de Envíos:** Muestra el listado de números con su estado individual:
  - **Pendiente:** En espera de ser enviado según el orden de llegada.
  - **Enviado:** Mensaje despachado con éxito.
  - **Error:** Fallo en el envío (número inexistente, bloqueado o sin cuenta de WhatsApp).
- **Botón "Reintentar Errores":** Si hubo fallos temporales de conexión, este botón toma todos los números marcados como "Error" y los vuelve a colocar al final de la cola de pendientes para un segundo intento.
- **Botón "Limpiar Errores":** Elimina de la tabla únicamente los números que dieron fallo para mantener tu historial limpio.

---

## 2. Opciones y Retardos de Seguridad (Configuración)
En la pestaña lateral **"Retardos & Límites"** se configuran los parámetros de seguridad más importantes del bot. Estos valores determinan cómo se comporta el envío para proteger la línea contra sanciones de WhatsApp.

### 2.1 Retardo Mínimo y Máximo (Pausa entre mensajes)
- **Retardo Mínimo (segundos):** Valor sugerido: \`115\` segundos.
- **Retardo Máximo (segundos):** Valor sugerido: \`145\` segundos.
- **¿Qué hace?** Entre cada mensaje enviado, el sistema calcula un tiempo de espera aleatorio entre el valor mínimo y el máximo (por ejemplo, 128 segundos, luego 139 segundos, luego 117 segundos). Esto simula el comportamiento de una persona real escribiendo manualmente y evita patrones robóticos predecibles.

### 2.2 Tamaño de Lote y Pausa Prolongada
- **Tamaño de Lote (mensajes):** Valor sugerido: \`15\` mensajes.
- **Pausa de Lote Mínima y Máxima (minutos):** Valor sugerido: \`25\` a \`30\` minutos.
- **¿Qué hace?** Cada vez que el bot completa el envío de un lote (por ejemplo, 15 mensajes seguidos), suspende temporalmente los envíos y hace una pausa prolongada de 25 a 30 minutos. Esto rompe la continuidad del tráfico masivo y replica el descanso habitual de un operador humano.

### 2.3 Límite Diario de Mensajes
- **Límite Diario:** Cantidad máxima de mensajes que este WhatsApp enviará por día (por ejemplo: 200 mensajes).
- **¿Qué hace?** Cuando el contador de "Enviados Hoy" alcanza este valor, el bot se apaga automáticamente hasta el día siguiente para proteger la cuenta.

### 2.4 Interruptor de Horario Laboral
- **Interruptor "Activar Horario Laboral":** Activa o desactiva la restricción de horario.
- **Hora de Inicio y Fin:** Permite definir un rango de operación (por ejemplo: \`09:00\` a \`18:00\`).
- **¿Qué hace?** Si el bot está encendido fuera de este horario (por ejemplo, a las 22:00 hs), pausará automáticamente la cola y reanudará el envío al llegar las 09:00 hs de la mañana siguiente. Evita molestar a los clientes de noche y reduce drásticamente las denuncias por spam.

### 2.5 Modo Calentamiento Progresivo (Warmup)
Ideal para **chips o líneas telefónicas nuevas o recién adquiridas**:
- **Interruptor "Modo Calentamiento":** Enciende este protocolo de seguridad gradual.
- **Día Actual:** Indica en qué día de maduración va la línea (Día 1, Día 2, etc.).
- **Incremento Diario:** Cuántos mensajes adicionales se le permite enviar cada día (por ejemplo: 15 mensajes más por día).
- **Límite Objetivo:** El tope final al que aspiras llegar (por ejemplo: 200 mensajes).
- **¿Qué hace?** Un chip nuevo no debe mandar 200 mensajes el primer día. Con este modo, el Día 1 mandará solo 15 mensajes, el Día 2 enviará 30, el Día 3 enviará 45, y así sucesivamente hasta alcanzar la meta sin despertar sospechas en los algoritmos de WhatsApp.

### 2.6 Alerta Temprana Anti-Ban (>15% de fallos)
- **¿Qué hace?** Si el sistema detecta que más del 15% de los últimos mensajes dieron error consecutivamente, asume que la base de datos es deficiente o que la línea está teniendo inconvenientes técnicos. Para evitar que sigas enviando a números no válidos y dañes la reputación del chip, **el bot frena la cola automáticamente y muestra un banner rojo de alerta**.
- **Botón "Reanudar Cola":** Una vez que verifiques tu conexión, tu teléfono y la calidad de tus números, presiona este botón para desactivar la alerta y continuar con los envíos.

---

## 3. Panel Web Centralizado (SaaS)
El panel web te permite supervisar la operación de todo tu equipo de trabajo desde cualquier navegador (computadora, tablet o celular).

### 3.1 Métricas y Reportes de Rendimiento
- **Tarjetas Superiores (KPIs):**
  - **Mensajes Hoy:** Total de mensajes enviados hoy por todos los operadores de tu empresa.
  - **Total Histórico:** Mensajes acumulados desde el primer día.
  - **En Cola Pendientes:** Contactos en espera en todas las líneas.
  - **WhatsApps Conectados vs Desconectados:** Estado de conexión de toda la flota de tu empresa.
- **Tabla "Comparativa entre Operadores":** Muestra el rendimiento de cada usuario de tu equipo: cuántos mensajes envió hoy, total acumulado, cantidad de fallos y porcentaje de entrega efectiva.
- **Módulo de Reportes Ejecutivos:**
  - **Filtros Seleccionables:** Puedes filtrar registros por fecha (*Desde / Hasta*), por *Operador* y por *Resultado* (Enviado o Fallido).
  - **Botón "Aplicar Filtros":** Actualiza la tabla inferior con los resultados solicitados.
  - **Botón "Exportar CSV":** Descarga una planilla de cálculo Excel/CSV con el detalle de cada mensaje (número, fecha, hora, operador, estado).
  - **Botón "Exportar PDF":** Genera un informe en PDF listo para imprimir o presentar a gerencia.

### 3.2 Gestión de Operadores y sus WhatsApps
En la pestaña **"Operadores"**:
- **Botón "+ Nuevo Operador":** Abre el formulario para crear un nuevo acceso con correo y contraseña para un integrante de tu equipo.
- **Botón "Pausar / Activar":** Permite suspender temporalmente el acceso de un operador sin borrar su historial ni sus cuentas.
- **Botón "Ver WhatsApps":** Despliega la lista de todas las líneas de WhatsApp que pertenecen a ese operador.
- **Configuración de WhatsApp (Ícono Engranaje Sliders):**
  Te permite modificar de forma remota desde la web los límites diarios, el horario laboral y el modo de calentamiento de cualquiera de las cuentas de WhatsApp vinculadas.

### 3.3 Lista de Exclusión (Blacklist)
En la pestaña **"Lista de Exclusión"**:
- **¿Para qué sirve?** Cualquier número cargado en esta lista será bloqueado por el sistema de forma preventiva. Aunque un operador suba accidentalmente un archivo con ese número, el bot lo omitirá automáticamente.
- **Botón "+ Agregar Número a Exclusión":** Permite ingresar el número telefónico y el motivo (por ejemplo: *Cliente solicitó baja*, *Número erróneo*).
- **Buscador y Botón "Eliminar":** Permite buscar un número en la lista y quitarlo si en el futuro vuelve a ser un cliente habilitado.

### 3.4 Bandeja de Anuncios del Sistema
- **Botón / Ícono "Anuncios" (en la barra superior):**
  Muestra un punto rojo pulsante cuando hay comunicados oficiales o avisos importantes.
- **Bandeja de Anuncios:**
  Al hacer clic, puedes leer los comunicados detallados, novedades de software y avisos de mantenimiento. Al abrir un anuncio, se marca como leído automáticamente.

### 3.5 Reportes de Soporte Técnico
En la pestaña **"Reportes de Soporte"**:
- **Formulario de Contacto:** Permite escribir un ticket de consulta técnica si tienes dudas sobre el servicio o necesitas asistencia.
- **Historial de Tickets:** Te permite consultar el estado de tus consultas y las respuestas recibidas.

### 3.6 Registro de Auditoría
En la pestaña **"Auditoría"**:
- Muestra una bitácora cronológica inalterable de todos los eventos relevantes ocurridos en tu empresa: inicios de sesión, cambios de contraseña, creación de operadores, edición de configuraciones y modificaciones en la lista de exclusión, indicando fecha, hora, usuario e IP.

---

## 4. Buenas Prácticas Anti-Ban para el Operador
Para mantener tus líneas de WhatsApp saludables y evitar suspensiones temporales o definitivas, sigue siempre estas reglas de oro:

1. **Nunca apresures el bot:** Mantén los retardos entre 115 y 145 segundos. Enviar mensajes cada 5 o 10 segundos es la causa número uno de bloqueos inmediatos por parte de WhatsApp.
2. **Usa el Modo Calentamiento en chips nuevos:** Un chip nuevo no tiene reputación. Empieza con 15 mensajes diarios y aumenta progresivamente a lo largo de 2 a 3 semanas.
3. **Calidad antes que cantidad:** Verifica que tus bases de datos contengan números reales y activos. Si envías a cientos de números inexistentes, WhatsApp detectará actividad sospechosa y activará la Alerta Temprana.
4. **Respeta los horarios:** No envíes mensajes fuera del horario laboral. Los contactos contactados de noche o en fines de semana tienen diez veces más probabilidades de presionar el botón "Reportar como Spam".
5. **Redacta mensajes cordiales:** Incluye siempre un saludo cordial y una forma clara de identificación de tu empresa. Si un cliente no desea recibir más información, agrégalo inmediatamente a la **Lista de Exclusión (Blacklist)**.
6. **Distribuye el volumen:** Si necesitas enviar 1.000 mensajes diarios, es mucho más seguro utilizar 5 cuentas de WhatsApp con 200 mensajes cada una, que forzar una sola cuenta con 1.000 mensajes.
`;

function filterManualForDesktop(md) {
  if (!md) return '';
  let res = md;

  // 1. Clean intro sentence mentioning Panel Web
  res = res.replace(/tanto\s+en\s+el\s+\*?\*?Programa\s+de\s+Escritorio\*?\*?\s+como\s+en\s+el\s+\*?\*?Panel\s+Web\*?\*?\./gi, 'en el **Programa de Escritorio**.');
  res = res.replace(/\s*como\s+en\s+el\s+\*?\*?Panel\s+Web\*?\*?\./gi, '.');

  // 2. Remove Section 3 (Panel Web) and any sub-items from Table of Contents
  res = res.replace(/^\s*3\.\s*\[.*?(?:web|panel|saas).*?\].*?\n(?:\s+-\s*3\.\d+.*?\n)*/gim, '');

  // 3. Renumber Section 4 in Table of Contents to Section 3
  res = res.replace(/^\s*4\.\s*\[(.*?)\]\((#.*?)\)/gim, (match, title, anchor) => {
    const cleanTitle = title.replace(/^4\.\s*/, '3. ');
    const cleanAnchor = anchor.replace(/#4-/, '#3-');
    return `3. [${cleanTitle}](${cleanAnchor})`;
  });

  // 4. Remove the entire Section 3 content (from ## 3. Panel Web up to ## 4. or next ##)
  res = res.replace(/(?:---\s*\n+)?##\s*3\.\s*.*?(?:panel|web|saas)[\s\S]*?(?=(?:---\s*\n+)?##\s*4\.)/gi, '');
  res = res.replace(/(?:---\s*\n+)?##\s*3\.\s*.*?(?:panel|web|saas)[\s\S]*?(?=(?:---\s*\n+)?##\s*\d+|$)/gi, '');

  // 5. Renumber Section 4 heading to Section 3
  res = res.replace(/##\s*4\.\s*/g, '## 3. ');

  // 6. Clean duplicate separators
  res = res.replace(/---\s*\n\s*---\s*\n/g, '---\n');

  return res.trim();
}

module.exports = {
  DEFAULT_HELP_TITLE,
  DEFAULT_HELP_CONTENT,
  filterManualForDesktop
};
