package com.stephensookra.atlas.services

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/** One-time, coarse location for "nearest clinics". Never saved. Uses the platform, no Play services needed. */
object LocationProvider {
    const val DENIED = "Location is off for ATLAS. Type a ZIP instead."
    const val UNAVAILABLE = "We could not find your location. Type a ZIP instead."
    const val OUTSIDE =
        "Your location is outside metro Atlanta, where ATLAS has verified clinics. Type a metro Atlanta ZIP instead."

    /** Caller must already hold ACCESS_COARSE_LOCATION. Returns null when no fix arrives in time. */
    @SuppressLint("MissingPermission")
    suspend fun current(context: Context): Location? {
        val lm = context.getSystemService(LocationManager::class.java) ?: return null
        val providers = buildList {
            if (Build.VERSION.SDK_INT >= 31 && lm.allProviders.contains(LocationManager.FUSED_PROVIDER)) add(LocationManager.FUSED_PROVIDER)
            add(LocationManager.NETWORK_PROVIDER)
            add(LocationManager.GPS_PROVIDER)
        }.filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
        val provider = providers.firstOrNull() ?: return null
        val fresh = withTimeoutOrNull(15_000) {
            suspendCancellableCoroutine<Location?> { cont ->
                val signal = CancellationSignal()
                cont.invokeOnCancellation { signal.cancel() }
                LocationManagerCompat.getCurrentLocation(lm, provider, signal, ContextCompat.getMainExecutor(context)) {
                    if (cont.isActive) cont.resume(it)
                }
            }
        }
        return fresh ?: providers.firstNotNullOfOrNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
    }
}
