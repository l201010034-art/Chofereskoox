// --- PRUEBA DE VIDA VISUAL ---
console.log("DEBUG: Iniciando app.js vFINAL (Driver Safe)...");
document.addEventListener('DOMContentLoaded', () => {
    const titulo = document.querySelector('#login-screen h2');
    if (titulo) {
        titulo.textContent = "¡LISTO! (Chofer)";
        titulo.style.color = "#007aff";
    }
});

// --- CONFIGURACIÓN FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyDcaVTGa3j1YZjbd1D52wNNc1qk7VnrorY",
  authDomain: "rutaskoox-gestion.firebaseapp.com",
  projectId: "rutaskoox-gestion",
  storageBucket: "rutaskoox-gestion.firebasestorage.app",
  messagingSenderId: "255575956265",
  appId: "1:255575956265:web:c6f7487ced40a4f6f87538",
  measurementId: "G-81656MC0ZC"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// --- VARIABLES GLOBALES ---
let currentUser = null;
let currentDriverName = null; 
let watchId = null; 
let currentUnitId = null;
let currentRouteId = null;
let tickerInterval = null; 
let currentVueltaDocId = null;
let notificationIdCounter = 1;
let gpsRetryTimeout = null; // Para recuperación de GPS

let estadoTurno = {
    status: "INACTIVO", 
    paraderoBase: null, 
    duracionVueltaMin: 0,
    tiempoDescansoMin: 0,
    proximaSalida: null, 
    proximoRegreso: null, 
    listenerTurno: null, 
    retrasoReportado: false
};

// --- ELEMENTOS DEL DOM ---
const loginScreen = document.getElementById('login-screen');
const loginButton = document.getElementById('login-button');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const profileScreen = document.getElementById('profile-screen');
const driverNameInput = document.getElementById('driver-name');
const saveProfileButton = document.getElementById('save-profile-button');
const mainScreen = document.getElementById('main-screen');
const driverEmail = document.getElementById('driver-email');
const unitNumberInput = document.getElementById('unit-number');
const startShiftButton = document.getElementById('start-shift-button');
const stopShiftButton = document.getElementById('stop-shift-button');
const statusText = document.getElementById('status-text');
const locationCoords = document.getElementById('location-coords');
const logoutButton = document.getElementById('logout-button'); 
const reportIssueButton = document.getElementById('report-issue-button');
const infoRutaAsignada = document.getElementById('info-ruta-asignada');
const rutaAsignadaTexto = document.getElementById('ruta-asignada-texto');
const checadorAsignadoTexto = document.getElementById('checador-asignado-texto');
const panelHorario = document.getElementById('panel-horario-dinamico');
const horarioSalida = document.getElementById('horario-salida');
const horarioRegreso = document.getElementById('horario-regreso');
const modalRetraso = document.getElementById('modal-retraso');
const drivingOverlay = document.getElementById('driving-overlay'); // NUEVO

// --- Lógica del Modal de Retraso ---
modalRetraso.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-modal-opcion')) {
        const motivo = e.target.dataset.motivo;
        if (motivo) {
            reportarRetraso(motivo);
            estadoTurno.retrasoReportado = true;
        }
        modalRetraso.style.display = 'none';
    }
});
document.getElementById('btn-cerrar-modal').addEventListener('click', () => {
    modalRetraso.style.display = 'none';
});

reportIssueButton.addEventListener('click', () => {
    if (estadoTurno.status === "INACTIVO") return;
    modalRetraso.style.display = 'flex';
});

// --- LÓGICA DE AUTENTICACIÓN ---
auth.onAuthStateChanged(user => {
    if (user) {
        console.log("Usuario autenticado:", user.email);
        currentUser = user;
        db.collection('conductores').doc(user.uid).get().then(doc => {
            if (doc.exists) {
                const perfil = doc.data();
                currentDriverName = perfil.nombre || user.email; 
                driverEmail.textContent = currentDriverName;
                mostrarPantalla(mainScreen);
                buscarTurnoActivo(user.uid);
            } else {
                mostrarPantalla(profileScreen);
            }
        }).catch(err => {
            console.error("Error verificando perfil:", err);
            loginError.textContent = "Error de conexión al verificar perfil.";
            loginError.style.display = 'block';
        });
    } else {
        currentUser = null;
        currentDriverName = null;
        mostrarPantalla(loginScreen);
        stopTracking();
        loginButton.disabled = false;
        loginButton.textContent = "Iniciar Sesión";
    }
});

