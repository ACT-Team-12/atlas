package com.stephensookra.atlas.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.stephensookra.atlas.AppModel
import com.stephensookra.atlas.data.Barrier
import com.stephensookra.atlas.data.LatLng
import com.stephensookra.atlas.services.LocationProvider
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BarriersScreen(model: AppModel) {
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    var locating by remember { mutableStateOf(false) }

    fun locate() {
        locating = true
        scope.launch {
            try {
                val fix = LocationProvider.current(context)
                if (fix == null) {
                    model.error = LocationProvider.UNAVAILABLE
                    return@launch
                }
                val point = LatLng(fix.latitude, fix.longitude)
                if (!point.isInServiceArea) {
                    model.error = LocationProvider.OUTSIDE
                    return@launch
                }
                model.useLocation(point)
            } finally {
                locating = false
            }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) locate() else model.error = LocationProvider.DENIED
    }
    fun useMyLocation() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            locate()
        } else {
            permission.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
    }

    ScreenBody {
        ScreenTitle("What gets in the way?", "Pick any that fit.")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Barrier.entries.forEach { b ->
                val on = model.barriers.contains(b)
                val shape = RoundedCornerShape(50)
                Box(
                    Modifier
                        .padding(bottom = if (on) 0.dp else 3.dp)
                        .background(if (on) Palette.teal else Palette.paper, shape)
                        .border(2.dp, Palette.ink, shape)
                        .clickable(role = Role.Checkbox) { model.toggle(b) }
                        .semantics { contentDescription = b.label; selected = on }
                        .heightIn(min = 44.dp)
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                ) {
                    Text((if (on) "✓ " else "") + b.label,
                        style = Type.sub.copy(fontWeight = FontWeight.Bold, color = if (on) Palette.paper else Palette.ink))
                }
            }
        }

        AtlasCard {
            Text("Your ZIP", style = Type.sub.copy(fontWeight = FontWeight.Bold))
            InputBox(model.zip, { model.updateZip(it) }, placeholder = "e.g. 30340", label = "Your ZIP code", keyboard = KeyboardType.Number)
            val label = when {
                locating -> "Finding you..."
                model.location != null -> "Using your location (not saved)"
                else -> "Or use my location"
            }
            OutlinePill(label, onClick = { if (!locating) useMyLocation() },
                icon = if (model.location != null) Icons.Filled.CheckCircle else Icons.Filled.LocationOn,
                textColor = Palette.tealDeep)
        }

        AtlasCard {
            Text("Anything else we should know? (optional)", style = Type.sub.copy(fontWeight = FontWeight.Bold))
            InputBox(model.note, { model.updateNote(it) }, placeholder = "e.g. no car, I work mornings", label = "Anything else we should know", singleLine = false)
        }

        PillButton("Make my plan", onClick = { focus.clearFocus(); model.makePlan() }, enabled = model.canPlan,
            fill = Palette.ink, textColor = Palette.paper, shadow = Palette.mint)
    }
}

@Composable
fun InputBox(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    label: String,
    keyboard: KeyboardType = KeyboardType.Text,
    singleLine: Boolean = true,
) {
    val shape = RoundedCornerShape(14.dp)
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .background(Palette.paper, shape)
            .border(2.dp, Palette.ink.copy(alpha = 0.7f), shape)
            .padding(12.dp),
    ) {
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = singleLine,
            minLines = if (singleLine) 1 else 3,
            maxLines = if (singleLine) 1 else 6,
            textStyle = Type.body,
            cursorBrush = SolidColor(Palette.teal),
            keyboardOptions = KeyboardOptions(keyboardType = keyboard),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        )
        if (value.isEmpty()) Text(placeholder, style = Type.body.copy(color = Palette.inkSoft.copy(alpha = 0.6f)))
    }
}
