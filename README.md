# TrazaPro — Instrucciones de despliegue

## Lo que necesitas
- Cuenta en GitHub (gratuita): github.com
- Cuenta en Vercel (gratuita): vercel.com
- El Firebase ya está configurado ✓

---

## Paso 1 — Subir el código a GitHub

1. Ve a **github.com** → pulsa **"New repository"**
2. Nombre: `trazapro`
3. Déjalo en **Public** → **Create repository**
4. En la página del repositorio recién creado, pulsa **"uploading an existing file"**
5. Sube **todos los archivos** de esta carpeta manteniendo la estructura:
   ```
   package.json
   vite.config.js
   index.html
   vercel.json
   src/
     main.jsx
     App.jsx
     firebase.js
   ```
6. Pulsa **"Commit changes"**

---

## Paso 2 — Desplegar en Vercel

1. Ve a **vercel.com** → **Sign up with GitHub**
2. Pulsa **"New Project"**
3. Selecciona el repositorio `trazapro`
4. Vercel detecta automáticamente que es Vite/React
5. Pulsa **Deploy** — en 2 minutos tendrás tu URL

Tu app estará disponible en algo como:
**https://trazapro-xxxx.vercel.app**

---

## Paso 3 — Añadir al iPhone como app

1. Abre la URL en Safari del iPhone
2. Pulsa el botón compartir (cuadrado con flecha)
3. Selecciona **"Añadir a pantalla de inicio"**
4. Ponle nombre: TrazaPro → **Añadir**

La app aparecerá como icono en tu iPhone, funciona como una app nativa, con acceso completo a la cámara para escanear QR.

---

## Usuarios y acceso

La app NO tiene contraseñas. Cualquier persona con la URL puede acceder.
Para restringir el acceso, cambia las reglas de Firestore en la consola Firebase antes de los 30 días del modo prueba.

Reglas recomendadas para producción (solo lectura/escritura con token de app):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true; // Cambia esto si quieres auth real
    }
  }
}
```

---

## Funcionalidades incluidas

- ✅ Multi-usuario con firmas en elaboraciones y transferencias
- ✅ Sincronización en tiempo real entre todos los dispositivos
- ✅ Escáner QR con cámara nativa del iPhone
- ✅ Etiquetas imprimibles con QR
- ✅ Catálogo de plantillas de productos
- ✅ Stock con actualización automática en transferencias
- ✅ Historial completo de trazabilidad
- ✅ Exportación a Excel
- ✅ Locales ilimitados con fichas completas
- ✅ Categorías editables