function mostrarPantalla(pantallaActiva) {
    loginScreen.classList.remove('active');
    profileScreen.classList.remove('active');
    mainScreen.classList.remove('active');
    pantallaActiva.classList.add('active');
    // Asegurar que el overlay de manejo se oculte al cambiar pantalla
    drivingOverlay.style.display = 'none';
}

// --- EVENT LISTENERS PRINCIPALES ---
loginButton.addEventListener('click', () => {
    loginError.style.display = 'none';
    loginButton.disabled = true;
    loginButton.textContent = "Entrando...";
    const email = loginEmail.value;
    const password = loginPassword.value;

    auth.signInWithEmailAndPassword(email, password)
        .then(() => { console.log("Login exitoso"); })
        .catch((error) => {
            console.error("Error de login:", error);
            loginError.textContent = "Error: " + error.message;
            loginError.style.display = 'block';
            loginButton.disabled = false;
            loginButton.textContent = "Iniciar Sesión";
        });
});

saveProfileButton.addEventListener('click', () => {
    const nombre = driverNameInput.value.trim();
    if (!nombre) {
        alert("Por favor ingresa tu nombre completo.");
        return;
    }
    saveProfileButton.disabled = true;
    saveProfileButton.textContent = "Guardando...";
    db.collection('conductores').doc(currentUser.uid).set({
        email: currentUser.email,
        nombre: nombre,
        fechaRegistro: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        currentDriverName = nombre;
        driverEmail.textContent = currentDriverName;
        mostrarPantalla(mainScreen);
    }).catch((error) => {
        alert("No se pudo guardar el perfil.");
        saveProfileButton.disabled = false;
        saveProfileButton.textContent = "Guardar Perfil";
    });
});

logoutButton.addEventListener('click', () => {
    if (estadoTurno.status !== "INACTIVO") {
        if (!confirm("Tienes un turno activo. ¿Salir? Se terminará tu turno.")) return;
        stopShiftButton.click();
    }
    auth.signOut();
});

// --- LÓGICA PRINCIPAL DE TURNO ---
startShiftButton.addEventListener('click', async () => {
    const unitNumber = unitNumberInput.value.trim();
    if (!unitNumber) {
        alert("Ingresa el número de unidad.");
        return;
    }
    currentUnitId = unitNumber;
    startShiftButton.disabled = true;
    unitNumberInput.disabled = true;
    statusText.textContent = "Conectando...";
    statusText.style.color = "orange";

    try { await Capacitor.Plugins.LocalNotifications.requestPermissions(); } catch(e) {}

    try {
        const unidadRef = db.collection('unidades').doc(currentUnitId);
        const doc = await unidadRef.get();
        if (!doc.exists) throw new Error("Unidad no existe.");
        const data = doc.data();
        if (data.currentDriverId && data.currentDriverId !== currentUser.uid) {
             throw new Error("Unidad ocupada por otro chofer.");
        }

        console.log(`Unidad ${currentUnitId} tomada.`);
        statusText.textContent = "Esperando ruta...";

        estadoTurno.listenerTurno = unidadRef.onSnapshot((docSnapshot) => {
            if (!docSnapshot.exists) return;
            manejarActualizacionUnidad(docSnapshot.data());
        }, (error) => {
            statusText.textContent = "Error de conexión";
        });

    } catch (err) {
        alert(err.message);
        startShiftButton.disabled = false;
        unitNumberInput.disabled = false;
        statusText.textContent = "Desconectado";
        statusText.style.color = "red";
        currentUnitId = null;
    }
});

function manejarActualizacionUnidad(data) {
    if (data.assignedRouteId) {
        if (estadoTurno.status === "INACTIVO") {
            currentRouteId = data.assignedRouteId;
            estadoTurno.paraderoBase = data.paraderoSalidaCoords;
            estadoTurno.duracionVueltaMin = data.duracionVueltaMin || 60;
            estadoTurno.tiempoDescansoMin = data.tiempoDescansoMin || 15;
            
            infoRutaAsignada.style.display = 'block';
            rutaAsignadaTexto.textContent = currentRouteId;
            checadorAsignadoTexto.textContent = `Asignada por: ${data.checadorName || 'Sistema'}`;
            stopShiftButton.disabled = false;
            reportIssueButton.style.display = 'block';
            startTracking();
        }

        estadoTurno.status = data.status || "EN_ESPERA";
        estadoTurno.proximaSalida = data.proximaSalida ? data.proximaSalida.toDate() : null;
        estadoTurno.proximoRegreso = data.proximoRegreso ? data.proximoRegreso.toDate() : null;
        if (data.retrasoInfo === null) estadoTurno.retrasoReportado = false;

        actualizarPanelHorario(estadoTurno.status, estadoTurno.proximaSalida, estadoTurno.proximoRegreso);

        if (!currentVueltaDocId && currentUnitId) recuperarVueltaActiva();
    } else {
        if (estadoTurno.status !== "INACTIVO") {
            alert("Tu asignación de ruta ha terminado.");
            stopShiftButton.click();
        }
    }
}

