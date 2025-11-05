// --- app.js (APP DEL CHÓFER - CORREGIDO) ---

// --- (MODIFICADO) YA NO USAMOS 'IMPORT' ---
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


// --- Lógica del Modal de Retraso ---
modalRetraso.addEventListener('click', (e) => {
    let motivo = null;
    if (e.target.classList.contains('btn-modal-opcion')) {
        motivo = e.target.dataset.motivo;
        if (motivo) {
            reportarRetraso(motivo);
        }
        modalRetraso.style.display = 'none';
        if (motivo) {
             estadoTurno.retrasoReportado = true;
        }
    }
});

reportIssueButton.addEventListener('click', () => {
    if (estadoTurno.status === "INACTIVO") return;
    console.log("Reporte manual de incidencia.");
    modalRetraso.style.display = 'flex';
});

// --- LÓGICA DE AUTENTICACIÓN (EL "ROUTER") ---
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

// --- app.js (Línea 125) ---
loginButton.addEventListener('click', () => {
    console.log("LOGIN_CLICKED: Botón presionado."); // Log 1
    const email = loginEmail.value;
    const password = loginPassword.value;
    console.log("LOGIN_ATTEMPT: Intentando con", email); // Log 2
    
    auth.signInWithEmailAndPassword(email, password)
        .then(userCredential => {
            console.log("LOGIN_SUCCESS: ¡Éxito!", userCredential.user.uid);
        })
        .catch(error => {
            console.error("LOGIN_FAILED: El login falló.", error.code, error.message);
            loginError.textContent = `Error: ${error.code} - ${error.message}`;
            loginError.style.display = 'block';
        });
});

saveProfileButton.addEventListener('click', () => {
    const nombre = driverNameInput.value.trim();
    if (!nombre) {
        alert("Por favor ingresa tu nombre completo.");
        return;
    }
    if (!currentUser) return; 

    const conductorRef = db.collection('conductores').doc(currentUser.uid);
    conductorRef.set({
        nombre: nombre,
        email: currentUser.email,
        uid: currentUser.uid,
        fechaRegistro: firebase.firestore.FieldValue.serverTimestamp()
    })
    .then(() => {
        profileScreen.classList.remove('active');
        mainScreen.classList.add('active');
        currentDriverName = nombre;
        driverEmail.textContent = currentDriverName;
    })
    .catch(err => {
        alert("Error al guardar tu perfil. Intenta de nuevo.");
    });
});

logoutButton.addEventListener('click', () => {
    if (estadoTurno.status !== "INACTIVO") {
        alert("No puedes cerrar sesión. Primero debes 'Terminar Turno'.");
        return;
    }
    auth.signOut();
});

