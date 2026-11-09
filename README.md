# Isla ID Studio — archivos para Spck

Proyecto web adaptable para diseñar una credencial personal inspirada en paletas y estilos de distintos países, generar un QR de referencia y probar su lectura desde otro celular.

## Archivos incluidos

- `index.html`: páginas y estructura de la interfaz.
- `styles.css`: diseño adaptable, paletas y animaciones.
- `app.js`: formularios, vista previa, almacenamiento local, lector de cámara y comunicación con el servidor.
- `qr-engine.js`: generador QR local incluido en el proyecto; no depende de CDN ni de librerías externas.
- `server.js`: servidor Node.js opcional para alojar la página y activar la notificación entre dos celulares.
- `package.json`: comando para iniciar el servidor.
- `render.yaml`: configuración de ejemplo para desplegar el servidor.

## Funciones

- Plantillas visuales originales: Grenada, Colombia, Japón, Canadá, Barbados y una paleta botánica.
- Nombre, nacionalidad, fechas, tratamiento, frase personal y retrato opcional.
- Vista previa actualizada mientras escribes.
- Persistencia local de los datos en el navegador.
- QR generado en el dispositivo: el código contiene una referencia, no los datos personales.
- El QR contiene una referencia aleatoria y una suma de comprobación de formato, no el nombre ni las fechas.
- Lector por cámara en navegadores compatibles y opción de analizar una imagen que contenga el QR.
- Servidor opcional para recuperar y mostrar el pasaporte asociado al QR en el segundo celular; el primero también recibe «Escaneo completado».
- Exportación del QR en SVG e impresión de la credencial a PDF.

## Abrir en Spck Editor

1. Descarga y extrae el ZIP completo.
2. En Spck, importa o abre la carpeta `isla-id-studio` como proyecto.
3. Comprueba que `index.html`, `styles.css`, `app.js` y `qr-engine.js` estén juntos en la misma carpeta.
4. Abre `index.html`. Puedes diseñar, ver tu pasaporte y generar/descargar el QR sin instalar nada ni conectar librerías externas.
5. El acceso a cámara de páginas web suele requerir HTTPS o un contexto local seguro. Si la vista previa de Spck no permite usar la cámara, abre la página desde una dirección HTTPS en Chrome y concede el permiso de cámara.

## Lectura de QR

1. En **Crear**, elige Grenada u otra plantilla y completa tus datos.
2. Abre **Mi pasaporte**; el QR se crea automáticamente. También puedes pulsar **Generar / actualizar QR**.
3. En el otro celular, abre la misma página y entra en **Leer QR**.
4. Activa la cámara, acepta el permiso y apunta al QR del primer celular. También puedes seleccionar una imagen del código.

La lectura de cámara usa la API `BarcodeDetector` del navegador. En Android, Google Chrome actualizado suele ofrecerla, pero depende del navegador y de los servicios del dispositivo. Si aparece un aviso de compatibilidad, prueba con Chrome actualizado y una página HTTPS.

## Notificación entre dos celulares

La generación y el reconocimiento local funcionan sin servidor. Para que el celular que muestra el QR reciba también la notificación en tiempo real, hay que servir el proyecto mediante `server.js`:

1. Publica los archivos del proyecto en un repositorio de GitHub.
2. En un servicio que ejecute Node.js (por ejemplo, Render), crea un servicio web a partir del repositorio.
3. Usa `npm install` como comando de compilación y `npm start` como comando de inicio. También puedes usar la configuración de `render.yaml` si la plataforma la admite.
4. Abre la dirección HTTPS del servicio en ambos celulares. En el primero, abre **Mi pasaporte** y deja la página abierta; en el segundo, escanea el QR.
5. El segundo celular mostrará el pasaporte asociado al QR. El primer celular recibirá «Escaneo completado». Mantén abierto y conectado el dispositivo titular mientras se realiza la lectura.

El servidor guarda únicamente referencias temporales y el estado de lectura en memoria. No necesita una base de datos, y las sesiones inactivas caducan. En el alojamiento gratuito, la disponibilidad y el comportamiento tras periodos de inactividad dependen de las condiciones actuales del proveedor.

## Privacidad y alcance

Los datos del formulario se guardan localmente en el navegador. Cuando se genera el QR, el pasaporte se comparte temporalmente con el servidor para que el lector pueda recuperarlo; el QR no contiene datos personales. Si usas la foto, se guarda una versión comprimida en el almacenamiento local de ese dispositivo. Borrar los datos del navegador también borra el diseño guardado. No introduzcas información sensible que no necesites.

Las plantillas usan diseños propios inspirados en paletas de países; no reproducen los diseños oficiales. La lectura del QR solo comprueba que el código tenga el formato del proyecto. No consulta sistemas gubernamentales ni autentica un pasaporte emitido por un país.