async function recuperarVueltaActiva() {
    try {
        let snapshot = await db.collection('unidades').doc(currentUnitId).collection('vueltas_log')
            .where('status', '==', 'PENDIENTE').limit(1).get();
        if (snapshot.empty) {
            snapshot = await db.collection('unidades').doc(currentUnitId).collection('vueltas_log')
                .where('status', '==', 'EN_RUTA').limit(1).get();
        }
        if (!snapshot.empty) currentVueltaDocId = snapshot.docs[0].id;
    } catch (e) { console.warn("No se pudo recuperar vuelta activa:", e); }
}

// Listener de TERMINAR TURNO (Actualizado)
stopShiftButton.addEventListener('click', async () => { // <--- Nota el async aquí
    // Deshabilitar el botón para evitar doble clic mientras procesa
    stopShiftButton.disabled = true;
    stopShiftButton.textContent = "Finalizando...";

    if (estadoTurno.listenerTurno) {
        estadoTurno.listenerTurno();
        estadoTurno.listenerTurno = null;
    }

    // Llamamos a la nueva versión robusta y ESPERAMOS
    const exito = await stopTracking();

    if (exito) {
        // Solo si Firebase confirmó el borrado, limpiamos la UI local
        startShiftButton.disabled = false;
        unitNumberInput.disabled = false;
        unitNumberInput.value = "";
        // stopShiftButton ya está disabled, lo dejamos así pero regresamos el texto
        stopShiftButton.textContent = "Terminar Turno"; 
        
        reportIssueButton.style.display = 'none';
        infoRutaAsignada.style.display = 'none';
        const panelHorario = document.getElementById('panel-horario-dinamico');
        if (panelHorario) panelHorario.style.display = 'none';
        
        statusText.textContent = "Desconectado";
        statusText.style.color = "gray";
        locationCoords.textContent = "";

        currentUnitId = null;
        currentRouteId = null;
        currentVueltaDocId = null;
        estadoTurno = { status: "INACTIVO", paraderoBase: null, duracionVueltaMin: 0, tiempoDescansoMin: 0, proximaSalida: null, proximoRegreso: null, listenerTurno: null, retrasoReportado: false };
    } else {
        // Si falló, reactivamos el botón para que pueda reintentar
        stopShiftButton.disabled = false;
        stopShiftButton.textContent = "Terminar Turno";
    }
});

// Listener de CERRAR SESIÓN (Actualizado)
logoutButton.addEventListener('click', async () => { // <--- Nota el async aquí
    if (estadoTurno.status !== "INACTIVO") {
        if (!confirm("Tienes un turno activo. ¿Seguro que quieres salir? Se terminará tu turno.")) {
            return;
        }
        // Forzamos el término de turno y ESPERAMOS a que termine antes de salir
        console.log("Cerrando sesión con turno activo, finalizando primero...");
        await stopTracking(); 
    }
    console.log("Haciendo signOut de Firebase...");
    auth.signOut();
});

