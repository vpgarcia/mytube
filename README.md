# MyTube

App para que un niño vea **solo** los videos de YouTube que elige un adulto.
Funciona en iPad, iPhone y Android como app instalada (PWA), sin App Store.

- **Pantalla del niño:** miniaturas grandes de los videos aprobados, agrupados en carpetas con
  dibujos. Sin buscador, sin videos relacionados, sin enlaces a YouTube.
- **Reproductor bloqueado:** una capa invisible impide tocar el logo, el título o las
  sugerencias de YouTube. Botones propios: anterior, play/pausa, siguiente y barra de avance.
- **Reproducción continua** (opcional por perfil): al terminar, cuenta atrás y siguiente video.
- **Sigue donde lo dejó:** cada video se retoma en el punto en que se cerró.
- **Perfiles:** varios niños, cada uno con su lista, su dibujo, su límite y su horario.
- **Límite de tiempo diario y horario permitido:** al acabarse, pantalla de «¡Hasta mañana!».
  Con el PIN se puede dar tiempo extra para ese día.
- **Actividad:** minutos por día de la última semana y qué videos ha visto hoy.
- **Modo padre:** se entra manteniendo pulsado el candado (abajo a la derecha) e
  introduciendo un PIN. Desde ahí se añaden videos (sueltos, listas de reproducción enteras o
  canales `youtube.com/channel/UC…`), se ordenan, se programan para una fecha y se organizan.
- **Videos caídos:** la app detecta los videos borrados o que ya no se pueden incrustar, los
  oculta al niño y avisa en el modo padre.
- **Sincronización:** la lista se gestiona desde el móvil del adulto y aparece al
  instante en el iPad del niño (requiere Firebase, ver abajo).
- **Compartir desde YouTube:** en Android, *Compartir → MyTube*. En iPhone, con un atajo
  (instrucciones dentro del modo padre).

## Puesta en marcha

### 1. Publicar la app (GitHub Pages, gratis)

1. En GitHub, abre el repositorio → **Settings → Pages**.
2. En **Source**, elige **GitHub Actions**.
3. Cada vez que se sube un cambio a `main`, la app se publica sola en
   `https://vpgarcia.github.io/mytube/`.

### 2. Activar la sincronización entre dispositivos (Firebase, gratis)

Sin este paso la app funciona igual, pero la lista solo vive en el dispositivo donde
se crea.

1. Entra en <https://console.firebase.google.com> y pulsa **Crear un proyecto**
   (Google Analytics no hace falta).
2. En el menú: **Compilación → Firestore Database → Crear base de datos**.
   Elige una ubicación cercana (p. ej. `eur3`) y **modo de producción**.
3. En la pestaña **Reglas** de Firestore, pega el contenido de
   [`firestore.rules`](firestore.rules) y pulsa **Publicar**. Si actualizas la app y el
   archivo de reglas ha cambiado, vuelve a pegarlo.
4. Ve a **Configuración del proyecto** (rueda dentada) → **Tus apps** → icono **`</>`**
   (Web). Ponle un nombre y regístrala (no hace falta Hosting).
5. Copia el objeto `firebaseConfig` que aparece y pégalo en
   [`js/config.js`](js/config.js) en lugar de `null`.

> Los datos de `firebaseConfig` no son secretos: Firebase está pensado para que vayan
> en la web. Lo que protege la lista son las reglas del paso 3 y el código de familia.

### 3. Instalar en cada dispositivo

1. Abre `https://vpgarcia.github.io/mytube/` en el **primer** dispositivo y pulsa
   **Crear una lista nueva**. Elige un PIN.
2. En **Modo padre → Otros dispositivos**, pulsa **Compartir enlace** y envíalo a los
   demás dispositivos (WhatsApp, AirDrop, correo…). Al abrirlo se unen a la misma lista.
3. Añádela a la pantalla de inicio en cada uno:
   - **iPad / iPhone (Safari):** botón Compartir → **Añadir a pantalla de inicio**.
   - **Android (Chrome):** menú ⋮ → **Instalar aplicación** (o *Añadir a pantalla de inicio*).

### 4. Que el niño no pueda salir de la app

- **iPad:** Ajustes → Accesibilidad → **Acceso guiado** → activar y poner código.
  Abre MyTube y pulsa tres veces el botón superior (o el de inicio).
- **Android:** Ajustes → Seguridad → **Fijar aplicaciones**. Abre MyTube, ve a
  Recientes, toca el icono de la app → **Fijar**.

## Limitaciones conocidas

- **Anuncios:** si el autor del video tiene anuncios, se verán. Quitarlos va contra
  las condiciones de YouTube.
- **Videos que no se pueden incrustar:** algunos autores no permiten ver sus videos
  fuera de YouTube. La app lo detecta al añadirlos y avisa.
- **iPhone/iPad:** iOS no permite que un video empiece solo con sonido. La primera vez
  el niño toca el botón ▶ del centro; esa es la única zona que se deja tocar, y solo
  hasta que empieza el video.
- **PIN olvidado:** en la pantalla del PIN, *¿Olvidaste el PIN?* pide resolver una
  multiplicación y permite elegir uno nuevo.
- **Sin conexión:** la app abre, pero los videos necesitan internet (descargarlos va
  contra las condiciones de YouTube).

## Desarrollo

No hay paso de compilación: es HTML, CSS y JavaScript sin dependencias.

```sh
python3 -m http.server 8000
# abre http://localhost:8000
```

| Archivo | Qué hace |
|---|---|
| `index.html` | Todas las pantallas |
| `js/app.js` | Pantalla del niño, perfiles, control del tiempo |
| `js/parent.js` | Modo padre: videos, carpetas, perfiles, actividad |
| `js/model.js` | Reglas: qué ve cada perfil, límite y horario |
| `js/ui.js` | Ventanas, PIN y piezas de interfaz |
| `js/state.js` | Estado compartido |
| `js/player.js` | Reproductor con capa de bloqueo y controles propios |
| `js/store.js` | Guardado local o en Firebase |
| `js/youtube.js` | Leer enlaces, listas, título y miniatura de YouTube |
| `js/config.js` | Configuración de Firebase |
| `sw.js` | Caché para que funcione como app instalada |
