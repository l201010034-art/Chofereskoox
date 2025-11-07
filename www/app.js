// --- app.js (APP DEL CHÓFER - VERSIÓN "TABLA DE AEROPUERTO" + ALERTAS NATIVAS) ---

// Los plugins los tomaremos del objeto global 'Capacitor' 
// que es creado por 'capacitor.js'

// --- CONFIGURACIÓN ---
const firebaseConfig = {
  apiKey: "AIzaSyDcaVTGa3j1YZjbd1D52wNNc1qk7VnrorY",
  authDomain: "rutaskoox-gestion.firebaseapp.com",
  projectId: "rutaskoox-gestion",
  storageBucket: "rutaskoox-gestion.firebasestorage.app",
  messagingSenderId: "255575956265",
  appId: "1:255575956265:web:c6f7487ced40a4f6f87538",
  measurementId: "G-81656MC0ZC"
};

// Inicializar Firebase
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
let currentVueltaDocId = null; // ⬅️ (NUEVO) ID del documento de la vuelta actual
let notificationIdCounter = 1; // ⬅️ (NUEVO) Para las alertas

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

// --- ELEMENTOS DEL DOM (Restaurados de tu archivo) ---
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
const reportIssueButton = document.getElementById('report-issue-button'); // ⬅️ ¡RESTURADO!
const infoRutaAsignada = document.getElementById('info-ruta-asignada');
const rutaAsignadaTexto = document.getElementById('ruta-asignada-texto');
const checadorAsignadoTexto = document.getElementById('checador-asignado-texto');
const panelHorario = document.getElementById('panel-horario-dinamico');
const horarioSalida = document.getElementById('horario-salida');
const horarioRegreso = document.getElementById('horario-regreso');
const modalRetraso = document.getElementById('modal-retraso');

// --- Lógica del Modal de Retraso ---
modalRetraso.addEventListener('click', (e) => {
    let motivo = null;
    if (e.target.classList.contains('btn-modal-opcion')) {
        motivo = e.target.dataset.motivo;
        if (motivo) {
            reportarRetraso(motivo); // (Esta función ahora está mejorada)
        }
        modalRetraso.style.display = 'none';
        if (motivo) {
             estadoTurno.retrasoReportado = true;
        }
    }
});
reportIssueButton.addEventListener('click', () => { // ⬅️ ¡RESTURADO!
    if (estadoTurno.status === "INACTIVO") return;
    console.log("Reporte manual de incidencia.");
    modalRetraso.style.display = 'flex';
});

// --- LÓGICA DE AUTENTICACIÓN (Sin cambios) ---
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        const conductorRef = db.collection('conductores').doc(user.uid);
        conductorRef.get().then(doc => {
            if (doc.exists) {
                const perfil = doc.data();
                currentDriverName = perfil.nombre || user.email; 
                driverEmail.textContent = currentDriverName;
                loginScreen.classList.remove('active');
                profileScreen.classList.remove('active');
                mainScreen.classList.add('active');
                buscarTurnoActivo(user.uid);
            } else {
                loginScreen.classList.remove('active');
                mainScreen.classList.remove('active');
                profileScreen.classList.add('active');
            }
        }).catch(err => {
            loginError.textContent = "Error al verificar tu perfil.";
            loginError.style.display = 'block';
        });
        loginError.style.display = 'none';
    } else {
        currentUser = null;
        currentDriverName = null;
        loginScreen.classList.add('active');
        mainScreen.classList.remove('active');
        profileScreen.classList.remove('active');
        stopTracking(); 
    }
});

// (Función de Login con Logs - Sin cambios)
loginButton.addEventListener('click', () => { /* ... */ });
saveProfileButton.addEventListener('click', () => { /* ... */ });
logoutButton.addEventListener('click', () => { /* ... */ });