// --- LÓGICA PRINCIPAL DE TURNO ---
startShiftButton.addEventListener('click', async () => {
    const unitNumber = unitNumberInput.value;
    if (!unitNumber) {
        alert("Por favor, ingresa un número de unidad.");
        return;
    }
    
    currentUnitId = unitNumber;
    startShiftButton.disabled = true;
    unitNumberInput.disabled = true;
    statusText.textContent = "Buscando asignación...";
    statusText.style.color = "orange";

    try {
        const unidadRef = db.collection('unidades').doc(currentUnitId);
        
        estadoTurno.listenerTurno = unidadRef.onSnapshot((doc) => {
            
            // --- ⬇️ INICIO DE LA CORRECCIÓN ⬇️ ---

            if (doc.exists && doc.data().assignedRouteId) {
                const data = doc.data();
                
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
                
                // Variables que se actualizan SIEMPRE que hay un cambio
                estadoTurno.status = data.status;
                const checadorNombre = data.checadorName || 'Sistema';
                checadorAsignadoTexto.textContent = `Asignada por: ${checadorNombre}`;

                // ¡AQUÍ ESTÁ LA CORRECCIÓN!
                // Actualizamos las horas de la máquina de estados con los datos de Firestore
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

                // Resetea el flag de reporte si el checador edita el turno
                // (asumiendo que una edición limpia un retraso)
                if (data.retrasoInfo === null) {
                    estadoTurno.retrasoReportado = false; 
                }

                // Actualiza la UI con las horas (ahora sí) correctas
                actualizarPanelHorario(
                    estadoTurno.status, 
                    estadoTurno.proximaSalida,
                    estadoTurno.proximoRegreso
                );
                
            } else {
                // Esto se activa si assignedRouteId es null (turno finalizado por checador)
                console.warn("Esta unidad ya no tiene una ruta asignada (turno finalizado).");
                if (estadoTurno.status !== "INACTIVO") {
                    alert("El turno ha sido finalizado por el checador.");
                    stopShiftButton.click(); // Forzar reinicio de UI
                }
            }
            // --- ⬆️ FIN DE LA CORRECCIÓN ⬆️ ---

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

    stopTracking(); // (Esta función ya actualiza Firestore)
    
    startShiftButton.disabled = false;
    unitNumberInput.disabled = false;
    unitNumberInput.value = ""; 
    statusText.textContent = "Desconectado";
    statusText.style.color = "red";
    locationCoords.textContent = "";
    infoRutaAsignada.style.display = 'none';
    checadorAsignadoTexto.textContent = "";
    panelHorario.style.display = 'none';
    reportIssueButton.style.display = 'none';
    
    // --- ⬇️ INICIO DE LA CORRECCIÓN ⬇️ ---
    // Reseteo completo de la máquina de estados
    estadoTurno.status = "INACTIVO";
    currentRouteId = null;
    estadoTurno.proximaSalida = null;
    estadoTurno.proximoRegreso = null;
    estadoTurno.retrasoReportado = false;
    estadoTurno.paraderoBase = null;
    // --- ⬆️ FIN DE LA CORRECCIÓN ⬆️ ---
});


// --- LÓGICA DE GEOLOCALIZACIÓN Y FIREBASE ---

// --- 
// --- (¡¡¡CORREGIDO!!!) FUNCIÓN startTracking 
// --- 
async function startTracking() {
    if (watchId) {
        console.log("El rastreo ya estaba activo.");
        return;
    }

    try {
        // --- (MODIFICADO) Usamos el plugin global ---
        watchId = await Capacitor.Plugins.BackgroundGeolocation.addWatcher(
            {
                backgroundNotification: {
                    title: "Rutas Koox (Chofer) Activo",
                    text: "Transmitiendo ubicación en segundo plano."
                },
                requestPermissions: true, // <--- ESTA LÍNEA ES LA CLAVE
                stale: false,
                distanceFilter: 10 // Actualizar cada 10 metros
            }, 
            (location, error) => {
                
                if (error) {
                    handleLocationError({ 
                        code: error.code || 0, 
                        message: error.message || "Error desconocido de GPS" 
                    });
                    return;
                }

                if (location) {
                    const pos = {
                        coords: {
                            latitude: location.latitude,
                            longitude: location.longitude,
                            speed: location.speed || 0,
                            heading: location.bearing || 0
                        }
                    };
                    handleLocationUpdate(pos);
                }
            }
        );
        
        console.log("Servicio de GPS en segundo plano iniciado. Watcher ID:", watchId);
        
        if (tickerInterval) clearInterval(tickerInterval);
        tickerInterval = setInterval(checkTimeBasedStates, 30000); 
        
        // "Reclamar" la unidad
        const unidadRef = db.collection('unidades').doc(currentUnitId);
        unidadRef.set({
            currentDriverId: currentUser.uid,
            currentDriverEmail: currentUser.email,
            currentDriverName: currentDriverName,
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
        .catch(err => console.error("Error al reclamar la unidad:", err));

    } catch (e) {
        handleLocationError({ code: 1, message: `Permiso denegado o error: ${e.message}` });
    }
}

// --- 
// --- (MODIFICADO) FUNCIÓN stopTracking (AHORA USA CAPACITOR)
// --- 
async function stopTracking() {
    if (watchId) {
        try {
            await Capacitor.Plugins.BackgroundGeolocation.removeWatcher({
                id: watchId
            });
            watchId = null;
            console.log("Rastreo en segundo plano detenido.");
        } catch (e) {
            console.error("Error al detener el watcher:", e);
        }
    } else {
        console.log("Rastreo ya estaba detenido.");
    }

    if (currentUnitId) {
        db.collection('live_locations').doc(currentUnitId).delete()
            .catch(error => console.error("Error al eliminar ubicación:", error));
        
        // --- ⬇️ INICIO DE LA CORRECCIÓN ⬇️ ---
        // Al terminar turno, limpiamos TODOS los campos del turno
        db.collection('unidades').doc(currentUnitId).update({
            status: 'INACTIVO',
            currentDriverId: null,
            currentDriverEmail: null,
            currentDriverName: null,
            retrasoInfo: null,
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp(),
            // --- ¡CAMPOS AÑADIDOS PARA SINCRONIZACIÓN! ---
            assignedRouteId: null, 
            proximaSalida: null,
            proximoRegreso: null,
            checadorId: null,
            checadorName: null
        }).catch(err => console.error("Error al liberar la unidad:", err));
        // --- ⬆️ FIN DE LA CORRECCIÓN ⬆️ ---

        currentUnitId = null;
    }
    
    estadoTurno.status = "INACTIVO";
}

// ---
// --- (SIN MODIFICAR) Esta función solo recibe datos, es compatible
// ---
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
    
    // Solo envía GPS si el turno está activo
    if (estadoTurno.status !== "INACTIVO" && currentUnitId) {
        db.collection('live_locations').doc(currentUnitId).set(locationData);
    
        if (estadoTurno.status !== "RETRASADO") {
            const unidadRef = db.collection('unidades').doc(currentUnitId);
            unidadRef.update({
                retrasoInfo: null
            }).catch(err => {}); 
        }
    }

    if (estadoTurno.status === "INACTIVO" || !estadoTurno.paraderoBase) return;
    if (typeof turf === 'undefined') {
        console.error("Turf.js no está cargado. No se puede calcular geofence.");
        return;
    }
    
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

// ---
// --- (SIN MODIFICAR) Esta función solo recibe datos, es compatible
// ---
function handleLocationError(error) {
    console.warn(`Error de geolocalización (código ${error.code}): ${error.message}`);
    statusText.textContent = `Error de GPS: ${error.message}.`;
    statusText.style.color = "red";
}


// --- 
// --- (MODIFICADO) Reloj Checador (AÑADE VIBRACIÓN)
// ---
function checkTimeBasedStates() {
    if (estadoTurno.status === "INACTIVO" || !estadoTurno.proximaSalida) {
        return; // Sal si no hay turno
    }
    const ahora = new Date();

    if (estadoTurno.status === "EN_RUTA") {
        if (estadoTurno.proximoRegreso && ahora > estadoTurno.proximoRegreso && !estadoTurno.retrasoReportado) {
            estadoTurno.status = "RETRASADO";
            reportarRetraso("Retraso en Ruta"); 
            modalRetraso.style.display = 'flex';
            Capacitor.Plugins.Haptics.notification({ type: Capacitor.Plugins.Haptics.NotificationType.Warning });
        }
    } else if (estadoTurno.status === "EN_DESCANSO") {
        if (estadoTurno.proximaSalida && ahora > estadoTurno.proximaSalida) {
            marcarComoListoParaSalir();
        }
    } else if (estadoTurno.status === "LISTO_PARA_SALIR") {
        // --- ⬇️ INICIO DE LA CORRECCIÓN ⬇️ ---
        // (El tiempoDeGracia ahora se calcula aquí, no en la otra rama)
        const tiempoDeGracia = new Date(estadoTurno.proximaSalida.getTime() + 5 * 60000); 
        if (ahora > tiempoDeGracia && !estadoTurno.retrasoReportado) {
            estadoTurno.status = "RETRASADO"; 
            reportarRetraso("Retraso en Base"); 
            modalRetraso.style.display = 'flex';
            Capacitor.Plugins.Haptics.notification({ type: Capacitor.Plugins.Haptics.NotificationType.Warning });
        }
        // --- ⬆️ FIN DE LA CORRECCIÓN ⬆️ ---
    }
}

// --- Funciones de la Máquina de Estados (SIN CAMBIOS) ---

function iniciarDescanso() {
    estadoTurno.status = "EN_DESCANSO";
    estadoTurno.retrasoReportado = false; 

    const ahora = new Date();
    const nuevaSalida = new Date(ahora.getTime() + estadoTurno.tiempoDescansoMin * 60000);
    const nuevoRegreso = new Date(nuevaSalida.getTime() + estadoTurno.duracionVueltaMin * 60000);

    estadoTurno.proximaSalida = nuevaSalida;
    estadoTurno.proximoRegreso = nuevoRegreso;

    const unidadRef = db.collection('unidades').doc(currentUnitId);
    unidadRef.update({
        status: "EN_DESCANSO",
        proximaSalida: nuevaSalida,
        proximoRegreso: nuevoRegreso,
        retrasoInfo: null 
    });
}

function marcarComoListoParaSalir() {
    estadoTurno.status = "LISTO_PARA_SALIR";
    
    // --- (NUEVO) VIBRACIÓN DE ALERTA ---
    // Avisa al chófer que ya es hora de salir
    Capacitor.Plugins.Haptics.vibrate();

    const unidadRef = db.collection('unidades').doc(currentUnitId);
    unidadRef.update({
        status: "LISTO_PARA_SALIR"
    });
}

function iniciarRuta() {
    estadoTurno.status = "EN_RUTA";
    
    // --- ⬇️ INICIO DE LA CORRECCIÓN ⬇️ ---
    estadoTurno.retrasoReportado = false; // Resetea el flag al salir
    
    const unidadRef = db.collection('unidades').doc(currentUnitId);
    unidadRef.update({
        status: "EN_RUTA",
        retrasoInfo: null // Limpia el "Retraso en Base"
    });
    // --- ⬆️ FIN DE LA CORRECCIÓN ⬆️ ---
}

function reportarRetraso(motivo) {
    estadoTurno.status = "RETRASADO";
    const unidadRef = db.collection('unidades').doc(currentUnitId);
    unidadRef.update({
        status: "RETRASADO",
        retrasoInfo: motivo
    });
}

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

// --- FUNCIÓN DE RECUPERACIÓN DE TURNO (SIN CAMBIOS) ---
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