// --- APP CHOFER V1.0 FINAL ULTIMATE ---
console.log("DEBUG: Iniciando App Chofer V1.0 ULTIMATE...");

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

// --- ESTADO GLOBAL ---
let currentUser = null;
let currentUnitId = null;
let currentRouteId = null;
let watchId = null;
let masterClockInterval = null; // Reemplaza al ticker anterior
let currentVueltaDocId = null;
let notificationIdCounter = 1;
let gpsRetryTimeout = null;
let listeners = { unit: null, bulletin: null };
let lastStateCheck = 0;

let estadoTurno = {
    status: "INACTIVO",
    proximaSalida: null,
    proximoRegreso: null,
    retrasoReportado: false,
    paraderoBase: null,
    duracionVueltaMin: 60,
    tiempoDescansoMin: 15
};

// --- REFERENCIAS DOM ---
const loginScreen = document.getElementById('login-screen');
const mainScreen = document.getElementById('main-screen');
const profileScreen = document.getElementById('profile-screen');
const drivingOverlay = document.getElementById('driving-overlay');
// Asegurar negro puro para ahorro OLED
if (drivingOverlay) drivingOverlay.style.backgroundColor = "#000000";

const semaforoBar = document.getElementById('semaforo-bar');
const loginBtn = document.getElementById('login-button');
const loginError = document.getElementById('login-error');
const statusText = document.getElementById('status-text');
const startShiftBtn = document.getElementById('start-shift-button');
const stopShiftBtn = document.getElementById('stop-shift-button');
const unitInput = document.getElementById('unit-number');
const boletinContainer = document.getElementById('boletin-container');
const boletinTexto = document.getElementById('boletin-texto');
const progresoTurno = document.getElementById('progreso-turno');
const vueltaActualNum = document.getElementById('vuelta-actual-num');
const modalRetraso = document.getElementById('modal-retraso');
const modalApoyo = document.getElementById('modal-apoyo');
const controlesActivos = document.getElementById('controles-activos');

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    const titulo = document.querySelector('#login-screen h2');
    if (titulo) { titulo.textContent = "¡LISTO! (Chofer)"; titulo.style.color = "#007aff"; }
    
    // Listener global de boletines
    listeners.bulletin = db.collection('config').doc('mensajes_globales').onSnapshot(doc => {
        if (doc.exists && doc.data().mensajeActivo && boletinContainer) {
            boletinTexto.textContent = doc.data().mensajeActivo;
            boletinContainer.style.display = 'block';
        } else if (boletinContainer) {
            boletinContainer.style.display = 'none';
        }
    });
});

// --- AUTENTICACIÓN Y PANTALLA ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        try { await Capacitor.Plugins.KeepAwake.keepAwake(); } catch (e) {}
        db.collection('conductores').doc(user.uid).get().then(doc => {
            if (doc.exists) {
                document.getElementById('driver-email').textContent = doc.data().nombre || user.email;
                mostrarPantalla(mainScreen);
                recuperarTurnoActivo();
            } else {
                mostrarPantalla(profileScreen);
            }
        });
    } else {
        currentUser = null;
        mostrarPantalla(loginScreen);
        limpiarSesionLocal();
        loginBtn.disabled = false; loginBtn.textContent = "Iniciar Sesión";
        try { await Capacitor.Plugins.KeepAwake.allowSleep(); } catch (e) {}
    }
});

function mostrarPantalla(screen) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
    drivingOverlay.style.display = 'none';
}