// --- (MODIFICADO) LÓGICA PRINCIPAL DE TURNO ---
startShiftButton.addEventListener('click', async () => {
    const unitNumber = unitNumberInput.value;
    if (!unitNumber) { /* ... */ }
    
    currentUnitId = unitNumber;
    startShiftButton.disabled = true;
    unitNumberInput.disabled = true;
    statusText.textContent = "Buscando asignación...";
    statusText.style.color = "orange";

    // --- ⬇️ (NUEVO) PEDIR PERMISO DE NOTIFICACIONES ⬇️ ---
    try {
        await Capacitor.Plugins.LocalNotifications.requestPermissions();
    } catch(e) {
        console.warn("Permiso de notificaciones denegado", e);
    }
    // --- ⬆️ FIN DE PERMISO ⬆️ ---

    try {
        const unidadRef = db.collection('unidades').doc(currentUnitId);
        
        estadoTurno.listenerTurno = unidadRef.onSnapshot((doc) => {
            
            if (doc.exists && doc.data().assignedRouteId) {
                const data = doc.data();
                
                // --- ⬇️ INICIO DE LA MODIFICACIÓN (Manejo de Vueltas) ⬇️ ---

                // Variables que solo se setean la primera vez
                if (estadoTurno.status === "INACTIVO") {
                    currentRouteId = data.assignedRouteId;
                    estadoTurno.paraderoBase = data.paraderoSalidaCoords;
                    estadoTurno.duracionVueltaMin = data.duracionVueltaMin;
                    estadoTurno.tiempoDescansoMin = data.tiempoDescansoMin;
                    
                    console.log(`Turno cargado: Ruta ${currentRouteId}, Unidad ${currentUnitId}`);
                    startTracking(); // Iniciar GPS solo la primera vez
                    
                    stopShiftButton.disabled = false;
                    reportIssueButton.style.display = 'block'; 
                    infoRutaAsignada.style.display = 'block';
                    rutaAsignadaTexto.textContent = currentRouteId;
                }
                
                estadoTurno.status = data.status;
                const checadorNombre = data.checadorName || 'Sistema';
                checadorAsignadoTexto.textContent = `Asignada por: ${checadorNombre}`;

                if (data.proximaSalida) {
                    estadoTurno.proximaSalida = new Date(data.proximaSalida.toDate());
                } else {
                    estadoTurno.proximaSalida = null;
                }
                if (data.proximoRegreso) {
                    estadoTurno.proximoRegreso = new Date(data.proximoRegreso.toDate());
                } else {
                    estadoTurno.proximoRegreso = null;
                }
                if (data.retrasoInfo === null) {
                    estadoTurno.retrasoReportado = false; 
                }

                // (NUEVO) Buscar el ID de la vuelta PENDIENTE actual
                if (currentUnitId && (estadoTurno.status === 'LISTO_PARA_SALIR' || estadoTurno.status === 'EN_DESCANSO' || estadoTurno.status === 'INACTIVO')) {
                    db.collection('unidades').doc(currentUnitId).collection('vueltas_log')
                        .where('status', '==', 'PENDIENTE')
                        .orderBy('salida_plan')
                        .limit(1)
                        .get()
                        .then(snapshot => {
                            if (!snapshot.empty) {
                                currentVueltaDocId = snapshot.docs[0].id;
                                console.log("Vuelta PENDIENTE encontrada:", currentVueltaDocId);
                            } else {
                                console.log("No se encontró vuelta PENDIENTE, buscando EN_RUTA...");
                                // Fallback: si ya está en ruta (ej. recuperación de turno)
                                db.collection('unidades').doc(currentUnitId).collection('vueltas_log')
                                    .where('status', '==', 'EN_RUTA')
                                    .orderBy('salida_plan', 'desc')
                                    .limit(1)
                                    .get()
                                    .then(snap2 => {
                                        if (!snap2.empty) {
                                            currentVueltaDocId = snap2.docs[0].id;
                                            console.log("Vuelta EN_RUTA recuperada:", currentVueltaDocId);
                                        }
                                    });
                            }
                        });
                }
                
                actualizarPanelHorario(
                    estadoTurno.status, 
                    estadoTurno.proximaSalida,
                    estadoTurno.proximoRegreso
                );
                
                // --- ⬆️ FIN DE LA MODIFICACIÓN ⬆️ ---

            } else {
                console.warn("Esta unidad ya no tiene una ruta asignada (turno finalizado).");
                if (estadoTurno.status !== "INACTIVO") {
                    alert("El turno ha sido finalizado por el checador.");
                    stopShiftButton.click(); 
                }
            }
        }, (error) => { 
            console.error("Error en el listener de Firestore:", error);
            alert("Se perdió la conexión con el servidor de turnos.");
            stopShiftButton.click();
        });

    } catch (err) {
        console.error("Error al buscar asignación:", err);
        alert("Error de conexión. No se pudo verificar la unidad.");
        startShiftButton.disabled = false;
        unitNumberInput.disabled = false;
    }
});

