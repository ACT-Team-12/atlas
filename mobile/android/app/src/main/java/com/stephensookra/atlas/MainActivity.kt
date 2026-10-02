package com.stephensookra.atlas

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.stephensookra.atlas.services.Reminders
import com.stephensookra.atlas.ui.AtlasRoot
import com.stephensookra.atlas.ui.AtlasTheme

class AtlasApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Reminders.ensureChannel(this)
    }
}

class MainActivity : ComponentActivity() {
    private val model: AppModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            AtlasTheme { AtlasRoot(model) }
        }
    }
}
