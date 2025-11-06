// Ruta: android/app/src/main/java/com/chofer/rutaskoox/MainActivity.java
package com.chofer.rutaskoox;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

// --- ⬇️ AÑADE ESTOS 3 IMPORTS ⬇️ ---
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
// --- ⬆️ FIN DE IMPORTS ⬆️ ---

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState); // Esta línea ya existía

        // --- ⬇️ AÑADE ESTE BLOQUE PARA EL CANAL DE SONIDO ⬇️ ---
        // (Este es el código que va DENTRO de onCreate)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel("koox-alertas",
                    "Alertas de Turno",
                    NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Alertas de retraso y salida para el chófer");
            
            // (Opcional) Si quieres que suene incluso en "No Molestar"
            // channel.setBypassDnd(true);
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
        // --- ⬆️ FIN DEL BLOQUE ⬆️ ---
    }
}