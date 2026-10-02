package com.stephensookra.atlas.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import com.stephensookra.atlas.data.Clinic
import java.net.URLEncoder

object Links {
    /** "tel:" with digits only, or null when there is no number (the server sends "" for none). */
    fun tel(number: String?): String? {
        val digits = number.orEmpty().filter { it.isDigit() }
        return if (digits.isEmpty()) null else "tel:$digits"
    }

    /** Google Maps transit directions to the clinic's street address (opens the Maps app when installed). */
    fun transit(c: Clinic): String {
        // Clinics outside Atlanta come with "City, ST"; Atlanta records have the city only.
        val place = if (c.city.contains(",")) "${c.address}, ${c.city} ${c.zip}" else "${c.address}, ${c.city}, GA ${c.zip}"
        val dest = URLEncoder.encode(place, "UTF-8")
        return "https://www.google.com/maps/dir/?api=1&destination=$dest&travelmode=transit"
    }

    /** Only http(s) links from the server are opened. */
    fun web(url: String?): String? {
        val u = url?.trim().orEmpty()
        return if (u.startsWith("https://") || u.startsWith("http://")) u else null
    }

    fun host(url: String): String? = runCatching { Uri.parse(url).host }.getOrNull()?.takeIf { it.isNotEmpty() }

    fun dial(context: Context, number: String?) {
        val uri = tel(number) ?: return
        start(context, Intent(Intent.ACTION_DIAL, Uri.parse(uri)))
    }

    fun directions(context: Context, c: Clinic) {
        start(context, Intent(Intent.ACTION_VIEW, Uri.parse(transit(c))))
    }

    /** In-app browser (Custom Tab) for the privacy page and program links. */
    fun openInApp(context: Context, url: String?) {
        val u = web(url) ?: return
        try {
            CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(CustomTabColorSchemeParams.Builder().setToolbarColor(0xFF0B7A75.toInt()).build())
                .setShowTitle(true)
                .build()
                .launchUrl(context, Uri.parse(u))
        } catch (_: ActivityNotFoundException) {
            start(context, Intent(Intent.ACTION_VIEW, Uri.parse(u)))
        }
    }

    private fun start(context: Context, intent: Intent) {
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(context, "No app on this phone can open that.", Toast.LENGTH_LONG).show()
        }
    }
}