stopShiftButton.addEventListener('click', () => {
    console.log("Terminando turno...");
    
    if (estadoTurno.listenerTurno) {
        estadoTurno.listenerTurno();
        estadoTurno.listenerTurno = null;
    }
    if (tickerInterval) {
        clearInterval(tickerInterval);
        tickerInterval = null;
    }
    stopTracking(); 
    
    startShiftButton.disabled = false;
    unitNumberInput.disabled = false;
    unitNumberInput.value = ""; 
    statusText.textContent = "Desconectado";
    statusText.style.color = "red";
    // ... (resto de limpieza de UI)
    
    // Reseteo completo de la máquina de estados
    estadoTurno.status = "INACTIVO";
    currentRouteId = null;
    currentVueltaDocId = null; // ⬅️ (NUEVO)
    estadoTurno.proximaSalida = null;
    estadoTurno.proximoRegreso = null;
    estadoTurno.retrasoReportado = false;
    estadoTurno.paraderoBase = null;
});


// --- LÓGICA DE GEOLOCALIZACIÓN Y FIREBASE ---
async function startTracking() {
    if (watchId) { /* ... */ }
    try {
        watchId = await Capacitor.Plugins.BackgroundGeolocation.addWatcher(
            { /* ... (configuración del watcher) ... */ }, 
            (location, error) => {
                if (error) { /* ... (manejo de error) ... */ }
                if (location) {
                    const pos = { coords: { /* ... (adaptación de 'pos') ... */ } };
                    handleLocationUpdate(pos);
                }
            }
        );
        console.log("Servicio de GPS en segundo plano iniciado. Watcher ID:", watchId);
        if (tickerInterval) clearInterval(tickerInterval);
        tickerInterval = setInterval(checkTimeBasedStates, 30000); 
        
        const unidadRef = db.collection('unidades').doc(currentUnitId);
        unidadRef.set({ /* ... (datos del conductor) ... */ }, { merge: true });
    } catch (e) {
        handleLocationError({ code: 1, message: `Permiso denegado o error: ${e.message}` });
    }
}
 
async function stopTracking() {
    if (watchId) {
        try {
            await Capacitor.Plugins.BackgroundGeolocation.removeWatcher({ id: watchId });
            watchId = null;
        } catch (e) { console.error("Error al detener el watcher:", e); }
    }
    if (currentUnitId) {
        db.collection('live_locations').doc(currentUnitId).delete();
        
        db.collection('unidades').doc(currentUnitId).update({
            status: 'INACTIVO',
            currentDriverId: null,
            currentDriverEmail: null,
            currentDriverName: null,
            retrasoInfo: null,
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp(),
            assignedRouteId: null, 
            proximaSalida: null,
            proximoRegreso: null,
            checadorId: null,
            checadorName: null,
            vueltasCompletadas: null
        }).catch(err => console.error("Error al liberar la unidad:", err));

        // (NUEVO) Borramos el log de vueltas
        borrarSubcoleccion(db.collection('unidades').doc(currentUnitId).collection('vueltas_log'));

        currentUnitId = null;
    }
    estadoTurno.status = "INACTIVO";
}