// --- LÓGICA DE GEOLOCALIZACIÓN (OPTIMIZADA) ---
async function startTracking() {
    if (watchId) return;
    // Limpiar timeout de reintento si existía
    if (gpsRetryTimeout) {
        clearTimeout(gpsRetryTimeout);
        gpsRetryTimeout = null;
    }

    try {
        watchId = await Capacitor.Plugins.BackgroundGeolocation.addWatcher(
            {
                backgroundMessage: "Compartiendo ubicación en tiempo real.",
                backgroundTitle: "Turno Activo",
                requestPermissions: true,
                stale: false,
                distanceFilter: 30 // OPTIMIZACIÓN: 30 metros para ahorrar batería
            }, 
            (location, error) => {
                if (error) {
                    console.error("Error de GPS:", error);
                    // AUTORECUPERACIÓN: Si falla y seguimos en turno, reintentar en 10s
                    if (currentUnitId && !gpsRetryTimeout) {
                        console.log("Intentando reconectar GPS en 10s...");
                        gpsRetryTimeout = setTimeout(() => {
                            gpsRetryTimeout = null;
                            stopTracking().then(() => startTracking());
                        }, 10000);
                    }
                    return;
                }
                if (location) {
                    handleLocationUpdate({
                        coords: {
                            latitude: location.latitude, longitude: location.longitude,
                            speed: location.speed || 0, heading: location.bearing || 0,
                            accuracy: location.accuracy
                        },
                        timestamp: location.time
                    });
                }
            }
        );
        
        if (tickerInterval) clearInterval(tickerInterval);
        tickerInterval = setInterval(checkTimeBasedStates, 15000);

        db.collection('unidades').doc(currentUnitId).set({
            currentDriverId: currentUser.uid,
            currentDriverName: currentDriverName,
            currentDriverEmail: currentUser.email,
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

    } catch (e) {
        console.error("Fallo crítico GPS:", e);
        alert("Error al iniciar GPS. Reiniciando servicio...");
        // Intento inmediato de recuperación si falla el arranque inicial
        setTimeout(startTracking, 5000);
    }
}
 
// --- LÓGICA DE GEOLOCALIZACIÓN (OPTIMIZADA Y BLINDADA) ---
// ... (startTracking se queda igual) ...

async function stopTracking() {
    console.log("🛑 INICIANDO DETENCIÓN DE RASTREO...");
    
    // 1. Detener GPS nativo inmediatamente
    if (watchId) {
        try { await Capacitor.Plugins.BackgroundGeolocation.removeWatcher({ id: watchId }); } catch (e) { console.warn("Warning al detener watcher:", e); }
        watchId = null;
    }
    if (gpsRetryTimeout) {
        clearTimeout(gpsRetryTimeout);
        gpsRetryTimeout = null;
    }
    if (tickerInterval) {
        clearInterval(tickerInterval);
        tickerInterval = null;
    }
    // Quitar bloqueo de pantalla si estaba activo
    const overlay = document.getElementById('driving-overlay');
    if (overlay) overlay.style.display = 'none';

    // 2. Guardar ID localmente para asegurar que no se pierda durante la ejecución
    const unidadParaLiberar = currentUnitId;
    console.log("Unidad a liberar:", unidadParaLiberar);

    // 3. Operaciones en Firebase (CRÍTICO: Usar await)
    if (unidadParaLiberar) {
        try {
            statusText.textContent = "Finalizando en red..."; // Feedback visual

            // A) Borrar ubicación en vivo
            console.log("A) Borrando live_location...");
            await db.collection('live_locations').doc(unidadParaLiberar).delete();
            console.log(">>> live_location borrada.");

            // B) Liberar unidad
            console.log("B) Actualizando estado de unidad...");
            await db.collection('unidades').doc(unidadParaLiberar).update({
                status: 'INACTIVO',
                currentDriverId: null,
                currentDriverName: null,
                currentDriverEmail: null,
                assignedRouteId: null,
                proximaSalida: null,
                proximoRegreso: null,
                retrasoInfo: null,
                checadorId: null,
                checadorName: null,
                vueltasCompletadas: null
            });
            console.log(">>> Unidad liberada a INACTIVO.");

        } catch (err) {
            console.error("❌ ERROR CRÍTICO AL FINALIZAR TURNO EN FIREBASE:", err);
            alert("Hubo un error de red al finalizar. Por favor verifica que tengas internet e inténtalo de nuevo.");
            // No limpiamos las variables globales si falló, para que pueda reintentar
            return false; 
        }
    } else {
        console.warn("No había currentUnitId para liberar.");
    }

    console.log("🛑 RASTREO DETENIDO CORRECTAMENTE.");
    return true; // Indica éxito
}

function isWithinOperatingHours() {
    const ahora = new Date();
    const horas = ahora.getHours();
    return horas >= 5 && horas < 23; // 5:00 AM a 10:59 PM
}

function handleLocationUpdate(pos) {
    const { latitude, longitude, speed, heading } = pos.coords;

    // --- SEGURIDAD: BLOQUEO POR VELOCIDAD ---
    // 15 km/h ~= 4.16 m/s. Usamos 4 m/s como umbral.
    const speedKmh = (speed || 0) * 3.6;
    if (speedKmh > 15) {
        if (drivingOverlay.style.display !== 'flex') {
             drivingOverlay.style.display = 'flex'; // BLOQUEAR PANTALLA
        }
    } else {
        // Pequeño buffer para evitar parpadeo si va justo a 15km/h
        if (speedKmh < 12 && drivingOverlay.style.display !== 'none') {
             drivingOverlay.style.display = 'none'; // DESBLOQUEAR PANTALLA
        }
    }
    // ----------------------------------------

    if (!isWithinOperatingHours()) {
        if (statusText.textContent !== "Fuera de Horario") {
             statusText.textContent = "Fuera de Horario";
             statusText.style.color = "orange";
        }
        return; // Suspender envío
    }

    // locationCoords.textContent = `GPS: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

    if (currentUnitId && estadoTurno.status !== "INACTIVO") {
        db.collection('live_locations').doc(currentUnitId).set({
            lat: latitude, lng: longitude, speed: speed, heading: heading,
            routeId: currentRouteId, driverId: currentUser.uid, unitId: currentUnitId,
            status: estadoTurno.status,
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(e => console.warn("Error envío ubicación:", e));
    }
    checkGeofence(latitude, longitude);
}

function checkGeofence(lat, lng) {
    if (estadoTurno.status === "INACTIVO" || !estadoTurno.paraderoBase || typeof turf === 'undefined') return;
    
    const miUbicacion = turf.point([lng, lat]);
    const baseUbicacion = turf.point([estadoTurno.paraderoBase.longitude, estadoTurno.paraderoBase.latitude]);
    const distanciaMetros = turf.distance(miUbicacion, baseUbicacion, { units: 'kilometers' }) * 1000;

    if (estadoTurno.status === "EN_RUTA") {
        if (distanciaMetros < 80) {
            console.log("Geofence: Llegada a base.");
            iniciarDescanso();
        }
    } else if (estadoTurno.status === "LISTO_PARA_SALIR") {
        if (distanciaMetros > 100) {
            console.log("Geofence: Salida de base.");
            iniciarRuta();
        }
    }
}

// --- MÁQUINA DE ESTADOS ---
function checkTimeBasedStates() {
    if (estadoTurno.status === "INACTIVO" || !estadoTurno.proximaSalida) return;
    const ahora = new Date();

    if (estadoTurno.status === "EN_RUTA") {
        if (estadoTurno.proximoRegreso && ahora > estadoTurno.proximoRegreso && !estadoTurno.retrasoReportado) {
            triggerRetraso("Retraso en Ruta", "Tu tiempo de regreso ha expirado.");
        }
    } else if (estadoTurno.status === "EN_DESCANSO") {
        if (ahora >= estadoTurno.proximaSalida) {
            marcarComoListoParaSalir();
        }
    } else if (estadoTurno.status === "LISTO_PARA_SALIR") {
        if (ahora.getTime() > (estadoTurno.proximaSalida.getTime() + 300000) && !estadoTurno.retrasoReportado) {
            triggerRetraso("Retraso en Salida", "Ya deberías haber salido de la base.");
        }
    }
}

function triggerRetraso(tipo, mensaje) {
    estadoTurno.status = "RETRASADO";
    // Solo mostrar el modal si NO están conduciendo
    if (drivingOverlay.style.display !== 'flex') {
        modalRetraso.style.display = 'flex';
    }
    enviarAlertaNativa(tipo, mensaje);
    reportarRetraso(tipo); 
}

// --- TRANSICIONES ---
async function iniciarDescanso() {
    const ahora = new Date();
    const nuevaSalida = new Date(ahora.getTime() + estadoTurno.tiempoDescansoMin * 60000);
    const nuevoRegreso = new Date(nuevaSalida.getTime() + estadoTurno.duracionVueltaMin * 60000);

    estadoTurno.status = "EN_DESCANSO";
    estadoTurno.proximaSalida = nuevaSalida;
    estadoTurno.proximoRegreso = nuevoRegreso;
    estadoTurno.retrasoReportado = false;

    try {
        const unidadRef = db.collection('unidades').doc(currentUnitId);
        if (currentVueltaDocId) {
            const vueltaRef = unidadRef.collection('vueltas_log').doc(currentVueltaDocId);
            const snap = await vueltaRef.get();
            if (snap.exists) {
                const plan = snap.data().regreso_plan.toDate();
                await vueltaRef.update({
                    regreso_real: ahora, status: "COMPLETADA",
                    desviacionRegreso: Math.round((ahora.getTime() - plan.getTime()) / 60000)
                });
            }
        }
        const numVuelta = ((await unidadRef.get()).data().vueltasCompletadas || 0) + 1;
        await unidadRef.update({
            status: "EN_DESCANSO", proximaSalida: nuevaSalida, proximoRegreso: nuevoRegreso,
            retrasoInfo: null, vueltasCompletadas: numVuelta
        });
        const nuevaVuelta = await unidadRef.collection('vueltas_log').add({
            vueltaNum: numVuelta + 1, salida_plan: nuevaSalida, regreso_plan: nuevoRegreso,
            status: "PENDIENTE", creado: firebase.firestore.FieldValue.serverTimestamp()
        });
        currentVueltaDocId = nuevaVuelta.id;
        enviarAlertaNativa("Llegada a Base", "Descanso iniciado.");
    } catch (e) { console.error("Error iniciarDescanso:", e); }
}

async function marcarComoListoParaSalir() {
    estadoTurno.status = "LISTO_PARA_SALIR";
    enviarAlertaNativa("¡Hora de Salir!", "Tu tiempo de descanso terminó.");
    db.collection('unidades').doc(currentUnitId).update({ status: "LISTO_PARA_SALIR" });
}

async function iniciarRuta() {
    const ahora = new Date();
    estadoTurno.status = "EN_RUTA";
    estadoTurno.retrasoReportado = false;
    try {
        const unidadRef = db.collection('unidades').doc(currentUnitId);
        await unidadRef.update({ status: "EN_RUTA", retrasoInfo: null });
        if (currentVueltaDocId) {
            const vueltaRef = unidadRef.collection('vueltas_log').doc(currentVueltaDocId);
            const snap = await vueltaRef.get();
            if (snap.exists) {
                const plan = snap.data().salida_plan.toDate();
                await vueltaRef.update({
                    salida_real: ahora, status: "EN_RUTA",
                    desviacionSalida: Math.round((ahora.getTime() - plan.getTime()) / 60000)
                });
            }
        }
        enviarAlertaNativa("Ruta Iniciada", "Buen viaje.");
    } catch (e) { console.error("Error iniciarRuta:", e); }
}

async function reportarRetraso(motivo) {
    try {
        const unidadRef = db.collection('unidades').doc(currentUnitId);
        await unidadRef.update({ status: "RETRASADO", retrasoInfo: motivo });
        if (currentVueltaDocId) {
            await unidadRef.collection('vueltas_log').doc(currentVueltaDocId).update({ status: "RETRASADO", reporte: motivo });
        }
    } catch (e) { console.error("Error reportarRetraso:", e); }
}

// --- FUNCIONES AUXILIARES ---
async function buscarTurnoActivo(uid) {
    try {
        const snap = await db.collection('unidades').where('currentDriverId', '==', uid).where('status', '!=', 'INACTIVO').limit(1).get();
        if (!snap.empty) {
            unitNumberInput.value = snap.docs[0].id;
            startShiftButton.click();
        }
    } catch (e) {}
}

function actualizarPanelHorario(status, salida, regreso) {
    panelHorario.style.display = 'block';
    const format = (d) => {
        if (!d) return "--:--";
        let h = d.getHours(), m = d.getMinutes();
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${h}:${m < 10 ? '0'+m : m} ${ampm}`;
    };
    horarioSalida.textContent = format(salida);
    horarioRegreso.textContent = format(regreso);
    switch(status) {
        case "EN_DESCANSO": statusText.textContent = "En Base (Cargando)"; statusText.style.color = "blue"; break;
        case "LISTO_PARA_SALIR": statusText.textContent = "¡Salida Autorizada!"; statusText.style.color = "#E69500"; break;
        case "EN_RUTA": statusText.textContent = "En Ruta"; statusText.style.color = "green"; break;
        case "RETRASADO": statusText.textContent = "¡Retrasado!"; statusText.style.color = "red"; break;
        case "EN_ESPERA": statusText.textContent = "Esperando Asignación..."; statusText.style.color = "gray"; break;
        default: statusText.textContent = status; statusText.style.color = "black";
    }
}

async function enviarAlertaNativa(titulo, cuerpo) {
    try {
        await Capacitor.Plugins.Haptics.vibrate({ duration: 1000 });
        await Capacitor.Plugins.LocalNotifications.schedule({
            notifications: [{
                title: titulo, body: cuerpo, id: notificationIdCounter++,
                channelId: 'koox-alertas', importance: 5
            }]
        });
    } catch (e) {
        if (!window.Capacitor || !window.Capacitor.isNative) alert(`${titulo}\n${cuerpo}`);
    }
}