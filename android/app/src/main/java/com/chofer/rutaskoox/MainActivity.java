package com.chofer.rutaskoox;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

// --- Importaciones necesarias ---
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
// --- Fin de Importaciones ---

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // --- Código para crear el Canal de Notificación ---
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel("koox-alertas",
                    "Alertas de Turno",
                    NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Alertas de retraso y salida para el chófer");

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
        // --- Fin del código del Canal ---
    }
}