// (NUEVO) Helper para borrar subcolección
async function borrarSubcoleccion(collectionRef) {
    try {
        const snapshot = await collectionRef.limit(50).get(); 
        if (snapshot.size === 0) { return; }
        const batch = db.batch();
        snapshot.docs.forEach(doc => { batch.delete(doc.ref); });
        await batch.commit();
        await borrarSubcoleccion(collectionRef);
    } catch (err) {
        console.warn("Error borrando subcolección (puede fallar si no hay permisos):", err);
    }
}

function handleLocationUpdate(position) {
    const { latitude, longitude, speed, heading } = position.coords;
    const timestamp = firebase.firestore.FieldValue.serverTimestamp(); 

    const locationData = {
        lat: latitude,
        lng: longitude,
        speed: speed,
        heading: heading,
        routeId: currentRouteId,
        driverId: currentUser.uid, 
        lastUpdate: timestamp
    };
    
    if (estadoTurno.status !== "INACTIVO" && currentUnitId) {
        db.collection('live_locations').doc(currentUnitId).set(locationData);
        if (estadoTurno.status !== "RETRASADO") {
            db.collection('unidades').doc(currentUnitId).update({ retrasoInfo: null });
        }
    }

    // Lógica de Geofence (Sin cambios)
    if (estadoTurno.status === "INACTIVO" || !estadoTurno.paraderoBase) return;
    if (typeof turf === 'undefined') { return; }
    
    const miPunto = turf.point([longitude, latitude]);
    const basePunto = turf.point([
        estadoTurno.paraderoBase.longitude, 
        estadoTurno.paraderoBase.latitude
    ]);
    const distanciaABase = turf.distance(miPunto, basePunto, { units: 'meters' });

    if (estadoTurno.status === "EN_RUTA") {
        if (distanciaABase < 50) { 
            iniciarDescanso();
        }
    } else if (estadoTurno.status === "LISTO_PARA_SALIR") {
        if (distanciaABase > 50) { 
            iniciarRuta();
        }
    }
}

function handleLocationError(error) { /* ... (Tu función original) ... */ }


// --- (MODIFICADO) Reloj Checador (Usa Alertas Nativas) ---
function checkTimeBasedStates() {
    if (estadoTurno.status === "INACTIVO" || !estadoTurno.proximaSalida) {
        return; 
    }
    const ahora = new Date();

    if (estadoTurno.status === "EN_RUTA") {
        if (estadoTurno.proximoRegreso && ahora > estadoTurno.proximoRegreso && !estadoTurno.retrasoReportado) {
            estadoTurno.status = "RETRASADO";
            reportarRetraso("Retraso en Ruta"); 
            modalRetraso.style.display = 'flex';
            // --- ⬇️ (NUEVA) ALERTA NATIVA ⬇️ ---
            enviarAlertaNativa('¡Estás Retrasado!', 'Tu tiempo de regreso ha expirado. Por favor, reporta el motivo.');
        }
    } else if (estadoTurno.status === "EN_DESCANSO") {
        if (estadoTurno.proximaSalida && ahora > estadoTurno.proximaSalida) {
            marcarComoListoParaSalir();
        }
    } else if (estadoTurno.status === "LISTO_PARA_SALIR") {
        const tiempoDeGracia = new Date(estadoTurno.proximaSalida.getTime() + 5 * 60000); 
        if (ahora > tiempoDeGracia && !estadoTurno.retrasoReportado) {
            estadoTurno.status = "RETRASADO"; 
            reportarRetraso("Retraso en Base"); 
            modalRetraso.style.display = 'flex';
            // --- ⬇️ (NUEVA) ALERTA NATIVA ⬇️ ---
            enviarAlertaNativa('Retraso en Base', 'Tu hora de salida ha pasado. Reporta el motivo o inicia tu ruta.');
        }
    }
}

// --- (MODIFICADO) FUNCIONES DE LA MÁQUINA DE ESTADOS ---

