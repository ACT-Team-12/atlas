package com.stephensookra.atlas

import android.app.Application
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.stephensookra.atlas.data.HelperLink
import com.stephensookra.atlas.services.Reminders
import com.stephensookra.atlas.ui.AtlasRoot
import com.stephensookra.atlas.ui.AtlasTheme

class AtlasApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Reminders.ensureChannel(this)
        // Android drops alarms when an app is force-stopped; re-arming is idempotent, so do it on every start.
        Reminders.rearmAll(this)
    }
}

class MainActivity : ComponentActivity() {
    private val model: AppModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Only a fresh launch reads the link; a re-created activity (rotation) must not apply it again.
        if (savedInstanceState == null) openLink(intent)
        setContent {
            AtlasTheme { AtlasRoot(model) }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openLink(intent)
    }

    /**
     * A helper link (https://atlas-team12.vercel.app/#try&via=helper&lang=es&level=simple&zip=30310) opens the app with
     * those choices made. The fragment is read raw, as the website reads location.hash; anything else is ignored.
     */
    private fun openLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val uri = intent.data ?: return
        HelperLink.fromLink(uri.scheme, uri.host, uri.encodedFragment)?.let { model.applyHelperLink(it) }
    }
}