// --- GESTIÓN DE TURNOS ---
startShiftBtn.addEventListener('click', async () => {
    const unit = unitInput.value.trim();
    if (!unit) return alert("Ingresa el número de unidad.");
    startShiftBtn.disabled = true; statusText.textContent = "Conectando...";
    statusText.style.color = "orange";
    
    try {
        const unitRef = db.collection('unidades').doc(unit);
        const doc = await unitRef.get();
        if (!doc.exists) throw new Error("Unidad no encontrada.");
        if (doc.data().currentDriverId && doc.data().currentDriverId !== currentUser.uid) throw new Error("Unidad ocupada.");

        currentUnitId = unit;
        unitInput.disabled = true;
        startShiftBtn.style.display = 'none';
        if (controlesActivos) controlesActivos.style.display = 'block';
        
        await unitRef.set({
            currentDriverId: currentUser.uid, currentDriverEmail: currentUser.email,
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        iniciarListenersUnidad();
        iniciarGPS();
    } catch (e) {
        alert(e.message);
        startShiftBtn.disabled = false;
        startShiftBtn.style.display = 'block';
        statusText.textContent = "Desconectado";
        statusText.style.color = "gray";
    }
});

function iniciarListenersUnidad() {
    if (listeners.unit) listeners.unit();
    listeners.unit = db.collection('unidades').doc(currentUnitId).onSnapshot(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        
        // Actualizar variables de estado
        estadoTurno.status = data.status || "EN_ESPERA";
        estadoTurno.proximaSalida = data.proximaSalida ? data.proximaSalida.toDate() : null;
        estadoTurno.proximoRegreso = data.proximoRegreso ? data.proximoRegreso.toDate() : null;
        estadoTurno.paraderoBase = data.paraderoSalidaCoords;
        estadoTurno.duracionVueltaMin = data.duracionVueltaMin || 60;
        estadoTurno.tiempoDescansoMin = data.tiempoDescansoMin || 15;
        if (data.assignedRouteId) currentRouteId = data.assignedRouteId;
        if (data.retrasoInfo === null) estadoTurno.retrasoReportado = false;

        // Ajuste inteligente de horario si entró tarde
        if ((estadoTurno.status === 'LISTO_PARA_SALIR' || estadoTurno.status === 'EN_DESCANSO') && estadoTurno.proximaSalida) {
             ajustarHorarioSiEsNecesario();
        }

        actualizarInterfaz(data);
        if (!currentVueltaDocId && data.status !== "INACTIVO") recuperarVueltaID();
        if (!data.currentDriverId && estadoTurno.status !== "INACTIVO") {
            alert("Asignación terminada por central.");
            stopShiftBtn.click();
        }
    });

    // Reloj maestro de 1s para UI fluida
    if (masterClockInterval) clearInterval(masterClockInterval);
    masterClockInterval = setInterval(cicloRelojMaestro, 1000);
}

function ajustarHorarioSiEsNecesario() {
    const ahora = new Date();
    // Si el horario de salida ya pasó hace más de 30 mins, lo adelantamos un ciclo
    if (estadoTurno.proximaSalida && (ahora.getTime() - estadoTurno.proximaSalida.getTime() > 30 * 60000)) {
        console.log("Ajustando horario antiguo...");
        const cicloMs = (estadoTurno.duracionVueltaMin + estadoTurno.tiempoDescansoMin) * 60000;
        while (estadoTurno.proximaSalida < ahora) {
            estadoTurno.proximaSalida = new Date(estadoTurno.proximaSalida.getTime() + cicloMs);
            if (estadoTurno.proximoRegreso) estadoTurno.proximoRegreso = new Date(estadoTurno.proximoRegreso.getTime() + cicloMs);
        }
    }
}

function actualizarInterfaz(data) {
    // Info básica
    document.getElementById('ruta-asignada-texto').textContent = data.assignedRouteId || "--";
    document.getElementById('checador-asignado-texto').textContent = data.checadorName || "Esperando...";
    document.getElementById('info-ruta-asignada').style.display = data.assignedRouteId ? 'block' : 'none';

    // Scorecard
    if (data.vueltasCompletadas !== undefined && progresoTurno) {
        progresoTurno.style.display = 'block';
        vueltaActualNum.textContent = (data.status === 'EN_RUTA') ? (data.vueltasCompletadas + 1) : data.vueltasCompletadas;
    }

    // Modos de pantalla (Base vs Ruta)
    const container = document.querySelector('.container');
    if (estadoTurno.status === 'EN_DESCANSO' || estadoTurno.status === 'LISTO_PARA_SALIR') {
        container.classList.add('modo-base');
        document.getElementById('hora-salida-base').textContent = formatHora(estadoTurno.proximaSalida);
    } else {
        container.classList.remove('modo-base');
        document.getElementById('horario-salida').textContent = formatHora(estadoTurno.proximaSalida);
        document.getElementById('horario-regreso').textContent = formatHora(estadoTurno.proximoRegreso);
        document.getElementById('panel-horario-dinamico').style.display = data.assignedRouteId ? 'block' : 'none';
    }

    // Estado y color
    const estados = {
        "EN_ESPERA": ["Esperando Ruta...", "gray"], "EN_RUTA": ["EN RUTA", "#28a745"],
        "EN_DESCANSO": ["EN BASE", "#007aff"], "LISTO_PARA_SALIR": ["¡SALIDA AUTORIZADA!", "#ff9800"],
        "RETRASADO": ["RETRASADO", "#dc3545"]
    };
    const [txt, col] = estados[estadoTurno.status] || [estadoTurno.status, "black"];
    statusText.textContent = txt; statusText.style.color = col;
}

// --- CICLO MAESTRO (1s) ---
function cicloRelojMaestro() {
    const ahora = new Date().getTime();
    
    // 1. Actualizar Timer Gigante y Semáforo
    if (estadoTurno.proximaSalida) {
        let objetivo = (estadoTurno.status === 'EN_RUTA') ? estadoTurno.proximoRegreso : estadoTurno.proximaSalida;
        if (objetivo) {
            const restante = objetivo.getTime() - ahora;
            actualizarSemaforo(restante, estadoTurno.status);
            if (document.querySelector('.container.modo-base')) {
                document.getElementById('timer-gigante').textContent = formatTimer(restante);
            }
        }
    }

    // 2. Verificar alertas automáticas (cada 15s aprox)
    if (ahora - lastStateCheck > 15000) {
        verificarEstadosAutomaticos();
        lastStateCheck = ahora;
    }
}

function actualizarSemaforo(ms, status) {
    semaforoBar.className = ''; // Reset
    const mins = ms / 60000;
    if (status === 'EN_RUTA') {
        if (mins > 5) semaforoBar.classList.add('semaforo-verde');
        else if (mins > 0) semaforoBar.classList.add('semaforo-amarillo');
        else semaforoBar.classList.add('semaforo-rojo');
    } else if (status === 'EN_DESCANSO') {
        if (mins > 2) semaforoBar.classList.add('semaforo-verde');
        else if (mins > 0) semaforoBar.classList.add('semaforo-amarillo');
        else semaforoBar.classList.add('semaforo-rojo');
    }
}

function verificarEstadosAutomaticos() {
    if (estadoTurno.status === "INACTIVO" || !estadoTurno.proximaSalida) return;
    const ahora = new Date();
    if (estadoTurno.status === "EN_RUTA") {
        if (estadoTurno.proximoRegreso && ahora > estadoTurno.proximoRegreso && !estadoTurno.retrasoReportado) triggerRetraso("Retraso en Ruta", "Tiempo expirado.");
    } else if (estadoTurno.status === "EN_DESCANSO") {
        if (ahora >= estadoTurno.proximaSalida) marcarComoListoParaSalir();
    } else if (estadoTurno.status === "LISTO_PARA_SALIR") {
        // 5 min tolerancia antes de alerta
        if (ahora.getTime() > (estadoTurno.proximaSalida.getTime() + 300000) && !estadoTurno.retrasoReportado) triggerRetraso("Retraso Salida", "Debiste salir hace 5min.");
    }
}

// --- GEOLOCALIZACIÓN OPTIMIZADA ---
async function iniciarGPS() {
    if (watchId) return;
    if (gpsRetryTimeout) { clearTimeout(gpsRetryTimeout); gpsRetryTimeout = null; }
    try {
        await Capacitor.Plugins.BackgroundGeolocation.requestPermissions();
        watchId = await Capacitor.Plugins.BackgroundGeolocation.addWatcher(
            {
                backgroundMessage: "Ubicación activa.", backgroundTitle: "Turno Koox",
                requestPermissions: true, stale: false, distanceFilter: 30 // Ahorro de batería
            }, 
            (pos, err) => {
                if (err) {
                    if (currentUnitId && !gpsRetryTimeout) { // Autorecuperación
                        gpsRetryTimeout = setTimeout(() => { gpsRetryTimeout = null; stopTracking().then(iniciarGPS); }, 10000);
                    }
                    return;
                }
                if (pos) procesarUbicacion(pos);
            }
        );
    } catch (e) {
        alert("Error GPS. Reintentando en 5s...");
        setTimeout(iniciarGPS, 5000);
    }
}

function procesarUbicacion(pos) {
    // 1. Bloqueo por velocidad (>15km/h) - OLED Friendly
    const speed = (pos.speed || 0) * 3.6;
    if (speed > 15) {
        if (drivingOverlay.style.display !== 'flex') drivingOverlay.style.display = 'flex';
        modalRetraso.style.display = 'none'; modalApoyo.style.display = 'none'; // Seguridad primero
    } else if (speed < 10 && drivingOverlay.style.display !== 'none') {
        drivingOverlay.style.display = 'none';
    }

    // 2. Horario Operativo (5am-11pm)
    const h = new Date().getHours();
    if (h < 5 || h >= 23) return;

    // 3. Enviar a Firebase
    if (currentUnitId && estadoTurno.status !== 'INACTIVO') {
        db.collection('live_locations').doc(currentUnitId).set({
            lat: pos.latitude, lng: pos.longitude, heading: pos.bearing || 0, speed: pos.speed || 0,
            routeId: currentRouteId, unitId: currentUnitId, driverId: currentUser.uid,
            status: estadoTurno.status, lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
    }
    // 4. Geofence
    verificarGeofence(pos.latitude, pos.longitude);
}

function verificarGeofence(lat, lng) {
    if (!estadoTurno.paraderoBase || typeof turf === 'undefined') return;
    const dist = turf.distance([lng, lat], [estadoTurno.paraderoBase.longitude, estadoTurno.paraderoBase.latitude], {units: 'kilometers'});
    if (estadoTurno.status === 'EN_RUTA' && dist < 0.08) cambiarEstado('EN_DESCANSO');
    else if ((estadoTurno.status === 'LISTO_PARA_SALIR' || estadoTurno.status === 'EN_DESCANSO') && dist > 0.15) cambiarEstado('EN_RUTA');
}

// --- TRANSICIONES DE ESTADO ---
async function cambiarEstado(nuevo) {
    if (nuevo === estadoTurno.status) return;
    const updates = { status: nuevo, retrasoInfo: null };
    const now = new Date();
    try {
        if (nuevo === 'EN_DESCANSO') { // LLEGADA
            if (currentVueltaDocId) db.collection('unidades').doc(currentUnitId).collection('vueltas_log').doc(currentVueltaDocId).update({ regreso_real: now, status: 'COMPLETADA' });
            const s = new Date(now.getTime() + estadoTurno.tiempoDescansoMin*60000);
            const r = new Date(s.getTime() + estadoTurno.duracionVueltaMin*60000);
            updates.proximaSalida = s; updates.proximoRegreso = r;
            updates.vueltasCompletadas = firebase.firestore.FieldValue.increment(1);
            const nv = await db.collection('unidades').doc(currentUnitId).collection('vueltas_log').add({
                salida_plan: s, regreso_plan: r, status: 'PENDIENTE', creado: firebase.firestore.FieldValue.serverTimestamp()
            });
            currentVueltaDocId = nv.id;
            enviarNotificacion("Llegada a Base", "Descanso iniciado.");
        } else if (nuevo === 'EN_RUTA') { // SALIDA
            if (currentVueltaDocId) db.collection('unidades').doc(currentUnitId).collection('vueltas_log').doc(currentVueltaDocId).update({ salida_real: now, status: 'EN_RUTA' });
            enviarNotificacion("Ruta Iniciada", "Buen viaje.");
        }
        await db.collection('unidades').doc(currentUnitId).update(updates);
    } catch (e) { console.error(e); }
}

async function marcarComoListoParaSalir() {
    estadoTurno.status = "LISTO_PARA_SALIR";
    enviarNotificacion("¡Hora de Salir!", "Tu tiempo terminó.");
    db.collection('unidades').doc(currentUnitId).update({ status: "LISTO_PARA_SALIR" });
}

// --- FINALIZAR TURNO ROBUSTO ---
stopShiftBtn.addEventListener('click', async () => {
    stopShiftBtn.disabled = true; stopShiftBtn.textContent = "Finalizando...";
    await stopTracking();
});

async function stopTracking() {
    if (watchId) { try { await Capacitor.Plugins.BackgroundGeolocation.removeWatcher({ id: watchId }); } catch (e) {} watchId = null; }
    if (masterClockInterval) { clearInterval(masterClockInterval); masterClockInterval = null; }
    if (gpsRetryTimeout) clearTimeout(gpsRetryTimeout);
    if (drivingOverlay) drivingOverlay.style.display = 'none';

    const u = currentUnitId;
    if (u && currentUser) {
        try {
            await db.collection('live_locations').doc(u).delete();
            await db.collection('unidades').doc(u).update({
                status: 'INACTIVO', currentDriverId: null, assignedRouteId: null,
                proximaSalida: null, proximoRegreso: null, retrasoInfo: null
            });
        } catch (e) { console.warn("Error red finalizando:", e); return false; }
    }
    limpiarSesionLocal();
    return true;
}

function limpiarSesionLocal() {
    currentUnitId = null; currentVueltaDocId = null;
    startShiftBtn.style.display = 'block'; startShiftBtn.disabled = false;
    if (controlesActivos) controlesActivos.style.display = 'none';
    document.getElementById('info-ruta-asignada').style.display = 'none';
    document.getElementById('panel-horario-dinamico').style.display = 'none';
    if (progresoTurno) progresoTurno.style.display = 'none';
    statusText.textContent = "Desconectado"; statusText.style.color = "#666";
    semaforoBar.className = '';
    document.querySelector('.container').classList.remove('modo-base');
    if (listeners.unit) { listeners.unit(); listeners.unit = null; }
    stopShiftBtn.textContent = "Terminar Turno"; // Reset texto botón
}

// --- MODALES Y APOYO ---
document.getElementById('solicitar-apoyo-button')?.addEventListener('click', () => modalApoyo.style.display = 'flex');
document.getElementById('btn-cerrar-apoyo')?.addEventListener('click', () => modalApoyo.style.display = 'none');
modalApoyo?.addEventListener('click', async (e) => {
    const tipo = e.target.dataset.tipoApoyo;
    if (tipo && confirm(`¿Solicitar: ${tipo}?`)) {
        await db.collection('alertas_activas').add({
            tipo, unitId: currentUnitId, driverId: currentUser.uid,
            routeId: currentRouteId, timestamp: firebase.firestore.FieldValue.serverTimestamp(), atendido: false
        });
        alert("Solicitud enviada."); modalApoyo.style.display = 'none';
    }
});
document.getElementById('btn-regresar-normal')?.addEventListener('click', () => document.querySelector('.container').classList.remove('modo-base'));

// --- HELPERS ---
function triggerRetraso(t, m) {
    estadoTurno.status = "RETRASADO";
    if (drivingOverlay.style.display !== 'flex') modalRetraso.style.display = 'flex';
    enviarNotificacion(t, m); reportarRetraso(t);
}
async function reportarRetraso(m) {
    await db.collection('unidades').doc(currentUnitId).update({ status: 'RETRASADO', retrasoInfo: m });
    if (currentVueltaDocId) db.collection('unidades').doc(currentUnitId).collection('vueltas_log').doc(currentVueltaDocId).update({ status: 'RETRASADO', reporte: m });
}
function enviarNotificacion(t, b) {
    try { Capacitor.Plugins.Haptics.vibrate(); Capacitor.Plugins.LocalNotifications.schedule({ notifications: [{ title: t, body: b, id: notificationIdCounter++, channelId: 'koox-alertas' }] }); } catch (e) {}
}
function formatHora(d) { return d ? `${d.getHours()%12||12}:${d.getMinutes().toString().padStart(2,'0')} ${d.getHours()>=12?'PM':'AM'}` : "--:--"; }
function formatTimer(ms) {
    const s = Math.abs(Math.floor(ms/1000)), h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
    return (ms<0?"-":"")+(h>0?`${h}:${m.toString().padStart(2,'0')}`:`${m}:${sec.toString().padStart(2,'0')}`);
}
async function recuperarTurnoActivo() {
    try {
        const s = await db.collection('unidades').where('currentDriverId', '==', currentUser.uid).where('status', '!=', 'INACTIVO').limit(1).get();
        if (!s.empty) { unitInput.value = s.docs[0].id; startShiftBtn.click(); }
    } catch (e) {}
}
async function recuperarVueltaID() {
    try {
        const l = await db.collection('unidades').doc(currentUnitId).collection('vueltas_log').where('status', 'in', ['PENDIENTE','EN_RUTA']).limit(1).get();
        if (!l.empty) currentVueltaDocId = l.docs[0].id;
    } catch (e) {}
}

// --- EVENT LISTENERS BASE ---
loginBtn.addEventListener('click', () => {
    loginBtn.disabled = true; loginBtn.textContent = "Conectando...";
    auth.signInWithEmailAndPassword(document.getElementById('login-email').value, document.getElementById('login-password').value)
        .catch(e => { loginError.textContent = e.message; loginError.style.display = 'block'; loginBtn.disabled = false; loginBtn.textContent = "Iniciar Sesión"; });
});
logoutButton.addEventListener('click', async () => {
    if (estadoTurno.status !== "INACTIVO" && !confirm("Turno activo. ¿Salir?")) return;
    await stopTracking(); auth.signOut();
});