// --- 1. iniciarDescanso (¡La más importante!) ---
async function iniciarDescanso() {
    console.log("Llegada a base. Iniciando descanso.");
    estadoTurno.status = "EN_DESCANSO";
    estadoTurno.retrasoReportado = false; 

    const ahora = new Date();
    const nuevaSalida = new Date(ahora.getTime() + estadoTurno.tiempoDescansoMin * 60000);
    const nuevoRegreso = new Date(nuevaSalida.getTime() + (estadoTurno.duracionVueltaMin + estadoTurno.tiempoDescansoMin) * 60000);

    estadoTurno.proximaSalida = nuevaSalida;
    estadoTurno.proximoRegreso = nuevoRegreso;

    const unidadRef = db.collection('unidades').doc(currentUnitId);
    
    try {
        // 1. Actualiza el documento principal de la unidad
        await unidadRef.update({
            status: "EN_DESCANSO",
            proximaSalida: nuevaSalida,
            proximoRegreso: nuevoRegreso,
            retrasoInfo: null,
            vueltasCompletadas: firebase.firestore.FieldValue.increment(1)
        });

        // 2. Actualiza el log de la vuelta ACTUAL (la que acaba de terminar)
        if (currentVueltaDocId) {
            const vueltaActualRef = unidadRef.collection('vueltas_log').doc(currentVueltaDocId);
            const vueltaData = (await vueltaActualRef.get()).data();
            
            const desviacionRegreso = (ahora.getTime() - vueltaData.regreso_plan.toDate().getTime()) / 60000;
            
            await vueltaActualRef.update({
                regreso_real: ahora,
                status: "COMPLETADA",
                desviacionRegreso: desviacionRegreso
            });
            console.log(`Vuelta ${currentVueltaDocId} marcada como COMPLETADA.`);
        }

        // 3. Crea el documento de la SIGUIENTE vuelta
        const datosVueltaSiguiente = {
            vueltaNum: (await unidadRef.get()).data().vueltasCompletadas + 1, // Leemos el contador actualizado
            salida_plan: nuevaSalida,
            salida_real: null,
            regreso_plan: nuevoRegreso,
            regreso_real: null,
            status: "PENDIENTE",
            desviacionSalida: null,
            desviacionRegreso: null,
            reporte: null
        };
        const nuevaVueltaRef = await unidadRef.collection('vueltas_log').add(datosVueltaSiguiente);
        
        // 4. Guarda el ID de la nueva vuelta para la próxima vez
        currentVueltaDocId = nuevaVueltaRef.id;
        console.log(`Vuelta ${currentVueltaDocId} creada como PENDIENTE.`);

    } catch (err) {
        console.error("Error al actualizar/crear log de vuelta:", err);
    }
}

// --- 2. marcarComoListoParaSalir (Modificada) ---
function marcarComoListoParaSalir() {
    estadoTurno.status = "LISTO_PARA_SALIR";
    
    // --- ⬇️ (NUEVA) ALERTA NATIVA ⬇️ ---
    enviarAlertaNativa('¡Hora de Salir!', 'Tu tiempo en base ha terminado. Inicia tu ruta cuando estés listo.');
    
    const unidadRef = db.collection('unidades').doc(currentUnitId);
    unidadRef.update({
        status: "LISTO_PARA_SALIR"
    });
}

// --- 3. iniciarRuta (Modificada) ---
async function iniciarRuta() {
    console.log("Saliendo de base. Iniciando ruta.");
    estadoTurno.status = "EN_RUTA";
    estadoTurno.retrasoReportado = false; 
    
    const ahora = new Date();
    const unidadRef = db.collection('unidades').doc(currentUnitId);

    try {
        await unidadRef.update({
            status: "EN_RUTA",
            retrasoInfo: null
        });

        if (currentVueltaDocId) {
            const vueltaActualRef = unidadRef.collection('vueltas_log').doc(currentVueltaDocId);
            const vueltaData = (await vueltaActualRef.get()).data();
            
            const desviacionSalida = (ahora.getTime() - vueltaData.salida_plan.toDate().getTime()) / 60000;
            
            await vueltaActualRef.update({
                salida_real: ahora,
                status: "EN_RUTA",
                desviacionSalida: desviacionSalida
            });
            console.log(`Vuelta ${currentVueltaDocId} marcada como EN_RUTA.`);
        }
    } catch (err) {
        console.error("Error al actualizar log de vuelta (iniciarRuta):", err);
    }
}

// --- 4. reportarRetraso (Modificada) ---
async function reportarRetraso(motivo) {
    console.log(`Reportando retraso: ${motivo}`);
    estadoTurno.status = "RETRASADO";
    const unidadRef = db.collection('unidades').doc(currentUnitId);

    try {
        await unidadRef.update({
            status: "RETRASADO",
            retrasoInfo: motivo
        });

        if (currentVueltaDocId) {
            const vueltaActualRef = unidadRef.collection('vueltas_log').doc(currentVueltaDocId);
            await vueltaActualRef.update({
                reporte: motivo,
                status: "RETRASADO"
            });
            console.log(`Vuelta ${currentVueltaDocId} actualizada con reporte: ${motivo}`);
        }
    } catch (err) {
        console.error("Error al actualizar log de vuelta (reportarRetraso):", err);
    }
}

// --- Funciones de UI y Recuperación (Restauradas) ---
function actualizarPanelHorario(status, proxSalida, proxRegreso) {
    panelHorario.style.display = 'block';
    const salidaDate = proxSalida ? new Date(proxSalida) : null;
    const regresoDate = proxRegreso ? new Date(proxRegreso) : null;
    const formatAMPM = (date) => {
        if (!date) return "--:--";
        let hours = date.getHours();
        let minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12; 
        minutes = minutes < 10 ? '0'+minutes : minutes;
        return `${hours}:${minutes} ${ampm}`;
    };
    if (status === "EN_DESCANSO") {
        statusText.textContent = "Cargando Pasaje en Base";
        statusText.style.color = "blue";
    } else if (status === "LISTO_PARA_SALIR") {
        statusText.textContent = "¡Listo para Salir!";
        statusText.style.color = "#E69500";
    } else if (status === "EN_RUTA") {
        statusText.textContent = "En Ruta...";
        statusText.style.color = "green";
    } else if (status === "RETRASADO") {
        statusText.textContent = "¡Retrasado!";
        statusText.style.color = "red";
    }
    horarioSalida.textContent = formatAMPM(salidaDate);
    horarioRegreso.textContent = formatAMPM(regresoDate);
}
function isWithinOperatingHours() {
    return true;
}
async function buscarTurnoActivo(driverUid) {
    try {
        const unidadesRef = db.collection('unidades');
        const query = unidadesRef
            .where('currentDriverId', '==', driverUid)
            .where('status', '!=', 'INACTIVO')
            .limit(1);
        const snapshot = await query.get();
        if (snapshot.empty) {
            return;
        }
        const doc = snapshot.docs[0];
        const unitId = doc.id;
        console.log(`Turno activo encontrado: Unidad ${unitId}. Recuperando...`);
        unitNumberInput.value = unitId;
        startShiftButton.click(); 
    } catch (err) {
        console.error("Error recuperando turno:", err);
        alert("Error al intentar recuperar tu turno anterior.");
    }
}

// --- ⬇️ (NUEVA) FUNCIÓN DE ALERTA NATIVA ⬇️ ---
async function enviarAlertaNativa(titulo, mensaje) {
    try {
        // 1. Vibrar (usando el plugin Haptics que ya tenías)
        await Capacitor.Plugins.Haptics.vibrate({ duration: 1000 }); // Vibra por 1 segundo

        // 2. Enviar Notificación (con sonido)
        await Capacitor.Plugins.LocalNotifications.schedule({
            notifications: [
                {
                    title: titulo,
                    body: mensaje,
                    id: notificationIdCounter++,
                    // Para que suene, debes añadir un sonido
                    // 1. Crea la carpeta: android/app/src/main/res/raw
                    // 2. Añade un archivo (ej. beep.wav) a esa carpeta
                    // sound: 'beep.wav', 
                    channelId: 'koox-alertas', 
                    importance: 5 // Máxima importancia
                }
            ]
        });
    } catch (e) {
        console.error("Error al enviar alerta nativa:", e);
    }
}